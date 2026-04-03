import type { AIService } from '@modular-prompt/driver';
import type { EngineMessage, EngineTool, EngineLogger, ProcessResult, WorkflowOptions } from '../types.js';
import { ragWorkflow } from './rag.js';
import { decisionWorkflow } from './decision.js';
import { chatWorkflow } from './chat.js';

// passthrough は CompiledPrompt を直接受け取るため、
// handleMessages から passthroughWorkflow を直接呼び出す設計。
// このファイルでは rag / decision / chat のみルーティング。

/**
 * Process workflow based on mode (rag / decision / chat)
 *
 * Note: passthrough mode is handled directly by handleMessages
 * because it requires CompiledPrompt with tool-aware MessageElements,
 * bypassing the EngineMessage conversion.
 *
 * @param aiService - AI service for driver selection and creation
 * @param logger - Request logger
 * @param messages - Conversation history
 * @param tools - Available tools
 * @param systemPrompt - System prompt
 * @param options - Workflow options
 * @returns ProcessResult
 */
export async function process(
  aiService: AIService,
  logger: EngineLogger,
  messages: EngineMessage[],
  tools: EngineTool[],
  systemPrompt: string,
  options: WorkflowOptions,
): Promise<ProcessResult> {
  switch (options.mode) {
    case 'rag':
      return ragWorkflow(aiService, messages, tools, systemPrompt, logger, options.maxTokens);
    case 'decision': {
      const result = await decisionWorkflow(aiService, messages, tools, logger, systemPrompt);
      if (result) return result;
      return { type: 'response', text: '' };
    }
    case 'chat':
      return chatWorkflow(aiService, messages, systemPrompt, logger, options);
    default:
      throw new Error(`Unknown workflow mode: ${(options as any).mode}`);
  }
}
