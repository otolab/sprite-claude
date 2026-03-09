/**
 * Common type definitions for analysis and tool generation modules
 */

/**
 * Relevant context item structure
 * Used in both Phase 1 (analysis output) and Phase 2 (tool generation input)
 */
export interface RelevantContextItem {
  label: string;
  text: string;
}

/**
 * Analysis data structure
 * Contains the core analysis information from Phase 1
 */
export interface AnalysisData {
  userRequest: string;          // 最新のユーザーメッセージ
  userIntent: string;           // ユーザーの意図
  relevantContext: RelevantContextItem[];  // 関連する会話コンテキスト
  keyFacts: string[];          // 抽出した重要な事実
}

/**
 * Action decision from Phase 1
 */
export interface ActionDecision {
  type: 'tool_call' | 'message';   // ツール呼び出し or メッセージ応答
  toolName?: string;                // 使用するツール名（type='tool_call'の場合）
  reasoning: string;                // 判断理由
}

/**
 * Tool input schema structure (JSON Schema)
 */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Tool definition for Phase 2 generation
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema: ToolInputSchema;
}
