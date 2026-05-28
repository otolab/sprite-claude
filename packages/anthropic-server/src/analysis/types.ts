/**
 * Type definitions for extract-log tool
 */

/**
 * Phase types in the processing pipeline
 */
export const PHASES = {
  // Request/Response
  REQUEST: 'request',
  RESPONSE: 'response',

  // RAG-based approach phases
  PHASE1_ANALYSIS: 'phase1-analysis',
  PHASE2_TOOL_GENERATION: 'phase2-tool-generation',
  PHASE2_RESPONSE_GENERATION: 'phase2-response-generation',

  // Decision-based approach phases
  PHASE1_DECISION: 'phase1-decision',
  PHASE2_TOOL_CALL: 'phase2-tool-call',

  // No-tool conversation
  MAIN: 'main',

  // Single-phase workflows
  PASSTHROUGH: 'passthrough',
  CHAT: 'chat',

  // Agentic workflow
  AGENTIC: 'agentic',
} as const;

export type Phase = typeof PHASES[keyof typeof PHASES];

/**
 * Known task types from @modular-prompt/process planning phase.
 * In 0.5.0+, the planner calls these directly as tool names instead of __register_task.
 */
export const TASK_TYPES = ['think', 'act', 'verify', 'extractContext', 'recall', 'determine', 'output'] as const;
export type TaskType = typeof TASK_TYPES[number];

/**
 * Phase descriptions for help messages
 */
export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  [PHASES.REQUEST]: 'Initial API request',
  [PHASES.RESPONSE]: 'Final API response',
  [PHASES.PHASE1_ANALYSIS]: 'RAG-based Phase 1: Analyze user intent and context',
  [PHASES.PHASE2_TOOL_GENERATION]: 'RAG-based Phase 2: Generate tool calls',
  [PHASES.PHASE2_RESPONSE_GENERATION]: 'RAG-based Phase 2: Generate final response',
  [PHASES.PHASE1_DECISION]: 'Decision-based Phase 1: Decide if tool is needed',
  [PHASES.PHASE2_TOOL_CALL]: 'Decision-based Phase 2: Generate structured tool call',
  [PHASES.MAIN]: 'Main conversation (no tools)',
  [PHASES.PASSTHROUGH]: 'Passthrough workflow (single phase, direct API forwarding)',
  [PHASES.CHAT]: 'Chat workflow (single phase, conversational)',
  [PHASES.AGENTIC]: 'Agentic workflow (planning + task execution)',
};

/**
 * Workflow type detected from log entries
 */
export type WorkflowType = 'agentic' | 'passthrough' | 'rag' | 'decision' | 'chat' | 'routing' | 'unknown';

/**
 * Log entry type for JSONL format
 */
export interface LogEntry {
  timestamp: string;
  pid: number;
  seqId: string;
  phase: string;
  type: 'in' | 'out' | 'prompt' | 'llm_response' | 'error' | 'driver_info' | 'task_registration' | 'cache_stats';
  data: any;
}

/**
 * Server log entry type
 */
export interface ServerLogEntry {
  timestamp: string;
  pid: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'startup' | 'config' | 'driver' | 'request' | 'shutdown';
  message: string;
  data?: any;
}

/**
 * Session message summary (for summary command)
 */
export interface SessionMessage {
  seqId: string;
  timestamp: string;
  filename: string;
  workflow: WorkflowType;
  toolCount: number;
  messageCount: number;
  stopReason: string;
  workflowName?: string;
  userMessage: string;
  toolNames?: string[];
  error?: string;
  // Legacy fields for backward compatibility
  phase1Status?: 'success' | 'failed' | 'missing';
  phase1Type?: 'tool' | 'response';
  phase2Status?: 'success' | 'failed' | 'missing';
  phase2Type?: 'tool' | 'response';
  toolName?: string;
}

/**
 * Extracted phase data
 */
export interface PhaseData {
  phase: string;
  prompt?: string;
  output?: any;
}
