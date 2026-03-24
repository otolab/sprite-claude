import { agenticProcess, type AgenticWorkflowOptions, type ToolSpec, type DriverSet } from '@modular-prompt/process';
import type { PromptModule } from '@modular-prompt/core';
import { compile } from '@modular-prompt/core';
import type { AIService } from '@modular-prompt/driver';
import type { EngineTool, EngineLogger, WorkflowResult, WorkflowOptions } from '../types.js';
import { resolveDriver } from '../driver-cache.js';

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
  aiService: AIService,
  module: PromptModule<T>,
  context: T,
  tools: EngineTool[],
  logger: EngineLogger,
  _options: WorkflowOptions,
): Promise<WorkflowResult> {
  // Resolve drivers for each role
  // output → chat, planning → plan, execution tasks → instruct
  const [defaultResolved, fastResolved, reasoningResolved, structuredResolved] = await Promise.all([
    resolveDriver(aiService, [], { preferLocal: true, lenient: true }),
    resolveDriver(aiService, ['chat'], { preferLocal: true, preferFast: true, lenient: false }),
    resolveDriver(aiService, ['reasoning'], { preferLocal: true, lenient: false }),
    resolveDriver(aiService, ['structured'], { preferLocal: true, lenient: false }),
  ]);

  if (!defaultResolved) {
    throw new Error(`No suitable model found for default.`);
  }

  for (const r of [defaultResolved, fastResolved, reasoningResolved, structuredResolved]) {
    if (r?.isNew) {
      const caps = await (r.driver as any).getCapabilities?.();
      if (caps) {
        logger.logDriverInfo?.('agentic', r.model, caps);
      }
    }
  }

  const driverSet: DriverSet = {
    default: defaultResolved.driver,
    chat: fastResolved?.driver || defaultResolved.driver,
    plan: reasoningResolved?.driver || defaultResolved.driver,
    instruct: structuredResolved?.driver || defaultResolved.driver,
    thinking: reasoningResolved?.driver || defaultResolved.driver,
  };

  // compile して CompiledPrompt を生成し、ログに記録する
  const compiled = compile(module, context);
  logger.logPrompt('agentic', compiled, { toolCount: tools.length });

  const toolSpecs = tools.length > 0 ? toToolSpecs(tools) : undefined;

  const agenticOptions: AgenticWorkflowOptions = {
    tools: toolSpecs,
    enablePlanning: true,
    includeThinking: true,
  };

  const result = await agenticProcess(driverSet, module, context, agenticOptions);

  // Extract pendingToolCalls from executionLog
  const executionLog = result.context.executionLog;
  const allPendingToolCalls = executionLog
    ?.flatMap(entry => entry.pendingToolCalls || []) || [];

  logger.logLlmResponse('agentic', {
    content: result.output,
    toolCalls: allPendingToolCalls.length > 0 ? allPendingToolCalls : undefined,
    finishReason: allPendingToolCalls.length > 0 ? 'tool_calls' as const : 'stop' as const,
  }, defaultResolved.model);

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
