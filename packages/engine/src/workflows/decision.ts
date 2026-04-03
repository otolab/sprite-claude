import type { AIService } from '@modular-prompt/driver';
import { compile, createContext } from '@modular-prompt/core';
import type { EngineMessage, EngineTool, EngineLogger, ProcessResult } from '../types.js';
import { resolveDriver } from '../driver-cache.js';
import { toolDecisionModule } from '../prompts/decision-module.js';
import { toolCallModule } from '../prompts/call-module.js';

/**
 * Decide and generate tool calls using 2-phase approach
 *
 * This function:
 * 1. Phase 1: Decides if a tool is needed (simplified tool list)
 * 2. Phase 2: Generates structured tool call (full schema with parameters)
 *
 * @param aiService - AI service for driver selection
 * @param messages - Conversation history
 * @param tools - Available tools
 * @param logger - Request logger
 * @param systemPrompt - System prompt for context (optional)
 * @returns ProcessResult or null
 */
export async function decisionWorkflow(
  aiService: AIService,
  messages: EngineMessage[],
  tools: EngineTool[],
  logger: EngineLogger,
  systemPrompt?: string
): Promise<ProcessResult | null> {
  // Extract user message (last user message)
  const userMessage = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

  // Phase 1: reasoning model for decision
  const phase1Resolved = await resolveDriver(aiService, ['reasoning'], { preferLocal: true });
  if (!phase1Resolved) {
    throw new Error('No suitable model found for decision phase1.');
  }
  const { driver: phase1Driver, model: phase1Model } = phase1Resolved;

  // Format available tools - simplified (name + description only)
  const availableTools = tools.map(tool =>
    `- ${tool.name}: ${tool.description || 'No description'}`
  ).join('\n');

  // Step 1: Decide if we need to use a tool
  const decisionContext = createContext(toolDecisionModule);
  decisionContext.userMessage = userMessage;
  decisionContext.availableTools = availableTools;
  decisionContext.additionalInstructions = systemPrompt;
  // Convert to EngineMessage format
  decisionContext.messages = messages;

  const decisionCompiled = compile(toolDecisionModule, decisionContext);

  // Log Phase 1 prompt
  logger.logPrompt('phase1-decision', decisionCompiled);

  const decisionResult = await phase1Driver.query(decisionCompiled, {
    maxTokens: 500,
    temperature: 0.3,
  });

  // Log Phase 1 response
  logger.logLlmResponse('phase1-decision', decisionResult, phase1Model);

  if (!decisionResult.content) {
    return null;
  }

  // Step 2: Generate structured tool call
  const toolCallContext = createContext(toolCallModule);
  toolCallContext.toolDecision = decisionResult.content;
  toolCallContext.additionalInstructions = systemPrompt;

  // Pass full tool definitions with schemas for accurate parameter generation
  const fullToolDefinitions = tools.map(tool => {
    const schema = tool.input_schema as { properties?: Record<string, { description?: string; type?: string }>; required?: string[] };
    const params = schema?.properties || {};
    const required = schema?.required || [];

    return `Tool: ${tool.name}
Description: ${tool.description || 'No description'}
Parameters:
${Object.entries(params).map(([name, def]) => {
  const isRequired = required.includes(name);
  return `  - ${name}${isRequired ? ' (REQUIRED)' : ' (optional)'}: ${def.description || def.type}`;
}).join('\n')}`;
  }).join('\n\n');

  toolCallContext.toolDefinitions = fullToolDefinitions;

  const toolCallCompiled = compile(toolCallModule, toolCallContext);

  // Phase 2: local fast model for tool call generation
  const phase2Resolved = await resolveDriver(aiService, ['local', 'fast', 'tools']);
  if (!phase2Resolved) {
    throw new Error('No suitable model found for decision phase2.');
  }
  const { driver: phase2Driver, model: phase2Model } = phase2Resolved;

  // Log Phase 2 prompt
  logger.logPrompt('phase2-tool-call', toolCallCompiled);

  const toolCallResult = await phase2Driver.query(toolCallCompiled, {
    maxTokens: 1000,
    temperature: 0.1,
  });

  // Log Phase 2 response
  logger.logLlmResponse('phase2-tool-call', toolCallResult, phase2Model);

  // Use structuredOutput if available, otherwise fallback to parsing content
  const toolCall = (toolCallResult.structuredOutput as { use_tool?: boolean; tool_name?: string; tool_input?: Record<string, unknown> } | undefined) || (() => {
    if (!toolCallResult.content) {
      return null;
    }
    try {
      return JSON.parse(toolCallResult.content);
    } catch {
      return null;
    }
  })();

  if (!toolCall || !toolCall.use_tool) {
    return null;
  }

  // Validate required fields
  if (!toolCall.tool_name || typeof toolCall.tool_name !== 'string') {
    logger.logError('phase2-tool-call', 'Invalid tool_name in tool call', { toolCall });
    return null;
  }

  return {
    type: 'tool_call',
    toolName: toolCall.tool_name,
    input: toolCall.tool_input || {},
  };
}
