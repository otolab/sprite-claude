import type { PromptModule } from '@modular-prompt/core';
import type { AnalysisResult } from './analysis-module.js';
import type { RelevantContextItem, ToolDefinition } from '../types/tools.js';

/**
 * Context for tool generation (Phase 2 - Tool path)
 */
export interface ToolGenerationContext {
  analysisResult: AnalysisResult;
  relevantContext: RelevantContextItem[];  // 関連する会話コンテキスト
  toolDefinition: ToolDefinition;
}

/**
 * Tool generation module (Phase 2 - Tool path)
 *
 * Phase 1の分析結果に基づいてツール呼び出しパラメータを生成
 */
export const toolGenerationModule: PromptModule<ToolGenerationContext> = {
  createContext: (): ToolGenerationContext => ({
    analysisResult: {
      analysis: {
        userRequest: '',
        userIntent: '',
        relevantContext: [],
        keyFacts: [],
      },
      action: {
        type: 'tool_call',
        reasoning: '',
      },
    },
    relevantContext: [],
    toolDefinition: {
      name: '',
      description: '',
      input_schema: {
        type: 'object',
      },
    },
  }),

  objective: [
    '- Your objective is to fulfill the user\'s request by calling the appropriate tool.',
    '- This is the output generation phase, which builds upon the results from a previous analysis phase.',
    '- Follow the instructions below to analyze the context, explain your decisions, and finally output the JSON object.',
  ],

  terms: [
    '- Phase: The overall processing (Phase1 = Analysis, Phase2 = This prompt)',
    '- Stage: Major sections within this prompt (Stage1, Stage2, Stage3)',
    '- Step: Individual actions within a Stage',
    '- DEFAULT: A conceptual value representing "use the built-in behavior for this parameter".',
    '  - In JSON output, this is expressed by omitting the parameter key entirely. (Note: JSON cannot directly express "use default" - the only way is to omit the parameter)',
    '- Analysis Result: Pre-analyzed context information from Phase1',
    '  - User Intent: What the user wants to accomplish',
    '  - Key Facts: Important information from the conversation',
    '  - Reasoning: Why the selected tool is appropriate',
    '- Relevant Context: Related messages and context',
    '- Tool Call: A record in the conversation history where the assistant called a tool. Format: [Assistant called the xxx tool (...)]',
    '- Tool Result: A record in the conversation history where the system returned the result of a tool execution. Format: [Tool result from xxx: ...]',
  ],

  instructions: [
    '- Output text document, three sections: "## Parameter Approach Decisions", "## Generated Content", and "## Final JSON".',
    '- Execute each stage in order to produce the corresponding section.',
    '- IMPORTANT: For each stage/step below, explain your reasoning and decisions in detail with clear step labels.',
    {
      type: 'subsection',
      title: 'Stage1: Parameter Analysis Steps',
      items: [
        'IMPORTANT: For each step/parameter below, explain your reasoning and decisions in detail with clear step labels.',
        '',
        'Do NOT output JSON at this stage.',
        '',
        '1. Understand the "Tool Parameters".',
        '  - For each parameter, explain:',
        '    - The meaning of this parameter',
        '    - Whether it is required or optional',
        '    - Its DEFAULT behavior (if optional)',
        '  - Note: Examples shown are NOT values to use.',
        '2. Decide the approach for each parameter.',
        '  - For each parameter, examine the tool definition and overall context.',
        '    - Check the "Data" section: "Analysis Result" and "Relevant Context"',
        '    - Distinguish between actual values and requests/instructions',
        '  - IMPORTANT: User intent is often ambiguous about specific values.',
        '    - Users often specify constraints (WHY NOT: what to avoid) but not concrete values (WHAT exactly).',
        '    - Focus on what is NOT specified, not what must be specified.',
        '    - When user provides constraints without concrete values, use "Generate content".',
        '  - Different parameters require different approaches to determine their values:',
        '    - Pick up value:',
        '      - Use when the actual concrete value is directly stated',
        '      - If you see only a task or instruction without the actual value, use a different approach',
        '    - Select options:',
        '      - Use if choosing from predefined choices',
        '    - Use DEFAULT:',
        '      - Use for optional parameters when user did not mention this aspect at all',
        '    - Generate content:',
        '      - Use when user gives ambiguous instructions that require you to create the specific value',
        '      - IMPORTANT: Only mark for generation, do NOT create content yet',
        '      - Content will be created in Stage2',
      ]
    },
    {
      type: 'subsection',
      title: 'Stage2: Content Generation',
      items: [
        '- Generate content if required.',
        '- This stage requires your creativity.',
        '- Write the generated content clearly in this section',
        '',
        'For each parameter where you chose "Generate content" in Stage1, follow these steps:',
        '1. Understand what needs to be created (the content type for this parameter)',
        '2. Understand what the user is requesting (from User Intent and context)',
        '3. Determine the appropriate direction or tone for the content',
        '4. Generate the actual content',
      ]
    },
    {
      type: 'subsection',
      title: 'Stage3: Final JSON Generation Steps',
      items: [
        'IMPORTANT: For each step below, explain your reasoning and decisions in detail with clear step labels.',
        '',
        '1. Use the results from Parameter Analysis and Content Generation.',
        '2. For parameters using DEFAULT:',
        '  - You MUST drop the parameter entirely (omit both key and value)',
        '  - To represent DEFAULT, output nothing for that parameter',
        '3. Output the final JSON according to "Final Output Schema" below',
        '  - Include only parameters with specific values',
        '    - if "key: DEFAULT" then you must omit \'key\' parameter.',
        '  - If all parameters use DEFAULT, output an empty object `{}`',
      ]
    }
  ],

  inputs: [
    (ctx) => {
      const toolName = ctx.toolDefinition.name;
      const description = ctx.toolDefinition.description;
      const inputSchema = ctx.toolDefinition.input_schema;
      const properties = inputSchema.properties || {};
      const required = inputSchema.required || [];

      const lines = [
        `Function: ${description}`,
        '',
        'Parameters:',
      ];

      for (const [key, value] of Object.entries(properties)) {
        const prop = value as { description?: string };
        const isRequired = required.includes(key);
        const optionalMarker = isRequired ? 'REQUIRED' : 'OPTIONAL';
        const desc = prop.description || '';
        lines.push(`- ${key}:`);
        lines.push(`  - (${optionalMarker}) ${desc}`);
      }

      return {
        type: 'material' as const,
        id: `tool-params-${toolName}`,
        title: `Tool Parameters: ${toolName}`,
        content: lines.join('\n')
      };
    }
  ],

  materials: [
    {
      type: 'subsection',
      title: 'Analysis Result',
      items: [
        (ctx: ToolGenerationContext) => {
          return [
            `User Intent:`,
            ...ctx.analysisResult.analysis.userIntent
              .split('\n').map((l: string) => `> ${l}`)
          ];
        },
        '',
        (ctx: ToolGenerationContext) => {
          const facts = ctx.analysisResult.analysis.keyFacts;
          return (facts.length <= 0) ? null : [
            `Key Facts:`,
            ...facts.map((f: string) => `- ${f}`),
          ]
        },
        '',
        (ctx: ToolGenerationContext) => {
          return [
            `Reasoning:`,
            ...ctx.analysisResult.action.reasoning
              .split('\n').map((l: string) => `> ${l}`),
          ];
        },
      ],
    },
    {
      type: 'subsection',
      title: 'Relevant Context',
      items: [
        (ctx: ToolGenerationContext) => {
          return ctx.relevantContext.map((rel) => {
            const { label, text } = rel;
            const formattedText = text.split('\n').map((l: string) => `> ${l}`).join('\n');
            return `${label}:\n${formattedText}`;
          }).join('\n\n')
        }
      ]
    }
  ],

  schema: [
    (ctx) => {
      const inputSchema = ctx.toolDefinition.input_schema;
      const properties = inputSchema.properties || {};
      const required = inputSchema.required || [];

      // Add (optional) marker to optional parameters and nullable: false
      const annotatedProperties = Object.entries(properties).reduce((acc, [key, value]) => {
        const prop = value as { description?: string; type?: string | string[]; [key: string]: unknown };
        const isRequired = required.includes(key);

        // Check if the type already allows null (e.g., type: ['string', 'null'])
        const typeAllowsNull = Array.isArray(prop.type) && prop.type.includes('null');

        acc[key] = {
          ...prop,
          description: isRequired ? '(required)' : '(optional)',
          nullable: typeAllowsNull ? true : false
        };
        return acc;
      }, {} as Record<string, unknown>);

      return {
        type: 'json',
        content: {
          type: 'object',
          description: `Input parameters for ${ctx.toolDefinition.name}`,
          properties: annotatedProperties,
          required: required,
          additionalProperties: false
        }
      };
    }
  ]
  // No cue section - auto-generated from schema
};

