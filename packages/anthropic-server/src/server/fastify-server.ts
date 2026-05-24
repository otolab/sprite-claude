import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AIService, type ApplicationConfig } from '@modular-prompt/driver';
import { MessagesRequestSchema, type MessagesRequest, type MessagesResponse } from '../schema.js';
import { handleMessages } from '../messages/index.js';
import { createServerLogger } from './logging.js';
import type { AnthropicServerOptions } from './types.js';

/**
 * Send a completed MessagesResponse as Anthropic SSE streaming events.
 * This is pseudo-streaming — the response is fully computed before sending.
 */
function sendAsSSE(reply: FastifyReply, response: MessagesResponse): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const write = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // message_start
  write('message_start', {
    type: 'message_start',
    message: {
      id: response.id,
      type: 'message',
      role: 'assistant',
      content: [],
      model: response.model,
      stop_reason: null,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: 0 },
    },
  });

  // content blocks
  for (let i = 0; i < response.content.length; i++) {
    const block = response.content[i];

    if (block.type === 'text') {
      write('content_block_start', {
        type: 'content_block_start',
        index: i,
        content_block: { type: 'text', text: '' },
      });
      write('content_block_delta', {
        type: 'content_block_delta',
        index: i,
        delta: { type: 'text_delta', text: block.text },
      });
      write('content_block_stop', { type: 'content_block_stop', index: i });
    } else if (block.type === 'tool_use') {
      write('content_block_start', {
        type: 'content_block_start',
        index: i,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      write('content_block_delta', {
        type: 'content_block_delta',
        index: i,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
      write('content_block_stop', { type: 'content_block_stop', index: i });
    }
  }

  // message_delta + message_stop
  write('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: response.stop_reason },
    usage: { output_tokens: response.usage.output_tokens },
  });
  write('message_stop', { type: 'message_stop' });

  reply.raw.end();
}

/**
 * Create Fastify server with Anthropic Messages API endpoint
 *
 * This function:
 * - Creates a Fastify server instance
 * - Initializes AIService with configured models
 * - Sets up /v1/messages endpoint
 * - Driver selection and caching is handled by engine
 */
export async function createServer(options: AnthropicServerOptions = {}): Promise<FastifyInstance> {
  const logLevel = options.logging?.level || 'info';
  const requestResponseLevel = options.logging?.requestResponseLevel || 'full';
  const pid = process.pid;
  const serverLogger = createServerLogger(pid);

  serverLogger.info('config', `Log settings: level=${logLevel}, req/res=${requestResponseLevel}`);

  const fastify = Fastify({
    logger: {
      level: logLevel,
    },
  });

  // Add error handler to log validation errors with request body
  fastify.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 400 && error.validation) {
      request.log.error({
        error: error.message,
        validation: error.validation,
        body: request.body
      }, 'Validation error with request body');
    }
    reply.send(error);
  });

  // Initialize AIService
  let aiService: AIService;
  const defaultOpts = {
    temperature: 0.7,
    maxTokens: 1024,
    ...options.defaultOptions,
  };

  if (options.models && options.models.length > 0) {
    const aiServiceConfig: ApplicationConfig = {
      models: options.models,
      drivers: options.drivers || {},
      defaultOptions: defaultOpts as ApplicationConfig['defaultOptions'],
    };

    aiService = new AIService(aiServiceConfig);
    const activeCount = options.models.filter(m => !m.disabled).length;
    serverLogger.info('startup', `AIService initialized with ${activeCount}/${options.models.length} models (active/total), defaultOptions: ${JSON.stringify(defaultOpts)}`);
  } else {
    // Legacy configuration: Single MLX model
    const model = options.model || 'mlx-community/gemma-2-2b-it-4bit';
    const aiServiceConfig: ApplicationConfig = {
      models: [
        {
          model,
          provider: 'mlx',
          capabilities: ['local', 'fast'],
          priority: 10,
        },
      ],
      drivers: {
        mlx: options.drivers?.mlx || {},
      },
      defaultOptions: defaultOpts as ApplicationConfig['defaultOptions'],
    };

    aiService = new AIService(aiServiceConfig);
    serverLogger.info('startup', `AIService initialized with legacy MLX model: ${model}`);
  }

  // Store AIService in fastify instance
  fastify.decorate('aiService', aiService);

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });

  // Count tokens endpoint (mock implementation)
  fastify.post('/v1/messages/count_tokens', async () => {
    return {
      input_tokens: 100, // Placeholder
    };
  });

  // Anthropic Messages API endpoint
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const reqId = request.id;

    try {
      // Validate request body strictly
      const validationResult = MessagesRequestSchema.safeParse(request.body);
      if (!validationResult.success) {
        request.log.error({
          reqId,
          validation_errors: validationResult.error.issues,
          body: request.body,
        }, 'Request validation failed');

        reply.status(400);
        return {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: validationResult.error.issues.map(i => i.message).join(', '),
          },
        };
      }

      // Engine handles driver selection per phase via AIService
      const response = await handleMessages(
        validationResult.data,
        aiService,
        options.prompts,
        options.maxTokens,
        pid,
        reqId,
        requestResponseLevel,
        options.workflows,
        options.modelMapping,
        options.routingWorkflow,
        serverLogger,
        options.configDir,
        options.workflowTimeout ?? 300_000,
      );

      // Pseudo-streaming: wrap completed response as SSE events
      if (validationResult.data.stream) {
        return sendAsSSE(reply, response);
      }

      return response;
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Map upstream errors to Anthropic-compatible error responses
      if (message.startsWith('Workflow timeout:')) {
        reply.status(408);
        return {
          type: 'error',
          error: {
            type: 'api_error',
            message,
          },
        };
      }
      if (message.includes('503') || message.includes('UNAVAILABLE') || message.includes('high demand')) {
        reply.status(529);
        return {
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: 'Overloaded',
          },
        };
      }
      if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('rate limit')) {
        reply.status(429);
        return {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message,
          },
        };
      }

      reply.status(500);
      return {
        type: 'error',
        error: {
          type: 'api_error',
          message,
        },
      };
    }
  });

  return fastify;
}
