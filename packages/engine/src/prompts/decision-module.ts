import type { PromptModule } from '@modular-prompt/core';
import { messagesModule, type MessagesContext } from '../messages/messages-module.js';
import { merge } from '@modular-prompt/core';

/**
 * Context for tool decision (Phase 1)
 */
export interface ToolDecisionContext extends MessagesContext {
  userMessage: string;
  availableTools: string;
  additionalInstructions?: string;
}

/**
 * Prompt module for deciding whether to use a tool (Phase 1)
 *
 * This module:
 * - Analyzes user message and conversation history (via messagesModule)
 * - Considers available tools (name + description only)
 * - Decides if a tool is needed for the request
 */
const toolDecisionModuleBase: PromptModule<ToolDecisionContext> = {
  createContext: (): ToolDecisionContext => ({
    messages: [],
    userMessage: '',
    availableTools: '',
    additionalInstructions: undefined,
  }),
  instructions: [
    'You are an AI assistant that can use tools to help users.',
    'When a tool is available that can provide accurate, real-time, or computed information, prefer using it.',
    'For example: use get_weather for weather queries, use calculate for mathematical computations.',
    'However, only use tools when they are directly relevant to answering the user\'s question.',
    'For general knowledge, creative tasks, or casual conversation, you can answer directly without tools.',
    '',
    'Think step by step:',
    '1. What is the user asking for?',
    '2. Is this a request for real-time data, calculations, or external information?',
    '3. Check if any available tool is specifically designed for this type of request.',
    '4. If a tool is directly relevant, use it. Otherwise, provide a direct answer.',
    {
      type: 'subsection',
      title: 'Available Tools',
      items: [(ctx) => ctx.availableTools]
    },
    (ctx) => ctx.additionalInstructions || '',
  ],
  cue: [
    (ctx) => `User: ${ctx.userMessage}`,
    '',
    'Response:'
  ]
};

// Merge with messagesModule to get message formatting
export const toolDecisionModule = merge(messagesModule, toolDecisionModuleBase);
