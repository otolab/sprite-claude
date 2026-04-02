import type { QueryResult } from '@modular-prompt/driver';

export interface EngineMessage {
  type: 'message' | 'text';
  role?: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EngineTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type WorkflowResult =
  | { type: 'tool_call'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallResult[]; text?: string }
  | { type: 'response'; text: string };

export type WorkflowMode = 'rag' | 'decision' | 'chat' | 'passthrough' | 'agentic';

export interface WorkflowOptions {
  mode: WorkflowMode;
  maxTokens?: {
    phase1?: number;
    phase2Tool?: number;
    phase2Response?: number;
  };
  /** ログ出力用のデフォルトモデル名（runner.tsが設定） */
  modelName?: string;
}

export interface EngineLogger {
  logPrompt(phase: string, compiled: unknown, metadata?: { toolCount?: number }): void;
  logLlmResponse(phase: string, data: QueryResult, model?: string): void;
  logError(phase: string, message: string, data?: unknown): void;
  logDriverInfo?(phase: string, model: string, capabilities: unknown): void;
}

export interface WorkflowDefinition {
  mode: WorkflowMode;
  models?: Record<string, string | string[]>;
}
