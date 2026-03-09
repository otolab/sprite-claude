import type { PromptModule } from '@modular-prompt/core';
import { messagesModule } from '../messages/messages-module.js';
import { merge } from '@modular-prompt/core';
import type { AnalysisData, ActionDecision, ToolDefinition } from '../types/tools.js';

/**
 * Analysis result structure (Phase 1 output)
 */
export interface AnalysisResult {
  analysis: AnalysisData;
  action: ActionDecision;
}

/**
 * Context for analysis module (Phase 1)
 */
export interface AnalysisContext {
  tools: ToolDefinition[];
}

/**
 * Analysis module (Phase 1)
 *
 * このモジュールは:
 * - 会話履歴全体を分析
 * - ユーザーの意図を理解
 * - 関連情報を抽出
 * - ツール使用の必要性を判断
 */
const analysisModuleBase: PromptModule<AnalysisContext> = {
  createContext: (): AnalysisContext => ({
    tools: [],
  }),

  objective: [
    'Understand user intent from their latest message and determine the appropriate response method (tool call or message).'
  ],

  terms: [
    'Tool Call: An instruction to execute a tool. Also appears as past execution records in conversation history.',
    'Tool Result: The outcome returned by the system after a tool execution. Always follows a Tool Call in conversation history.',
  ],

  instructions: [
    '1. Understand the LATEST message and situation',
    '   - If Tool Result: what happened and whether it fulfills the user\'s intent',
    '   - If User message: what the user wants from conversation context',
    '   - Extract key facts relevant to the situation',
    '2. Determine the action type',
    '   - Choose type "tool_call" when:',
    '     - User message requires functionality from Available Tools list',
    '     - Tool Result shows failure/error that needs retry with corrected parameters',
    '   - Choose type "message" when:',
    '     - Tool Result succeeded or needs user acknowledgment',
    '     - User message can be answered without tools',
    '     - Situation requires user clarification or confirmation',
    '3. Output the analysis result in JSON format',
    '   - Follow the Output Schema below',
    '   - Include a JSON object in a ```json code block that conforms to the schema',
    '   - Only analyze and decide - actual execution happens in the next phase',
  ],

  inputs: [
    (ctx) => {
      if (ctx.tools.length === 0) {
        return {
          type: 'material' as const,
          id: 'available-tools',
          title: 'Available Tools',
          content: 'No tools available'
        };
      }

      const toolSections = ctx.tools.map((tool, index) => {
        const lines = [
          `### Tool ${index + 1}: ${tool.name}`,
          '',
        ];

        // Handle multi-line descriptions
        if (tool.description) {
          const descLines = tool.description.split('\n');
          lines.push('**Description:**');
          descLines.forEach(line => {
            lines.push(line.trim() ? `  ${line.trim()}` : '');
          });
        }

        return lines.join('\n');
      }).join('\n\n');

      return {
        type: 'material' as const,
        id: 'available-tools',
        title: 'Available Tools',
        content: toolSections
      };
    }
  ],

  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          analysis: {
            type: 'object',
            properties: {
              userRequest: {
                type: 'string',
                description: 'The LATEST user message that requires a response'
              },
              userIntent: {
                type: 'string',
                description: 'Clear statement of what the user wants'
              },
              relevantContext: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    text: { type: 'string' },
                  },
                  required: ['label', 'text'],
                },
                description: 'List of conversation messages relevant to the LATEST user message. Copy messages in chronological order. The LATEST user message should be last in the array.'
              },
              keyFacts: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Important facts extracted from conversation'
              }
            },
            required: ['userRequest', 'userIntent', 'relevantContext', 'keyFacts']
          },
          action: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['tool_call', 'message'],
                description: 'Call a tool or send a message'
              },
              toolName: {
                type: 'string',
                description: 'EXACT name of the tool from Available Tools list (required if type is "tool_call"). Use the complete tool name as shown in the list.'
              },
              reasoning: {
                type: 'string',
                description: 'Explanation of why this action was chosen'
              }
            },
            required: ['type', 'reasoning']
          }
        },
        required: ['analysis', 'action']
      }
    }
  ]
};

// Merge with messagesModule to get message formatting
export const analysisModule = merge(messagesModule, analysisModuleBase);
