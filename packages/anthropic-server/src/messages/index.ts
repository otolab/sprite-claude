import type { AIService } from '@modular-prompt/driver';
import type { ToolCall, MessageElement, PromptModule } from '@modular-prompt/core';
import type { MessagesRequest, MessagesResponse, ContentBlock, TextBlock, ToolUseBlock } from '../schema.js';
import { v4 as uuidv4 } from 'uuid';
import { runWorkflow, type WorkflowDefinition, type ProcessResult, type AgenticTask } from '@sprite-claude/engine';
import { createRequestLogger, toEngineLogger, type ServerLogger } from '../server/logging.js';
import { loadPromptModules } from './system-prompt.js';
import type { AnthropicServerOptions } from '../server/types.js';
import type { PromptModuleDefinition } from '../server/config.js';

export type MaxTokensConfig = AnthropicServerOptions['maxTokens'];

/**
 * Glob-style pattern matching for model names.
 * Supports: prefix* | *suffix | *contains* | exact
 */
function globMatch(pattern: string, value: string): boolean {
  const startsWithWild = pattern.startsWith('*');
  const endsWithWild = pattern.endsWith('*');
  if (startsWithWild && endsWithWild) {
    return value.includes(pattern.slice(1, -1));
  }
  if (endsWithWild) {
    return value.startsWith(pattern.slice(0, -1));
  }
  if (startsWithWild) {
    return value.endsWith(pattern.slice(1));
  }
  return value === pattern;
}

/**
 * Resolve model name to workflow name via modelMapping.
 * Tries exact match first, then glob patterns.
 */
function resolveModelMapping(
  requestModel: string,
  modelMapping?: Record<string, string>,
): string {
  if (!modelMapping) return 'default';
  // Exact match first
  if (modelMapping[requestModel]) return modelMapping[requestModel];
  // Glob pattern match (first match wins)
  for (const [pattern, workflow] of Object.entries(modelMapping)) {
    if (pattern.includes('*') && globMatch(pattern, requestModel)) {
      return workflow;
    }
  }
  return 'default';
}

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

function toContentBlocks(result: ProcessResult): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (result.type === 'tool_calls') {
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
  blocks.push({
    type: 'text',
    text: result.text,
  } as TextBlock);
  return blocks;
}

/**
 * Extract text from request.system field
 */
function extractSystemText(system: MessagesRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map(block => block.text).join('\n');
}

const SYSTEM_REMINDER_REGEX = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;

/**
 * Check if messages contain <system-reminder> tags
 */
