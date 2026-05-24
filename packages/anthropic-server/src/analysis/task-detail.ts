/**
 * Task planning and execution detail extraction and display
 *
 * Extracts workflow task information from log entries:
 * - task_registration entries: planned tasks from agentic planner
 * - llm_response executionLog: actual execution results
 *
 * Designed to support multiple workflow patterns:
 * - Agentic: planning → task execution → output
 * - 2-phase: analysis → generation (future)
 * - Tool loop: iterative tool execution (future)
 */
import type { LogEntry, WorkflowType } from './types.js';
import { PHASES, TASK_TYPES } from './types.js';
import { parseLogFile } from './log-reader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlannedTask {
  name?: string;
  taskType?: string;
  instruction?: string;
  reason?: string;
  driverRole?: string;
}

interface ExecutionStep {
  taskType: string;
  taskName?: string;
  instruction?: string;
  result?: string;
  toolCallLog?: { name: string; arguments?: any }[];
  pendingToolCalls?: { name: string; id?: string }[];
}

interface DriverInfo {
  model?: string;
  models?: Record<string, string>;
}

export interface TaskOverview {
  seqId: string;
  workflow: WorkflowType;
  userMessage: string;
  plan: PlannedTask[];
  execution: ExecutionStep[];
  stopReason: string;
  taskTypeCounts?: Record<string, number>;
  driverInfo?: DriverInfo;
  /** seqId of the continuation request (after tool_use suspension) */
  continuationSeqId?: string;
  /** seqId of the request this continues from */
  continuesFrom?: string;
}

export interface TaskDetail {
  seqId: string;
  workflow: WorkflowType;
  userMessage: string;
  plan: PlannedTask[];
  execution: ExecutionStep[];
  stopReason: string;
  taskTypeCounts?: Record<string, number>;
  driverInfo?: DriverInfo;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function detectWorkflow(entries: LogEntry[], requestData: any): WorkflowType {
  if (entries.some(e => e.phase === PHASES.AGENTIC)) {
    const tools = requestData?.tools?.length || 0;
    if (tools === 0) return 'routing';
    return 'agentic';
  }
  if (entries.some(e => e.phase === PHASES.PASSTHROUGH)) return 'passthrough';
  if (entries.some(e => e.phase === PHASES.PHASE1_ANALYSIS)) return 'rag';
  if (entries.some(e => e.phase === PHASES.PHASE1_DECISION)) return 'decision';
  if (entries.some(e => e.phase === PHASES.CHAT)) return 'chat';
  return 'unknown';
}

function extractUserMessage(requestData: any): string {
  const messages = requestData?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    if (typeof msg.content === 'string') {
      const cleaned = msg.content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (cleaned) return cleaned;
    } else if (Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j];
        if (block.type === 'text') {
          const cleaned = block.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          if (cleaned) return cleaned;
        }
      }
    }
  }

  // Check if last message is tool_result
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'user') {
    const content = lastMsg.content;
    if (Array.isArray(content) && content.every((b: any) => b.type === 'tool_result')) {
      return '(tool_result)';
    }
  }
  return '';
}

function extractPlannedTasks(entries: LogEntry[]): PlannedTask[] {
  // 1. 旧形式: task_registration エントリ（process <0.5.0, __register_task 経由）
  const taskRegEntry = entries.find(e => e.type === 'task_registration');
  if (taskRegEntry) {
    return taskRegEntry.data?.tasks || [];
  }

  // 2. 新形式: planning タスクの toolCallLog からタスクタイプ名の tool call を抽出
  //    process 0.5.0+ では planner が think(), act(), output() 等を直接呼び出す
  const llmResponse = entries.find(e => e.type === 'llm_response');
  const executionLog = llmResponse?.data?.executionLog;
  if (executionLog) {
    const taskCalls = (executionLog as any[])
      .filter((e: any) => e.taskType === 'planning')
      .flatMap((e: any) => e.toolCallLog || [])
      .filter((tc: any) => (TASK_TYPES as readonly string[]).includes(tc.name));
    if (taskCalls.length > 0) {
      return taskCalls.map((tc: any) => ({
        taskType: tc.name,
        name: tc.arguments?.name,
        instruction: tc.arguments?.instruction,
        reason: tc.arguments?.reason,
        driverRole: tc.arguments?.driverRole,
      }));
    }
  }

  return [];
}

