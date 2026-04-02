import type { AIDriver, ToolDefinition } from '@modular-prompt/driver';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { EngineTool, EngineLogger, WorkflowResult, WorkflowOptions } from '../types.js';

/**
 * Convert EngineTool (Anthropic format) to ToolDefinition (driver format)
 */
function toToolDefinitions(tools: EngineTool[]): ToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as Record<string, unknown>,
  }));
}

/**
 * Passthrough workflow - bypasses prompt modules entirely
 *
 * Receives a pre-built CompiledPrompt with tool-aware MessageElements
 * (StandardMessageElement with toolCalls, ToolResultMessageElement with role:'tool').
 * Tools are passed to the driver via QueryOptions.
 *
 * @param driver - AI driver instance
 * @param compiled - Pre-built CompiledPrompt with full message history
 * @param tools - Available tools (passed to driver via QueryOptions)
 * @param logger - Request logger
 * @param options - Workflow options
 * @returns WorkflowResult (text or tool_call response)
 */
export async function passthroughWorkflow(
  driver: AIDriver,
  compiled: CompiledPrompt,
  tools: EngineTool[],
  logger: EngineLogger,
  options: WorkflowOptions,
): Promise<WorkflowResult> {
  logger.logPrompt('passthrough', compiled, { toolCount: tools.length });

  const toolDefs = tools.length > 0 ? toToolDefinitions(tools) : undefined;

  const result = await driver.query(compiled, {
    maxTokens: options.maxTokens?.phase2Response ?? 2000,
    temperature: 0.7,
    tools: toolDefs,
    toolChoice: toolDefs ? 'auto' : undefined,
  });

  logger.logLlmResponse('passthrough', result, options.modelName);

  // Handle driver errors
  if (result.finishReason === 'error') {
    throw new Error(result.content || 'Driver returned an error');
  }

  // Handle tool calls from the model
  if (result.toolCalls && result.toolCalls.length > 0) {
    return {
      type: 'tool_calls',
      calls: result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === 'string'
          ? JSON.parse(tc.arguments)
          : tc.arguments as Record<string, unknown>,
      })),
      text: result.content || undefined,
    };
  }

  return {
    type: 'response',
    text: result.content || '',
  };
}
