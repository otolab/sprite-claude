import type { AIService } from '@modular-prompt/driver';
import { compile, createContext, merge, type PromptModule } from '@modular-prompt/core';
import type { EngineMessage, EngineLogger, WorkflowResult, WorkflowOptions } from '../types.js';
import { resolveDriver } from '../driver-cache.js';
import { chatModule } from '../prompts/chat-module.js';

/**
 * Create a PromptModule from systemPrompt string
 * @param systemPrompt - System prompt string
 * @returns PromptModule with instructions
 */
function createSystemPromptModule(systemPrompt: string): PromptModule<Record<string, never>> {
  return {
    createContext: () => ({}),
    instructions: systemPrompt ? [systemPrompt] : undefined,
  };
}

/**
 * Chat workflow using simple message-based conversation
 *
 * This workflow:
 * - Merges systemPrompt with chatModule
 * - Compiles messages and systemReminders
 * - Queries the driver
 * - Returns text response
 *
 * @param aiService - AI service for driver selection
 * @param messages - Conversation history
 * @param systemPrompt - System prompt
 * @param logger - Request logger
 * @param options - Workflow options
 * @returns WorkflowResult (text response)
 */
export async function chatWorkflow(
  aiService: AIService,
  messages: EngineMessage[],
  systemPrompt: string,
  logger: EngineLogger,
  options: WorkflowOptions
): Promise<WorkflowResult> {
  // Create systemPrompt module and merge with chatModule
  const systemPromptModule = createSystemPromptModule(systemPrompt);
  const mergedModule = merge(systemPromptModule, chatModule);

  // Create context
  const context = createContext(mergedModule);
  context.messages = messages;
  context.systemReminders = []; // chat workflow does not use systemReminders

  // Compile prompt
  const compiled = compile(mergedModule, context);

  // Resolve driver for chat
  const resolved = await resolveDriver(aiService, [], { preferLocal: true, preferFast: true });
  if (!resolved) {
    throw new Error('No suitable model found for chat.');
  }
  const { driver, model } = resolved;

  // Log prompt
  logger.logPrompt('chat', compiled);

  // Query driver
  const result = await driver.query(compiled, {
    maxTokens: options.maxTokens?.phase2Response ?? 2000,
    temperature: 0.7,
  });

  // Log response
  logger.logLlmResponse('chat', result, model);

  return {
    type: 'response',
    text: result.content || '',
  };
}
