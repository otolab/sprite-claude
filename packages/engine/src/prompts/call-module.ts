import type { PromptModule } from '@modular-prompt/core';

/**
 * Context for tool call generation (Phase 2)
 */
export interface ToolCallContext {
  toolDecision: string;
  toolDefinitions: string;
  additionalInstructions?: string;
}

/**
 * Prompt module for generating tool calls (Phase 2)
 *
 * This module:
 * - Takes the decision from Phase 1
 * - Uses full tool definitions with parameter schemas
 * - Generates structured JSON tool call
 */
export const toolCallModule: PromptModule<ToolCallContext> = {
  createContext: (): ToolCallContext => ({
    toolDecision: '',
    toolDefinitions: '',
    additionalInstructions: undefined,
  }),
  instructions: [
    'Based on the analysis, generate a tool call in JSON format.',
    'IMPORTANT: Use EXACT parameter names from the tool schema.',
    'REQUIRED parameters MUST be included.',
    'Do NOT use parameters that are not in the schema.',
    'Output ONLY valid JSON, nothing else.',
    '',
    'Generate tool call JSON with correct parameter names.',
    {
      type: 'subsection',
      title: 'Available Tools',
      items: [(ctx) => ctx.toolDefinitions]
    },
    (ctx) => ctx.additionalInstructions || '',
  ],
  cue: [
    (ctx) => `Analysis:\n${ctx.toolDecision}`,
    '',
    'Tool call JSON:'
  ],
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          use_tool: {
            type: 'boolean',
            description: 'Whether to use a tool or not'
          },
          tool_name: {
            type: 'string',
            description: 'The name of the tool to use (required if use_tool is true)'
          },
          tool_input: {
            type: 'object',
            description: 'The input parameters for the tool (required if use_tool is true)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation of the decision'
          }
        },
        required: ['use_tool', 'reasoning']
      }
    }
  ]
};