function hasSystemReminder(messages: MessagesRequest['messages']): boolean {
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      if (SYSTEM_REMINDER_REGEX.test(msg.content)) {
        SYSTEM_REMINDER_REGEX.lastIndex = 0;
        return true;
      }
    } else {
      for (const block of msg.content) {
        if (block.type === 'text' && SYSTEM_REMINDER_REGEX.test(block.text)) {
          SYSTEM_REMINDER_REGEX.lastIndex = 0;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Extract <system-reminder> content from messages and return cleaned elements.
 * system-reminder tags are removed from message text and collected separately.
 */
function extractSystemReminders(messages: MessagesRequest['messages']): {
  elements: MessageElement[];
  systemReminders: string[];
  toolUseNameMap: Map<string, string>;
} {
  const { elements: rawElements, toolUseNameMap } = convertToElements(messages);
  const systemReminders: string[] = [];
  const elements: MessageElement[] = [];

  for (const el of rawElements) {
    if (el.type === 'message' && 'content' in el && typeof el.content === 'string' && el.role === 'user') {
      let text = el.content;
      const regex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
      let match;
      const parts: string[] = [];
      let lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }
        systemReminders.push(match[1].trim());
        lastIndex = match.index + match[0].length;
      }
      if (parts.length > 0 || lastIndex > 0) {
        if (lastIndex < text.length) {
          parts.push(text.substring(lastIndex));
        }
        const cleaned = parts.join('').trim();
        if (cleaned) {
          elements.push({ ...el, content: cleaned });
        }
      } else {
        elements.push(el);
      }
    } else {
      elements.push(el);
    }
  }

  return { elements, systemReminders, toolUseNameMap };
}

/**
 * Convert Anthropic messages to core MessageElement[] with tool blocks.
 * Shared by passthrough and agentic workflows.
 */
function convertToElements(messages: MessagesRequest['messages']): {
  elements: MessageElement[];
  toolUseNameMap: Map<string, string>;
} {
  const elements: MessageElement[] = [];
  const toolUseNameMap = new Map<string, string>();

  // First pass: collect tool_use id→name mappings (using both Anthropic and driver IDs)
  for (const msg of messages) {
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

  // Second pass: convert to elements
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      elements.push({
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
          elements.push({
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
        const element: MessageElement = {
          type: 'message' as const,
          role: msg.role as 'user' | 'assistant',
          content: textContent,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        elements.push(element);
      }
    }
  }

  return { elements, toolUseNameMap };
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
  promptSpecs?: Record<string, Array<string | PromptModuleDefinition>>,
  maxTokensConfig?: MaxTokensConfig,
  pid?: number,
  _reqId?: string,
  logLevel?: 'none' | 'minimal' | 'full',
  workflows?: Record<string, WorkflowDefinition>,
  modelMapping?: Record<string, string>,
  routingWorkflowKey?: string,
  serverLogger?: ServerLogger,
  configDir?: string,
  workflowTimeout?: number,
): Promise<MessagesResponse> {
  // Create request logger
  const logger = createRequestLogger(pid || process.pid, logLevel || 'full');
  const engineLogger = toEngineLogger(logger, serverLogger);

  // Log incoming request
  logger.logRequest(request);

  // Workflow resolution helper
  function resolveWorkflowDef(
    requestModel: string,
    isRouting: boolean,
    workflows?: Record<string, WorkflowDefinition>,
    modelMapping?: Record<string, string>,
    routingWfKey?: string,
  ): { def: WorkflowDefinition; name: string } {
    if (isRouting && routingWfKey && workflows?.[routingWfKey]) {
      return { def: workflows[routingWfKey], name: routingWfKey };
    }
    const name = resolveModelMapping(requestModel, modelMapping);
    return { def: workflows?.[name] || { mode: 'agentic' }, name };
  }

  // Determine workflow mode and process
  let content: ContentBlock[];

  const isRouting = !hasSystemReminder(request.messages);
  const { def: wfDef, name: wfName } = resolveWorkflowDef(request.model, isRouting, workflows, modelMapping, routingWorkflowKey);

  if (isRouting) {
    // ルーティングリクエスト（system-reminderなし）
    const { elements } = convertToElements(request.messages);
    const systemPromptText = extractSystemText(request.system);

    const module: PromptModule = {
      instructions: systemPromptText ? [systemPromptText] : [],
      messages: elements,
      schema: [{
        type: 'json' as const,
        content: {
          type: 'object',
          properties: {
            isNewTopic: { type: 'boolean' },
            title: { type: ['string', 'null'] },
          },
          required: ['isNewTopic', 'title'],
        },
      }],
    };

    const result = await runWorkflow(wfDef, aiService, module, {}, [], engineLogger,
      { mode: wfDef.mode, workflowName: wfName, maxTokens: maxTokensConfig, workflowTimeout });

    content = [{
      type: 'text',
      text: typeof result === 'object' && result.type === 'response' ? result.text : '',
    } as TextBlock];
  } else {
    // メインリクエスト
    const systemPromptText = extractSystemText(request.system);
    const { elements, systemReminders } = extractSystemReminders(request.messages);

    const agenticPrompts = promptSpecs?.agentic;
    let module: PromptModule;

    if (agenticPrompts) {
      const baseModule = loadPromptModules(agenticPrompts, configDir);
      module = {
        ...baseModule,
        materials: systemReminders.length > 0 ? systemReminders : undefined,
        messages: elements,
      };
    } else {
      module = {
        objective: [
          '- Messagesの対話履歴をよく読み、最新のメッセージの続きとなる新しいassistantメッセージを作ります',
        ],
        instructions: systemPromptText ? [systemPromptText] : [],
        materials: systemReminders.length > 0 ? systemReminders : undefined,
        messages: elements,
      };
    }

    const taskList: AgenticTask[] = [{ taskType: 'output', instruction: '会話に応答して' }];
    const context = { taskList };

    const result = await runWorkflow(wfDef, aiService, module, context,
      request.tools || [], engineLogger,
      { mode: wfDef.mode, workflowName: wfName, maxTokens: maxTokensConfig, workflowTimeout });
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
