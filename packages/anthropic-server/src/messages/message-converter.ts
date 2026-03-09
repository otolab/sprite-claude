import type { MessagesRequest, TextBlock } from '../schema.js';

export interface ConvertedMessage {
  type: 'message' | 'text';
  role?: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Convert Anthropic Messages API format to internal format
 *
 * This function:
 * - Extracts <system-reminder> tags from user messages
 * - Extracts text content from messages (tool_use/tool_result blocks are skipped)
 * - Returns system reminders and element array
 *
 * @param request - Anthropic Messages API request
 * @returns Converted element array and system reminders
 */
export function convertMessages(
  request: MessagesRequest
): {
  systemReminders: string[];
  messages: ConvertedMessage[];
} {
  const messages: ConvertedMessage[] = [];
  const systemReminders: string[] = [];

  // Convert messages - allow consecutive messages with same role
  for (const msg of request.messages) {
    let content = '';
    const textParts: string[] = [];

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          const text = (block as TextBlock).text;

          // Extract <system-reminder> tags from user messages
          if (msg.role === 'user') {
            const reminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
            let match;
            let lastIndex = 0;
            let hasReminders = false;

            while ((match = reminderRegex.exec(text)) !== null) {
              hasReminders = true;
              // Add text before this reminder
              if (match.index > lastIndex) {
                textParts.push(text.substring(lastIndex, match.index));
              }
              // Store the reminder
              systemReminders.push(match[1].trim());
              lastIndex = match.index + match[0].length;
            }

            // Add remaining text after last reminder
            if (hasReminders) {
              if (lastIndex < text.length) {
                textParts.push(text.substring(lastIndex));
              }
            } else {
              textParts.push(text);
            }
          } else {
            textParts.push(text);
          }
        }
        // tool_use / tool_result blocks are skipped
        // Tools are passed separately via QueryOptions.tools
      }
      content = textParts.filter(text => text.length > 0).join('\n');
    }

    // Add message element if it has text content
    if (content && content.trim().length > 0) {
      messages.push({
        type: 'message',
        role: msg.role as 'user' | 'assistant',
        content: content.trim(),
      });
    }
  }

  return {
    systemReminders,
    messages,
  };
}
