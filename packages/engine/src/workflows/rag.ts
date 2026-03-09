import type { AIService } from '@modular-prompt/driver';
import { compile, createContext } from '@modular-prompt/core';
import type { EngineMessage, EngineTool, EngineLogger, WorkflowResult } from '../types.js';
import { resolveDriver } from '../driver-cache.js';
import { analysisModule, type AnalysisResult } from '../prompts/analysis-module.js';
import { toolGenerationModule, responseGenerationModule } from '../prompts/generation-module.js';

/**
 * Remove <think>...</think> tags from text to prevent Phase2 from mimicking thinking pattern
 * @param text - Text potentially containing think tags
 * @returns Cleaned text without think tags
 */
function removeThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Analyze and respond using 2-phase approach with RAG pattern
 *
 * Phase 1 (Analysis/Retrieval):
 * - Analyzes conversation history
 * - Extracts relevant context and key facts
 * - Decides tool usage vs. direct response
 *
 * Phase 2 (Generation):
 * - Tool path: Generates tool call with extracted context
 * - Response path: Generates response with extracted context
 *
 * @param aiService - AI service for driver selection
 * @param messages - Full conversation history (EngineMessage[])
 * @param tools - Available tools
 * @param systemPrompt - System prompt for direct responses
 * @param logger - Request logger
 * @param maxTokensConfig - Max tokens configuration for each phase
 * @returns WorkflowResult (tool call or text response)
 */
export async function ragWorkflow(
  aiService: AIService,
  messages: EngineMessage[],
  tools: EngineTool[],
  systemPrompt: string,
  logger: EngineLogger,
  maxTokensConfig?: {
    phase1?: number;
    phase2Tool?: number;
    phase2Response?: number;
  }
): Promise<WorkflowResult> {
  // Phase 1: Analysis - reasoning capability preferred
  const { driver: phase1Driver, model: phase1Model } = await resolveDriver(aiService, ['reasoning'], { preferLocal: true });

  // Phase 1: Analysis
  const analysisContext = createContext(analysisModule);
  analysisContext.messages = messages;
  analysisContext.tools = tools;

  const analysisCompiled = compile(analysisModule, analysisContext);

  // Log Phase 1 prompt
  logger.logPrompt('phase1-analysis', analysisCompiled);

  const analysisResult = await phase1Driver.query(analysisCompiled, {
    maxTokens: maxTokensConfig?.phase1 ?? 2000,  // Default 2000 to allow for <think> reasoning + JSON output
    temperature: 0.3,
  });

  // Log Phase 1 response
  logger.logLlmResponse('phase1-analysis', analysisResult, phase1Model);

  // Parse analysis result
  const analysis = analysisResult.structuredOutput as AnalysisResult || (() => {
    if (!analysisResult.content) {
      return null;
    }
    try {
      // Remove <think> tags before parsing JSON
      const cleanedContent = removeThinkTags(analysisResult.content);
      return JSON.parse(cleanedContent) as AnalysisResult;
    } catch {
      return null;
    }
  })();

  if (!analysis || !analysis.analysis || !analysis.action) {
    logger.logError('phase1-analysis', 'Failed to parse analysis result', {
      hasAnalysis: !!analysis,
      hasAnalysisField: !!(analysis && analysis.analysis),
      hasAction: !!(analysis && analysis.action),
      rawContent: analysisResult.content?.substring(0, 200),
    });
    return {
      type: 'response',
      text: analysisResult.content || 'Failed to analyze request',
    };
  }

  // Extract relevant context from analysis and clean <think> tags
  const relevantContext = (analysis.analysis.relevantContext || []).map(item => ({
    ...item,
    text: removeThinkTags(item.text)
  }));

  // Phase 2: Generation
  if (analysis.action.type === 'tool_call') {
    // Tool path
    const toolName = analysis.action.toolName;
    if (!toolName) {
      logger.logError('phase1-analysis', 'Tool name not specified in analysis');
      return {
        type: 'response',
        text: 'Tool usage decided but no tool specified',
      };
    }

    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      logger.logError('phase1-analysis', 'Tool not found', { toolName });
      return {
        type: 'response',
        text: `Tool "${toolName}" not available`,
      };
    }

    const toolGenContext = createContext(toolGenerationModule);
    toolGenContext.analysisResult = analysis;
    toolGenContext.relevantContext = relevantContext;
    toolGenContext.toolDefinition = {
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.input_schema,
    };

    const toolGenCompiled = compile(toolGenerationModule, toolGenContext);

    // Phase 2 (Tool): local fast model preferred
    const { driver: phase2ToolDriver, model: phase2ToolModel } = await resolveDriver(aiService, ['local', 'fast']);

    // Log Phase 2 prompt
    logger.logPrompt('phase2-tool-generation', toolGenCompiled);

    const toolGenResult = await phase2ToolDriver.query(toolGenCompiled, {
      maxTokens: maxTokensConfig?.phase2Tool ?? 1000,
      temperature: 0.1,
    });

    // Log Phase 2 response
    logger.logLlmResponse('phase2-tool-generation', toolGenResult, phase2ToolModel);

    const toolCall = (toolGenResult.structuredOutput as Record<string, unknown> | undefined) || (() => {
      if (!toolGenResult.content) {
        return null;
      }
      try {
        // Remove <think> tags before parsing JSON
        const cleanedContent = removeThinkTags(toolGenResult.content);
        return JSON.parse(cleanedContent);
      } catch {
        return null;
      }
    })();

    if (!toolCall || typeof toolCall !== 'object') {
      logger.logError('phase2-tool-generation', 'Failed to generate tool call');
      return {
        type: 'response',
        text: 'Failed to generate tool parameters',
      };
    }

    // TODO: Consider removing null values for non-nullable properties
    // If prompt instruction to omit optional parameters fails, we can implement:
    // - Check tool.input_schema.properties[key].nullable === false
    // - Delete toolCall[key] if value is null
    // This ensures LLM's "undefined" (parsed as null) is properly omitted

    return {
      type: 'tool_call',
      toolName: tool.name,
      input: toolCall,
    };
  } else {
    // Response path
    const responseGenContext = createContext(responseGenerationModule);
    responseGenContext.analysisResult = analysis;
    responseGenContext.relevantContext = relevantContext;
    responseGenContext.systemPrompt = systemPrompt;

    const responseGenCompiled = compile(responseGenerationModule, responseGenContext);

    // Phase 2 (Response): local fast model preferred
    const { driver: phase2ResponseDriver, model: phase2ResponseModel } = await resolveDriver(aiService, ['local', 'fast']);

    // Log Phase 2 prompt
    logger.logPrompt('phase2-response-generation', responseGenCompiled);

    const responseGenResult = await phase2ResponseDriver.query(responseGenCompiled, {
      maxTokens: maxTokensConfig?.phase2Response ?? 2000,
      temperature: 0.7,
    });

    // Log Phase 2 response
    logger.logLlmResponse('phase2-response-generation', responseGenResult, phase2ResponseModel);

    // Remove <think> tags from final response
    const cleanedResponse = removeThinkTags(responseGenResult.content || '');

    return {
      type: 'response',
      text: cleanedResponse,
    };
  }
}
