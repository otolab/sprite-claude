import type { AIService } from '@modular-prompt/driver';
import type { Element, ToolCall } from '@modular-prompt/core';
import type { MessagesRequest, MessagesResponse, ContentBlock, TextBlock, ToolUseBlock } from '../schema.js';
import { v4 as uuidv4 } from 'uuid';
import { compile } from '@modular-prompt/core';
import { process as engineProcess, passthroughWorkflow, type WorkflowResult, type WorkflowMode } from '@sprite-claude/engine';
import { createRequestLogger, toEngineLogger, type ServerLogger } from '../server/logging.js';
import { convertMessages } from './message-converter.js';
import { loadSystemPromptModule } from './system-prompt.js';
import type { AnthropicServerOptions } from '../server/types.js';

export type MaxTokensConfig = AnthropicServerOptions['maxTokens'];
export type WorkflowModeConfig = AnthropicServerOptions['workflow'];

// Backward compatibility: ToolProcessType from old code
export type ToolProcessType = 'rag-based' | 'decision-based';
export const DEFAULT_PROCESS_TYPE: ToolProcessType = 'rag-based';

// Map ToolProcessType to WorkflowMode
const modeMap: Record<ToolProcessType, WorkflowMode> = {
  'rag-based': 'rag',
  'decision-based': 'decision',
};

// Map Anthropic tool_use ID → driver tool call ID
// Used to resolve IDs when tool_result comes back from Claude Code
const toolIdMap = new Map<string, string>();

/**
 * Convert driver tool call ID to Anthropic-style ID.
 * Claude Code expects `toolu_` prefix for proper tool result display.
 */
function toAnthropicToolId(driverId: string): string {
  if (driverId.startsWith('toolu_')) return driverId;
  const uuid = uuidv4();
  return `toolu_${uuid.replace(/-/g, '').substring(0, 20)}`;
}

function toContentBlocks(result: WorkflowResult): ContentBlock[] {
  if (result.type === 'tool_calls') {
    const blocks: ContentBlock[] = [];
    if (result.text) {
      blocks.push({ type: 'text', text: result.text } as TextBlock);
    }
    for (const call of result.calls) {
      const anthropicId = toAnthropicToolId(call.id);
      // Store mapping for tool_result ID resolution in subsequent requests
      toolIdMap.set(anthropicId, call.id);
      blocks.push({
        type: 'tool_use',
        id: anthropicId,
        name: call.name,
        input: call.arguments,
      } as ToolUseBlock);
    }
    return blocks;
  }
  if (result.type === 'tool_call') {
    // Legacy (rag/decision): generate Anthropic-style ID
    const uuid = uuidv4();
    return [{
      type: 'tool_use',
      id: `toolu_${uuid.replace(/-/g, '').substring(0, 20)}`,
      name: result.toolName,
      input: result.input,
    } as ToolUseBlock];
  }
  return [{
    type: 'text',
    text: result.text,
  } as TextBlock];
}

/**
 * Extract text from request.system field
 */
function extractSystemText(system: MessagesRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map(block => block.text).join('\n');
}

/**
 * Extract system prompt text from system prompt module
 */
function getSystemPromptText(additionalInstructions?: string): string {
  const systemPromptModule = loadSystemPromptModule(additionalInstructions);
  const compiled = compile(systemPromptModule, {});
  return compiled.instructions
    .flatMap((section: { type?: string; items?: unknown[] }) =>
      section.type === 'section' ? (section.items || []) : [section]
    )
    .filter((item: unknown): item is string => typeof item === 'string')
    .join('\n');
}

/**
 * Handle Anthropic Messages API request
 *
 * This function:
 * 1. Converts Anthropic format to internal format
 * 2. Routes to engine for processing (engine selects drivers per phase)
 * 3. Converts result back to Anthropic format
 */
