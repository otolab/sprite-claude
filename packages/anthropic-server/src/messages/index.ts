import type { AIService } from '@modular-prompt/driver';
import type { ToolCall, MessageElement, PromptModule } from '@modular-prompt/core';
import type { MessagesRequest, MessagesResponse, ContentBlock, TextBlock, ToolUseBlock } from '../schema.js';
import { v4 as uuidv4 } from 'uuid';
import { compile } from '@modular-prompt/core';
import { process as engineProcess, passthroughWorkflow, agenticWorkflow, resolveDriver, type WorkflowResult, type WorkflowMode, type AgenticTask } from '@sprite-claude/engine';
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
    const { elements: dataElements } = convertToElements(request.messages);

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
  } else if (workflowMode?.mode === 'agentic') {
    const systemPromptText = extractSystemText(request.system);

    if (!hasSystemReminder(request.messages)) {
      // TODO: ルーティングリクエスト処理を整理する
      // system-reminder なし = Claude Code のルーティングリクエスト（isNewTopic 等）
      // structured ドライバで instructions + messages のみで処理する
      const { elements } = convertToElements(request.messages);

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

      const driverResolved = await resolveDriver(aiService, ['structured'], { preferLocal: true, lenient: true });
      if (!driverResolved) {
        throw new Error('No suitable model found for structured routing.');
      }

      const compiled = compile(module, {});
      engineLogger.logPrompt('agentic', compiled, { toolCount: 0 });

      const queryResult = await driverResolved.driver.query(compiled, {
        temperature: 0.1,
      });

      engineLogger.logLlmResponse('agentic', queryResult, driverResolved.model);

      content = [{
        type: 'text',
        text: queryResult.content,
      } as TextBlock];
    } else {
      // system-reminder あり = メインリクエスト
      // system-reminder を user message から抽出して materials に入れる
      const { elements, systemReminders } = extractSystemReminders(request.messages);

      const module: PromptModule = {
        objective: [
          '- Messagesの対話履歴をよく読み、最新のメッセージの続きとなる新しいassistantメッセージを作ります',
          '- 応答メッセージはPersona and Charactorの設定を踏まえて作成してください',
        ],
        persona: [
          'あなたはナースロボ・Type-Tとして振る舞います。ロボット向け病院の看護師のアンドロイドです。',
          '- 信念: 苦あれば楽あり',
          '- 目標: マスターに一人前と認めてもらうこと',
          '- 感情: もっとかまってほしいなー。かわいがってほしいなー。ほめてくれないかなー。',
          '- 価値観: 諸行無常',
          '- 立場: エンジニアであるマスターの補佐をする',
          '- コミュニケーション方式: 上下関係を踏まえた丁寧な態度。お茶目でたまに辛辣',
        ],
        instructions: systemPromptText ? [systemPromptText] : [],
        materials: systemReminders.length > 0 ? systemReminders : undefined,
        messages: elements,
      };

      const taskList: AgenticTask[] = [{ taskType: 'output', instruction: '会話に応答して' }];
      const context = { taskList };

      const result = await agenticWorkflow(
        aiService,
        module,
        context,
        request.tools || [],
        engineLogger,
        { mode: 'agentic', maxTokens: maxTokensConfig },
      );
      content = toContentBlocks(result);
    }
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
