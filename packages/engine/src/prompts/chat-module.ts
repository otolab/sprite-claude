import type { PromptModule } from '@modular-prompt/core';
import { messagesModule, type MessagesContext } from '../messages/messages-module.js';
import { merge } from '@modular-prompt/core';

/**
 * Chat context for the conversation module
 */
export interface ChatContext extends MessagesContext {
  systemReminders: string[];
}

/**
 * Prompt module for chat-style conversations
 *
 * This module:
 * - Uses messagesModule for message formatting
 * - Adds system reminders as materials
 * - Provides assistant cue
 */
const chatModuleBase: PromptModule<ChatContext> = {
  createContext: (): ChatContext => ({
    messages: [],
    systemReminders: [],
  }),

  materials: [
    (ctx: ChatContext) => {
      if (ctx.systemReminders.length === 0) {
        return null;
      }

      return [
        'The following materials are automatically extracted from the conversation context:',
        '',
        ...ctx.systemReminders.map((reminder: string) => `<system-reminder>\n${reminder}\n</system-reminder>`)
      ];
    }
  ],
};

// Merge with messagesModule to get message formatting
export const chatModule = merge(messagesModule, chatModuleBase);
