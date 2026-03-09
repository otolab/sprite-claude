import type { PromptModule, MessageElement, TextElement } from '@modular-prompt/core';
import type { EngineMessage } from '../types.js';

/**
 * Context for messages module
 */
export interface MessagesContext {
  messages: EngineMessage[];
}

/**
 * Prompt module for formatting messages
 *
 * This module formats messages using mixed MessageElement and TextElement,
 * which the formatter will automatically process into the appropriate format.
 * tool_use and tool_result blocks are rendered as TextElement to avoid pattern mimicry.
 */
export const messagesModule: PromptModule<MessagesContext> = {
  createContext: (): MessagesContext => ({
    messages: [],
  }),

  messages: [
    (ctx): (MessageElement | TextElement)[] | null => {
      if (!ctx.messages || ctx.messages.length === 0) {
        return null;
      }

      // Return mixed MessageElement and TextElement array
      return ctx.messages.map(m => {
        if (m.type === 'text') {
          // TextElement for tool_use and tool_result
          return {
            type: 'text' as const,
            content: m.content
          };
        } else {
          // MessageElement for regular messages
          return {
            type: 'message' as const,
            role: m.role as 'system' | 'assistant' | 'user',
            content: m.content
          };
        }
      });
    }
  ],
};