function extractExecutionSteps(entries: LogEntry[]): { steps: ExecutionStep[]; taskTypeCounts?: Record<string, number> } {
  const llmResponse = entries.find(e => e.type === 'llm_response');
  if (!llmResponse?.data?.executionLog) {
    return { steps: [] };
  }

  const executionLog = llmResponse.data.executionLog;
  const steps: ExecutionStep[] = executionLog.map((entry: any) => ({
    taskType: entry.taskType,
    taskName: entry.taskName || undefined,
    instruction: entry.instruction || undefined,
    result: entry.result || undefined,
    toolCallLog: entry.toolCallLog?.length ? entry.toolCallLog : undefined,
    pendingToolCalls: entry.pendingToolCalls?.length ? entry.pendingToolCalls : undefined,
  }));

  return {
    steps,
    taskTypeCounts: llmResponse.data.taskTypeCounts,
  };
}

function extractDriverInfo(entries: LogEntry[]): DriverInfo | undefined {
  const driverInfoEntry = entries.find(e => e.type === 'driver_info');
  if (!driverInfoEntry) return undefined;
  const data = driverInfoEntry.data;
  return {
    model: data.model,
    models: data.models,
  };
}

function isContinuation(requestData: any): boolean {
  const messages = requestData?.messages || [];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user') return false;

  const content = lastMsg.content;
  if (Array.isArray(content)) {
    return content.some((b: any) => b.type === 'tool_result');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract task overview for all multi-step requests in a session
 */
export function extractTaskOverviews(sessionFiles: string[]): TaskOverview[] {
  const overviews: TaskOverview[] = [];

  for (const file of sessionFiles) {
    const entries = parseLogFile(file);
    const seqId = entries[0]?.seqId;
    if (!seqId) continue;

    const requestEntry = entries.find(e => e.type === 'in' && e.phase === PHASES.REQUEST);
    if (!requestEntry) continue;

    const requestData = requestEntry.data;
    const workflow = detectWorkflow(entries, requestData);

    // Only include multi-step workflows
    if (workflow !== 'agentic') continue;

    const responseEntry = entries.find(e => e.type === 'out' && e.phase === PHASES.RESPONSE);
    const stopReason = responseEntry?.data?.stop_reason || '?';

    const plan = extractPlannedTasks(entries);
    const { steps, taskTypeCounts } = extractExecutionSteps(entries);
    const userMessage = extractUserMessage(requestData);

    const driverInfo = extractDriverInfo(entries);

    const overview: TaskOverview = {
      seqId,
      workflow,
      userMessage: userMessage.substring(0, 100),
      plan,
      execution: steps,
      stopReason,
      taskTypeCounts,
      driverInfo,
    };

    // Check if this is a continuation of a previous request
    if (isContinuation(requestData)) {
      overview.continuesFrom = findPreviousSeq(overviews, seqId);
    }

    overviews.push(overview);
  }

  // Link continuations
  for (const ov of overviews) {
    if (ov.continuesFrom) {
      const prev = overviews.find(o => o.seqId === ov.continuesFrom);
      if (prev) {
        prev.continuationSeqId = ov.seqId;
      }
    }
  }

  return overviews;
}

/**
 * Find the most recent suspended request that this continuation resumes
 */
function findPreviousSeq(overviews: TaskOverview[], _currentSeqId: string): string | undefined {
  // Walk backwards to find the last suspended (tool_use) request
  for (let i = overviews.length - 1; i >= 0; i--) {
    const ov = overviews[i];
    if (ov.stopReason === 'tool_use' && !ov.continuationSeqId) {
      return ov.seqId;
    }
  }
  return undefined;
}

/**
 * Extract task detail for a specific request
 */
export function extractTaskDetail(entries: LogEntry[], seqId: string): TaskDetail | null {
  const seqEntries = entries.filter(e => e.seqId === seqId);
  if (seqEntries.length === 0) return null;

  const requestEntry = seqEntries.find(e => e.type === 'in' && e.phase === PHASES.REQUEST);
  if (!requestEntry) return null;

  const requestData = requestEntry.data;
  const workflow = detectWorkflow(seqEntries, requestData);
  const responseEntry = seqEntries.find(e => e.type === 'out' && e.phase === PHASES.RESPONSE);
  const stopReason = responseEntry?.data?.stop_reason || '?';

  const plan = extractPlannedTasks(seqEntries);
  const { steps, taskTypeCounts } = extractExecutionSteps(seqEntries);
  const userMessage = extractUserMessage(requestData);
  const driverInfo = extractDriverInfo(seqEntries);

  return {
    seqId,
    workflow,
    userMessage,
    plan,
    execution: steps,
    stopReason,
    taskTypeCounts,
    driverInfo,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  const single = text.replace(/\n/g, ' ').trim();
  if (single.length <= maxLen) return single;
  return single.substring(0, maxLen - 3) + '...';
}

function fmtPlanSummary(plan: PlannedTask[]): string {
  if (plan.length === 0) return '(no plan)';
  return plan.map(t => {
    const type = t.taskType || '?';
    if (t.name) return `${type}: ${t.name}`;
    return type;
  }).join(' → ');
}

function fmtExecSummary(steps: ExecutionStep[]): string {
  if (steps.length === 0) return '(no execution)';
  return steps.map(s => {
    const name = s.taskName ? ` ${s.taskName}` : '';
    const suspended = s.pendingToolCalls?.length
      ? `→ suspended(${s.pendingToolCalls.map(t => shortenToolName(t.name)).join(',')})`
      : '';
    return `[${s.taskType}]${name}${suspended ? ' ' + suspended : ''}`;
  }).join(' → ');
}

function shortenToolName(name: string): string {
  const parts = name.split('__');
  return parts[parts.length - 1];
}

/**
 * Format model name for display: strip common prefixes
 */
function shortenModelName(name: string): string {
  return name
    .replace(/^mlx-community\//, '')
    .replace(/^anthropic\//, '');
}

/**
 * Format driver info for display.
 * Single model: just the model name.
 * Multiple roles: show role→model mapping, grouping identical models.
 */
function fmtDriverInfo(info: DriverInfo): string {
  if (info.models && Object.keys(info.models).length > 1) {
    // Group roles by model
    const modelToRoles = new Map<string, string[]>();
    for (const [role, model] of Object.entries(info.models)) {
      const short = shortenModelName(model as string);
      if (!modelToRoles.has(short)) {
        modelToRoles.set(short, []);
      }
      modelToRoles.get(short)!.push(role);
    }

    if (modelToRoles.size === 1) {
      // All roles use the same model
      const [model] = modelToRoles.keys();
      return model;
    }

    // Multiple models: show grouped
    return Array.from(modelToRoles.entries())
      .map(([model, roles]) => `${roles.join(',')}=${model}`)
      .join('  ');
  }

  if (info.model) {
    return shortenModelName(info.model);
  }
  return '?';
}

/**
 * Display task overview for a session
 */
export function displayTaskOverviews(overviews: TaskOverview[], sessionId: string | number): void {
  const totalRequests = overviews.length;
  console.log(`\nSession: PID ${sessionId} (${totalRequests} agentic requests)\n`);

  // Group continuations
  const displayed = new Set<string>();

  for (const ov of overviews) {
    if (displayed.has(ov.seqId)) continue;

    // Build seq range label
    const seqParts = [ov.seqId];
    let current = ov;
    while (current.continuationSeqId) {
      seqParts.push(current.continuationSeqId);
      displayed.add(current.continuationSeqId);
      current = overviews.find(o => o.seqId === current.continuationSeqId)!;
      if (!current) break;
    }
    displayed.add(ov.seqId);

    const seqLabel = seqParts.length > 1 ? seqParts.join('→') : ov.seqId;
    const userMsg = truncate(ov.userMessage, 60);

    console.log(`─── seq ${seqLabel} | ${ov.workflow} | user: ${userMsg} ───`);

    // Show model info
    if (ov.driverInfo) {
      console.log(`  Model: ${fmtDriverInfo(ov.driverInfo)}`);
    }

    // Show plan
    console.log(`  Plan: ${fmtPlanSummary(ov.plan)}`);

    // Show execution
    console.log(`  Exec: ${fmtExecSummary(ov.execution)}`);

    // Show continuations
    if (ov.continuationSeqId) {
      let contOv = overviews.find(o => o.seqId === ov.continuationSeqId);
      while (contOv) {
        console.log(`  ↳ ${contOv.seqId} resumed`);
        if (contOv.plan.length > 0) {
          console.log(`  Plan: ${fmtPlanSummary(contOv.plan)}`);
        }
        console.log(`  Exec: ${fmtExecSummary(contOv.execution)}`);
        contOv = contOv.continuationSeqId
          ? overviews.find(o => o.seqId === contOv!.continuationSeqId)
          : undefined;
      }
    }

    // Show final result
    const finalOv = current || ov;
    const stopLabel = finalOv.stopReason === 'end_turn' ? 'text' :
                      finalOv.stopReason === 'tool_use' ? 'suspended' :
                      finalOv.stopReason;
    const countsStr = finalOv.taskTypeCounts
      ? Object.entries(finalOv.taskTypeCounts).map(([k, v]) => `${k}:${v}`).join(', ')
      : '';
    console.log(`  Result: ${stopLabel}${countsStr ? ` | tasks: ${countsStr}` : ''}`);
    console.log('');
  }
}

/**
 * Display task detail for a specific request
 */
export function displayTaskDetail(detail: TaskDetail): void {
  const userMsg = truncate(detail.userMessage, 80);
  console.log(`\n─── seq ${detail.seqId} | ${detail.workflow} ───`);
  if (detail.driverInfo) {
    console.log(`  Model: ${fmtDriverInfo(detail.driverInfo)}`);
  }
  console.log(`  User: ${userMsg}`);

  // Plan
  if (detail.plan.length > 0) {
    console.log(`\n  Plan (${detail.plan.length} tasks):`);
    for (let i = 0; i < detail.plan.length; i++) {
      const t = detail.plan[i];
      const type = t.taskType || '?';
      const label = t.name ? `${type}: ${t.name}` : type;
      const driver = t.driverRole ? ` [driver: ${t.driverRole}]` : '';
      console.log(`    ${i + 1}. ${label}${driver}`);
      if (t.instruction) {
        console.log(`       instruction: ${truncate(t.instruction, 100)}`);
      }
      if (t.reason) {
        console.log(`       reason: ${truncate(t.reason, 100)}`);
      }
    }
  } else {
    console.log(`\n  Plan: (no task_registration entry)`);
  }

  // Execution
  if (detail.execution.length > 0) {
    console.log(`\n  Execution (${detail.execution.length} steps):`);
    for (let i = 0; i < detail.execution.length; i++) {
      const step = detail.execution[i];
      const name = step.taskName ? `: ${step.taskName}` : '';
      console.log(`    [${i}] ${step.taskType}${name}`);

      if (step.toolCallLog?.length) {
        const toolCounts = new Map<string, number>();
        for (const tc of step.toolCallLog) {
          const n = shortenToolName(tc.name);
          toolCounts.set(n, (toolCounts.get(n) || 0) + 1);
        }
        const toolStr = Array.from(toolCounts.entries())
          .map(([n, c]) => c > 1 ? `${n} x${c}` : n)
          .join(', ');
        console.log(`        tools: ${toolStr}`);
      }

      if (step.pendingToolCalls?.length) {
        const names = step.pendingToolCalls.map(t => shortenToolName(t.name)).join(', ');
        console.log(`        → suspended: ${names}`);
      }

      if (step.result) {
        console.log(`        → ${truncate(step.result, 120)}`);
      }
    }
  }

  // Result
  const stopLabel = detail.stopReason === 'end_turn' ? 'text (end_turn)' :
                    detail.stopReason === 'tool_use' ? 'suspended (tool_use)' :
                    detail.stopReason;
  const countsStr = detail.taskTypeCounts
    ? Object.entries(detail.taskTypeCounts).map(([k, v]) => `${k}:${v}`).join(', ')
    : '';
  console.log(`\n  Result: ${stopLabel}${countsStr ? ` | tasks: ${countsStr}` : ''}`);
  console.log('');
}
