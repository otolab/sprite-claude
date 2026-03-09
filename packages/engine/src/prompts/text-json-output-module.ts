import type { PromptModule } from '@modular-prompt/core';

/**
 * Text + JSON Output Format Module
 *
 * このモジュールは、思考プロセスをテキストで説明し、
 * 最終結果を```jsonブロックで出力する形式を定義します。
 *
 * MLX等、structuredOutputをサポートしないドライバー向けの出力形式です。
 */

export interface TextJsonOutputContext {
  // No context needed - this is a pure formatting module
}

export const textJsonOutputModule: PromptModule<TextJsonOutputContext> = {
  createContext: () => ({}),

  terms: [
    '- Output Style: The format for presenting your thinking process and results',
    '  - This module defines text+JSON format: text explanation followed by JSON result',
    '- Section Name: A descriptive header for each stage of thinking',
    '  - For Stage1 (Parameter Analysis): "## Stage1: Parameter Analysis"',
    '  - For Stage2 (Content Generation): "## Stage2: Content Generation"',
    '  - For Stage3 (Final Result): "## Final JSON"',
    '- Write content clearly: When generating content (especially in Stage2), output the generated content explicitly in that section',
    '  - Do not just mark "will generate" - actually write the generated content',
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Output Style',
      items: [
        '- Output a text document explaining your reasoning.',
        '- For each stage of thinking defined below, create a corresponding section:',
        '  - Create a section header (## Section Name)',
        '  - Write your reasoning and decisions for that stage in detail',
        '  - Use clear step labels to explain your thought process',
        '- Execute stages in the order defined below.',
        '- For the final stage that produces the result:',
        '  - Create a section header: ## Final JSON',
        '  - Output the result as a JSON object in a ```json code block',
      ]
    }
  ],
};
