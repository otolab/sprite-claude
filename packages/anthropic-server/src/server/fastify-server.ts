import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { AIService, type ApplicationConfig } from '@modular-prompt/driver';
import { MessagesRequestSchema, type MessagesRequest } from '../schema.js';
import { handleMessages } from '../messages/index.js';
import { createServerLogger } from './logging.js';
import type { AnthropicServerOptions } from './types.js';

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

  if (options.models && options.models.length > 0) {
    // New configuration: Use AIService with multiple models
    const aiServiceConfig: ApplicationConfig = {
      models: options.models,
      drivers: options.drivers || {},
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 1024,
      },
    };

    aiService = new AIService(aiServiceConfig);
    const activeCount = options.models.filter(m => !m.disabled).length;
    serverLogger.info('startup', `AIService initialized with ${activeCount}/${options.models.length} models (active/total)`);
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
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 1024,
      },
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
        options.prompt?.additionalInstructions,
        options.maxTokens,
        pid,
        reqId,
        requestResponseLevel,
        undefined, // toolProcessType
        options.workflow,
        serverLogger,
      );

      return response;
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Map upstream errors to Anthropic-compatible error responses
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
