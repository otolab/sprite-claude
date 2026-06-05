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

export type ProcessResult =
  | { type: 'tool_call'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallResult[]; text?: string; thinking?: string }
  | { type: 'response'; text: string; thinking?: string };

export type WorkflowMode = 'rag' | 'decision' | 'chat' | 'passthrough' | 'agentic';

export interface WorkflowOptions {
  mode: WorkflowMode;
  maxTokens?: {
    phase1?: number;
    phase2Tool?: number;
    phase2Response?: number;
  };
  /** ワークフロー定義名（config.yamlのworkflows.xxxのキー名） */
  workflowName?: string;
  /** ログ出力用のデフォルトモデル名（runner.tsが設定） */
  modelName?: string;
  /** ワークフロー全体のタイムアウト（ミリ秒） */
  workflowTimeout?: number;
  /** KVキャッシュ制御。QueryOptions.cacheとしてドライバに伝搬。'read-only'は既存キャッシュを使うが新規作成しない */
  cache?: boolean | 'read-only';
}

import type { QueryResult } from '@modular-prompt/driver';
import type { WorkflowResult as ProcessWorkflowResult } from '@modular-prompt/process';

/** logLlmResponse に渡せるデータ型 */
export type LlmResponseData = QueryResult | Omit<ProcessWorkflowResult<unknown>, 'context'>;

export interface RegisteredTaskInfo {
  name: string;
  taskType: string;
  instruction: string;
  reason?: string;
  driverRole?: string;
}

export interface CacheStats {
  totalQueries: number;
  incremental: number;
  fresh: number;
  totalPromptTokens: number;
  prefillReusedTokens: number;
  cacheGrowthTokens: number;
}

export interface EngineLogger {
  logPrompt(phase: string, compiled: unknown, metadata?: { toolCount?: number }): void;
  logLlmResponse(phase: string, data: LlmResponseData, model?: string): void;
  logError(phase: string, message: string, data?: unknown): void;
  logDriverInfo?(phase: string, model: string, capabilities: unknown): void;
  logTaskRegistration?(phase: string, tasks: RegisteredTaskInfo[]): void;
  logCacheStats?(phase: string, stats: CacheStats | Record<string, CacheStats>): void;
}

export interface WorkflowDefinition {
  mode: WorkflowMode;
  models?: Record<string, string | string[]>;
}
