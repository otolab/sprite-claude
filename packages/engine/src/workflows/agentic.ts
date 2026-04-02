import { agenticProcess, type AgenticWorkflowOptions, type ToolSpec, type DriverInput } from '@modular-prompt/process';
import type { PromptModule } from '@modular-prompt/core';
import { compile } from '@modular-prompt/core';
import type { EngineTool, EngineLogger, WorkflowResult, WorkflowOptions } from '../types.js';

/**
 * Convert EngineTool[] to ToolSpec[] for agenticProcess.
 * Handlers are no-ops since tool calls are returned as pendingToolCalls.
 */
function toToolSpecs(tools: EngineTool[]): ToolSpec[] {
  return tools.map(tool => ({
    definition: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
    handler: async () => ({}),
  }));
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
): Promise<WorkflowResult> {
  // compile して CompiledPrompt を生成し、ログに記録する
  const compiled = compile(module, context);
  logger.logPrompt('agentic', compiled, { toolCount: tools.length });

  const toolSpecs = tools.length > 0 ? toToolSpecs(tools) : undefined;

  const agenticOptions: AgenticWorkflowOptions = {
    tools: toolSpecs,
    enablePlanning: true,
    // thinkタグがモデルによって特殊な意味に解釈されるケースがあるため無効化
    includeThinking: false,
  };

  const result = await agenticProcess(driverInput, module, context, agenticOptions);

  // Extract pendingToolCalls from executionLog
  const executionLog = result.context.executionLog;
  const allPendingToolCalls = executionLog
    ?.flatMap(entry => entry.pendingToolCalls || []) || [];

  logger.logLlmResponse('agentic', {
    content: result.output,
    toolCalls: allPendingToolCalls.length > 0 ? allPendingToolCalls : undefined,
    finishReason: allPendingToolCalls.length > 0 ? 'tool_calls' as const : 'stop' as const,
  }, _options.modelName);

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
    };
  }

  return {
    type: 'response',
    text: result.output || '',
  };
}
