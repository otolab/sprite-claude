import { agenticProcess, type AgenticWorkflowOptions, type AgenticTaskExecutionLog, type DriverInput } from '@modular-prompt/process';
import type { ToolDefinition } from '@modular-prompt/driver';
import type { PromptModule } from '@modular-prompt/core';
import { compile } from '@modular-prompt/core';
import type { EngineTool, EngineLogger, ProcessResult, WorkflowOptions, RegisteredTaskInfo } from '../types.js';

/**
 * Convert EngineTool[] to ToolDefinition[] for agenticProcess.
 */
function toToolDefinitions(tools: EngineTool[]): ToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as Record<string, unknown>,
  }));
}

/**
 * Build thinking text from executionLog for transparent process visibility.
 */
function buildThinking(log?: AgenticTaskExecutionLog[]): string | undefined {
  if (!log || log.length === 0) return undefined;
  return log.map(entry => {
    const lines = [`[${entry.taskType}] ${entry.taskName || ''}`, entry.instruction];
    if (entry.result) lines.push(`→ ${entry.result}`);
    if (entry.toolCallLog?.length) {
      for (const tc of entry.toolCallLog) {
        lines.push(`  tool: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
      }
    }
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Agentic workflow - uses @modular-prompt/process agenticProcess
 *
 * Receives a PromptModule with a user-defined context type T.
 * Tools are passed as ToolSpec[] and returned as pendingToolCalls.
 */
export async function agenticWorkflow<T>(
  driverInput: DriverInput,
  module: PromptModule<T>,
  context: T,
  tools: EngineTool[],
  logger: EngineLogger,
  _options: WorkflowOptions,
): Promise<ProcessResult> {
  // compile して CompiledPrompt を生成し、ログに記録する
  const compiled = compile(module, context);
  logger.logPrompt('agentic', compiled, { toolCount: tools.length });

  const toolDefs = tools.length > 0 ? toToolDefinitions(tools) : undefined;

  const agenticOptions: AgenticWorkflowOptions = {
    tools: toolDefs,
    enablePlanning: true,
    // thinkタグがモデルによって特殊な意味に解釈されるケースがあるため無効化
    includeThinking: false,
  };

  let result;
  try {
    result = await agenticProcess(driverInput, module, context, agenticOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.logError('agentic', message, {
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  // Extract pendingToolCalls from executionLog
  const executionLog = result.context.executionLog;
  const allPendingToolCalls = executionLog
    ?.flatMap(entry => entry.pendingToolCalls || []) || [];

  // Extract task registrations from planning phase.
  // process 0.5.0+: planner calls task-type tools directly (think, act, output, etc.)
  // process <0.5.0: planner calls __register_task builtin
  const KNOWN_TASK_TYPES = ['think', 'act', 'verify', 'extractContext', 'recall', 'determine', 'output'];
  const registeredTasks: RegisteredTaskInfo[] = executionLog
    ?.filter(entry => entry.taskType === 'planning')
    .flatMap(entry => entry.toolCallLog || [])
    .filter(tc => tc.name === '__register_task' || KNOWN_TASK_TYPES.includes(tc.name))
    .map(tc => {
      const args = typeof tc.arguments === 'string'
        ? JSON.parse(tc.arguments) : tc.arguments;
      if (tc.name === '__register_task') {
        return {
          name: args.name,
          taskType: args.taskType,
          instruction: args.instruction,
          reason: args.reason,
          driverRole: args.driverRole,
        };
      }
      return {
        name: args.name || '',
        taskType: tc.name,
        instruction: args.instruction || '',
        reason: args.reason,
        driverRole: args.driverRole,
      };
    }) || [];

  if (registeredTasks.length > 0) {
    logger.logTaskRegistration?.('agentic', registeredTasks);
  }

  const { context: _, ...logData } = result;
  // executionLogをログデータに含める（metadata除外でサイズ抑制）
  const executionLogForLog = executionLog?.map(entry => ({
    taskName: entry.taskName,
    taskType: entry.taskType,
    instruction: entry.instruction,
    result: entry.result,
    toolCallLog: entry.toolCallLog,
    pendingToolCalls: entry.pendingToolCalls?.map(tc => ({ id: tc.id, name: tc.name })),
  }));

  // タスクタイプの内訳を集計
  const taskTypeCounts: Record<string, number> = {};
  if (executionLog) {
    for (const entry of executionLog) {
      taskTypeCounts[entry.taskType] = (taskTypeCounts[entry.taskType] || 0) + 1;
    }
  }

  const finishReason = allPendingToolCalls.length > 0 ? 'tool_calls' : 'stop';
  logger.logLlmResponse('agentic', {
    ...logData, finishReason, executionLog: executionLogForLog, taskTypeCounts,
  } as any, _options.modelName);

  const thinking = buildThinking(executionLog);

  if (allPendingToolCalls.length > 0) {
    return {
      type: 'tool_calls',
      calls: allPendingToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === 'string'
          ? JSON.parse(tc.arguments)
          : tc.arguments as Record<string, unknown>,
      })),
      text: result.output || undefined,
      thinking,
    };
  }

  return {
    type: 'response',
    text: result.output || '',
    thinking,
  };
}