export async function handleMessages(
  request: MessagesRequest,
  aiService: AIService,
  additionalInstructions?: string,
  maxTokensConfig?: MaxTokensConfig,
  pid?: number,
  _reqId?: string,
  logLevel?: 'none' | 'minimal' | 'full',
  toolProcessType?: ToolProcessType,
  workflowMode?: WorkflowModeConfig,
  serverLogger?: ServerLogger,
): Promise<MessagesResponse> {
  // Create request logger
  const logger = createRequestLogger(pid || process.pid, logLevel || 'full');
  const engineLogger = toEngineLogger(logger, serverLogger);

  // Log incoming request
  logger.logRequest(request);

  // Convert Anthropic format to engine format
  const { messages: messageHistory } = convertMessages(request);

  // Determine workflow mode and process
  let content: ContentBlock[];

  if (workflowMode?.mode === 'passthrough') {
    // Passthrough mode: bypass convertMessages and process()
    // Convert Anthropic messages directly to core Element[] with tool blocks
    const systemPromptText = extractSystemText(request.system);
    const dataElements: Element[] = [];
    // Map tool_use_id → tool name for ToolResultMessageElement
    const toolUseNameMap = new Map<string, string>();

    // First pass: collect tool_use id→name mappings (using both Anthropic and driver IDs)
    for (const msg of request.messages) {
      if (typeof msg.content !== 'string') {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolUseNameMap.set(block.id, block.name);
            const driverId = toolIdMap.get(block.id);
            if (driverId) {
              toolUseNameMap.set(driverId, block.name);
            }
          }
        }
      }
    }

    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        dataElements.push({
          type: 'message',
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      } else {
        const textParts: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            // Resolve Anthropic ID back to driver ID if mapping exists
            const driverId = toolIdMap.get(block.id) || block.id;
            toolCalls.push({
              id: driverId,
              name: block.name,
              arguments: block.input as Record<string, unknown>,
            });
          } else if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : (block.content as Array<{ type: string; text?: string }>)
                  ?.map(c => c.text || '').join('\n') || '';
            dataElements.push({
              type: 'message' as const,
              role: 'tool' as const,
              toolCallId: toolIdMap.get(block.tool_use_id) || block.tool_use_id,
              name: toolUseNameMap.get(block.tool_use_id) || '',
              kind: 'text' as const,
              value: resultContent,
            });
          }
        }

        const textContent = textParts.join('\n');
        if (textContent || toolCalls.length > 0) {
          const element: Element = {
            type: 'message' as const,
            role: msg.role as 'user' | 'assistant',
            content: textContent,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          };
          dataElements.push(element);
        }
      }
    }

    const compiled = {
      instructions: systemPromptText
        ? [{ type: 'section' as const, title: 'System', category: 'instructions' as const, items: [systemPromptText] }]
        : [],
      data: dataElements,
      output: [],
    };

    const result = await passthroughWorkflow(
      aiService,
      compiled,
      request.tools || [],
      engineLogger,
      { mode: 'passthrough', maxTokens: maxTokensConfig },
    );
    content = toContentBlocks(result);
  } else if (request.tools && request.tools.length > 0) {
    // Get system prompt from local files
    const systemPromptText = getSystemPromptText(additionalInstructions);

    // Process with engine (rag or decision mode)
    const mode = modeMap[toolProcessType || DEFAULT_PROCESS_TYPE];
    const result = await engineProcess(
      aiService,
      engineLogger,
      messageHistory,
      request.tools,
      systemPromptText,
      { mode, maxTokens: maxTokensConfig },
    );
    content = toContentBlocks(result);
  } else {
    // No tools: use chat mode
    const systemPromptText = getSystemPromptText(additionalInstructions);
    const result = await engineProcess(
      aiService,
      engineLogger,
      messageHistory,
      [],
      systemPromptText,
      { mode: 'chat' },
    );
    content = toContentBlocks(result);
  }

  const uuid = uuidv4();
  const response: MessagesResponse = {
    id: `msg_${uuid.replace(/-/g, '').substring(0, 24)}`,
    type: 'message',
    role: 'assistant',
    content,
    model: request.model,
    stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: 0,  // TODO: Track token usage across phases
      output_tokens: 0,
    },
  };

  // Log outgoing response
  logger.logResponse(response);

  return response;
}
