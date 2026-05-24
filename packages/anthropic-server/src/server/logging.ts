import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MessagesRequest, MessagesResponse } from '../schema.js';
import type { EngineLogger, LlmResponseData, RegisteredTaskInfo } from '@sprite-claude/engine';
import { formatCompletionPrompt } from '@modular-prompt/driver';

/**
 * Log entry type for JSONL format
 */
export interface LogEntry {
  timestamp: string;
  pid: number;
  seqId: string;
  phase: string;
  type: 'in' | 'out' | 'prompt' | 'llm_response' | 'error' | 'driver_info' | 'task_registration';
  // Note: data can be MessagesRequest, MessagesResponse, prompt string, LLM response, etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/**
 * Request logger for managing JSONL log files
 *
 * This class:
 * - Manages a single JSONL file per request
 * - Appends log entries in chronological order
 * - Supports multiple phases (request, response, prompts)
 */
export class RequestLogger {
  private logDir: string;
  private logFilePath: string;
  public readonly pid: number;
  public readonly seqId: string;
  public readonly level: 'none' | 'minimal' | 'full';

  constructor(
    pid: number,
    seqId: string,
    level: 'none' | 'minimal' | 'full'
  ) {
    this.pid = pid;
    this.seqId = seqId;
    this.level = level;

    this.logDir = join(homedir(), '.sprite-claude', 'logs', 'requests');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Create filename: {timestamp}-{pid}-{seqId}.jsonl
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `${timestamp}-${pid}-${seqId}.jsonl`;
    this.logFilePath = join(this.logDir, filename);
  }

  /**
   * Append a log entry to the JSONL file
   */
  private appendLog(entry: LogEntry): void {
    if (this.level === 'none') return;

    try {
      const line = JSON.stringify(entry) + '\n';
      appendFileSync(this.logFilePath, line);
    } catch (error) {
      console.error('Failed to append log entry:', error);
    }
  }

  /**
   * Log request data
   */
  logRequest(data: MessagesRequest): void {
    let content: MessagesRequest | {
      model: string;
      max_tokens?: number;
      temperature?: number;
      message_count: number;
      has_tools: boolean;
      tool_count: number;
    };
    if (this.level === 'minimal') {
      content = {
        model: data.model,
        max_tokens: data.max_tokens,
        temperature: data.temperature,
        message_count: data.messages.length,
        has_tools: !!data.tools && data.tools.length > 0,
        tool_count: data.tools?.length || 0,
      };
    } else {
      content = data;
    }

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase: 'request',
      type: 'in',
      data: content,
    });
  }

  /**
   * Log response data
   */
  logResponse(data: MessagesResponse): void {
    let content: MessagesResponse | {
      id: string;
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
      content_blocks: number;
    };
    if (this.level === 'minimal') {
      content = {
        id: data.id,
        model: data.model,
        stop_reason: data.stop_reason,
        usage: data.usage,
        content_blocks: data.content.length,
      };
    } else {
      content = data;
    }

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase: 'response',
      type: 'out',
      data: content,
    });
  }

  /**
   * Log prompt data
   */
  logPrompt(
    phase: 'phase1-analysis' | 'phase1-decision' | 'phase2-tool-generation' | 'phase2-tool-call' | 'phase2-response-generation' | 'main' | 'chat' | 'passthrough' | 'agentic',
    content: string,
    metadata?: { toolCount?: number },
  ): void {
    if (this.level === 'none') return;

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase,
      type: 'prompt',
      data: { content, ...metadata },
    });
  }

  /**
   * Log LLM response data (for phase1/phase2 outputs)
   */
  logLlmResponse(
    phase: 'phase1-analysis' | 'phase1-decision' | 'phase2-tool-generation' | 'phase2-tool-call' | 'phase2-response-generation' | 'chat' | 'passthrough' | 'agentic',
    data: LlmResponseData,
    model?: string,
  ): void {
    if (this.level === 'none') return;

    let content: Record<string, unknown>;
    if (this.level === 'minimal') {
      const textContent = 'content' in data ? data.content : 'output' in data ? data.output : '';
      content = {
        hasContent: !!textContent,
        contentLength: textContent?.length || 0,
      };
    } else {
      content = { ...data } as Record<string, unknown>;
    }

    if (model) {
      content.model = model;
    }

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase,
      type: 'llm_response',
      data: content,
    });
  }

  /**
   * Log error data
   */
  logError(
    phase: 'phase1-analysis' | 'phase1-decision' | 'phase2-tool-generation' | 'phase2-tool-call' | 'phase2-response-generation' | 'chat' | 'passthrough' | 'agentic',
    message: string,
    data?: any,
  ): void {
    if (this.level === 'none') return;

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase,
      type: 'error',
      data: { message, ...(data || {}) },
    });
  }

  /**
   * Log task registration from planning phase
   */
  logTaskRegistration(
    phase: string,
    tasks: RegisteredTaskInfo[],
  ): void {
    if (this.level === 'none') return;

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase,
      type: 'task_registration',
      data: { taskCount: tasks.length, tasks },
    });
  }

  /**
   * Log driver/model selection info
   */
  logDriverInfo(
    phase: string,
    model: string,
    capabilities: unknown,
  ): void {
    if (this.level === 'none') return;

    this.appendLog({
      timestamp: new Date().toISOString(),
      pid: this.pid,
      seqId: this.seqId,
      phase,
      type: 'driver_info',
      data: { model, ...(capabilities as Record<string, unknown> || {}) },
    });
  }
}