/**
 * Context for response generation (Phase 2 - Response path)
 */
export interface ResponseGenerationContext {
  analysisResult: AnalysisResult;
  relevantContext: RelevantContextItem[];  // Phase 1で抽出された関連コンテキスト
  systemPrompt?: string;
}

/**
 * Response generation module (Phase 2 - Response path)
 *
 * Phase 1の分析結果に基づいて通常応答を生成
 */
export const responseGenerationModule: PromptModule<ResponseGenerationContext> = {
  createContext: (): ResponseGenerationContext => ({
    analysisResult: {
      analysis: {
        userRequest: '',
        userIntent: '',
        relevantContext: [],
        keyFacts: [],
      },
      action: {
        type: 'message',
        reasoning: '',
      },
    },
    relevantContext: [],
  }),

  objective: [
    (ctx) => ctx.systemPrompt || 'You are a helpful AI assistant.'
  ],

  terms: [
    '- Tool Call: A record in the conversation history where the assistant called a tool. Format: [Assistant called the xxx tool (...)]',
    '- Tool Result: A record in the conversation history where the system returned the result of a tool execution. Format: [Tool result from xxx: ...]',
  ],

  materials: [
    {
      type: 'subsection',
      title: 'Analysis Result',
      items: [
        (ctx) => `User Intent: ${ctx.analysisResult.analysis.userIntent}`,
        (ctx) => {
          const facts = ctx.analysisResult.analysis.keyFacts;
          return facts.length > 0
            ? `Key Facts:\n${facts.map((f: string) => `- ${f}`).join('\n')}`
            : null;
        },
      ]
    },
    {
      type: 'subsection',
      title: 'Relevant Context',
      items: [
        (ctx: ResponseGenerationContext) => ctx.relevantContext.length > 0
          ? ctx.relevantContext.map((rel) => `${rel.label}:\n${rel.text}`).join('\n\n')
          : null
      ]
    }
  ],
};