/**
 * Global request counter for generating sequential IDs
 */
const globalRequestCounter = new Map<number, number>();

/**
 * Create a new RequestLogger instance with auto-incrementing sequence ID
 */
export function createRequestLogger(
  pid: number,
  level: 'none' | 'minimal' | 'full'
): RequestLogger {
  const currentCount = globalRequestCounter.get(pid) || 0;
  const nextCount = currentCount + 1;
  globalRequestCounter.set(pid, nextCount);

  const seqId = String(nextCount).padStart(4, '0');
  return new RequestLogger(pid, seqId, level);
}

/**
 * Convert RequestLogger to EngineLogger
 * @param requestLogger - Request logger for per-request JSONL logs
 * @param serverLogger - Optional server logger for lifecycle events (driver info etc.)
 */
export function toEngineLogger(requestLogger: RequestLogger, serverLogger?: ServerLogger): EngineLogger {
  return {
    logPrompt(phase, compiled, metadata) {
      // compiled は @modular-prompt/core の CompiledPrompt オブジェクト
      const text = formatCompletionPrompt(compiled as any);
      requestLogger.logPrompt(phase as any, text, metadata);
    },
    logLlmResponse(phase, data, model) {
      requestLogger.logLlmResponse(phase as any, data as any, model);
    },
    logError(phase, message, data) {
      requestLogger.logError(phase as any, message, data);
    },
    logDriverInfo(phase, model, capabilities) {
      serverLogger?.info('driver', `Model capabilities: ${model}`, capabilities);
      requestLogger.logDriverInfo(phase, model, capabilities);
    },
    logTaskRegistration(phase, tasks) {
      requestLogger.logTaskRegistration(phase, tasks);
    },
  };
}

/**
 * Server log entry for JSONL format
 */
export interface ServerLogEntry {
  timestamp: string;
  pid: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'startup' | 'config' | 'driver' | 'request' | 'shutdown';
  message: string;
  data?: any;
}

type ServerLogLevel = ServerLogEntry['level'];
type ServerLogCategory = ServerLogEntry['category'];

/**
 * Server logger for lifecycle events
 * Writes to ~/.sprite-claude/logs/server-{pid}.jsonl
 */
export class ServerLogger {
  private logFilePath: string;
  private pid: number;

  constructor(pid: number) {
    this.pid = pid;
    const logDir = join(homedir(), '.sprite-claude', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = join(logDir, `server-${pid}.jsonl`);
  }

  log(level: ServerLogLevel, category: ServerLogCategory, message: string, data?: any): void {
    const entry: ServerLogEntry = {
      timestamp: new Date().toISOString(),
      pid: this.pid,
      level,
      category,
      message,
      ...(data !== undefined && { data }),
    };
    try {
      appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n');
    } catch (error) {
      // Last resort: use console.error since logger itself failed
      console.error('Failed to write server log:', error);
    }
  }

  info(category: ServerLogCategory, message: string, data?: any): void {
    this.log('info', category, message, data);
  }

  warn(category: ServerLogCategory, message: string, data?: any): void {
    this.log('warn', category, message, data);
  }

  error(category: ServerLogCategory, message: string, data?: any): void {
    this.log('error', category, message, data);
  }
}

/**
 * Create a server logger instance
 */
export function createServerLogger(pid: number): ServerLogger {
  return new ServerLogger(pid);
}

