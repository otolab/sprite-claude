import type { AIService, ModelSpec, DriverCapability } from '@modular-prompt/driver';
import type { PromptModule } from '@modular-prompt/core';
import { compile } from '@modular-prompt/core';
import type { DriverSet } from '@modular-prompt/process';
import type { WorkflowDefinition, WorkflowOptions, EngineTool, EngineLogger, ProcessResult } from '../types.js';
import { resolveDriver, getCacheStats } from '../driver-cache.js';
import { agenticWorkflow } from './agentic.js';
import { passthroughWorkflow } from './passthrough.js';

/**
 * AIService からモデル名で ModelSpec を検索
 */
function findModelByName(aiService: AIService, name: string): ModelSpec | undefined {
  const all = aiService.selectModels([]);
  return all.find(m => m.model === name);
}

/**
 * WorkflowDefinition.models の各役割を ModelSpec に解決
 */
function resolveModelOverrides(
  def: WorkflowDefinition,
  aiService: AIService,
): Record<string, ModelSpec> {
  const result: Record<string, ModelSpec> = {};
  if (!def.models) return result;
  for (const [role, spec] of Object.entries(def.models)) {
    let resolved: ModelSpec | undefined;
    if (typeof spec === 'string') {
      resolved = findModelByName(aiService, spec);
    } else if (Array.isArray(spec)) {
      const selected = aiService.selectModels(spec as DriverCapability[]);
      resolved = selected.length ? selected[0] : undefined;
    }
    if (resolved) result[role] = resolved;
  }
  return result;
}

/**
 * DriverSet を構築 (agentic 用)
 */
async function buildDriverSet(
  aiService: AIService,
  overrides: Record<string, ModelSpec>,
): Promise<{ driverSet: DriverSet; defaultModel: string; modelNames: Record<string, string> }> {
  const [defaultR, chatR, planR, thinkingR, structuredR] = await Promise.all([
    resolveDriver(aiService, [], { preferLocal: true, lenient: true }, overrides.default),
    resolveDriver(aiService, ['chat'], { preferLocal: true, preferFast: true, lenient: false }, overrides.chat),
    resolveDriver(aiService, ['reasoning'], { preferLocal: true, lenient: false }, overrides.plan),
    resolveDriver(aiService, ['reasoning'], { preferLocal: true, lenient: false }, overrides.thinking),
    resolveDriver(aiService, ['structured'], { preferLocal: true, lenient: false }, overrides.instruct),
  ]);
  if (!defaultR) throw new Error('No suitable model found for default.');
  return {
    driverSet: {
      default: defaultR.driver,
      chat: chatR?.driver || defaultR.driver,
      plan: planR?.driver || thinkingR?.driver || defaultR.driver,
      instruct: structuredR?.driver || defaultR.driver,
      thinking: thinkingR?.driver || planR?.driver || defaultR.driver,
    },
    defaultModel: defaultR.model,
    modelNames: {
      default: defaultR.model,
      chat: chatR?.model || defaultR.model,
      plan: planR?.model || thinkingR?.model || defaultR.model,
      instruct: structuredR?.model || defaultR.model,
      thinking: thinkingR?.model || planR?.model || defaultR.model,
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Workflow timeout: ${label} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * WorkflowDefinition に基づいてワークフローを実行
 *
 * 1. models 定義からモデルを解決
 * 2. mode に応じてドライバーを構築
 * 3. 対応するワークフロー関数を呼び出し
 */
export async function runWorkflow<T>(
  def: WorkflowDefinition,
  aiService: AIService,
  module: PromptModule<T>,
  context: T,
  tools: EngineTool[],
  logger: EngineLogger,
  options: WorkflowOptions,
): Promise<ProcessResult> {
  const overrides = resolveModelOverrides(def, aiService);
  const timeoutMs = options.workflowTimeout;

  if (def.mode === 'passthrough') {
    const resolved = await resolveDriver(aiService, [], { preferLocal: true, preferFast: true }, overrides.default);
    if (!resolved) throw new Error('No suitable model found for passthrough.');
    if (logger.logDriverInfo) {
      logger.logDriverInfo(options.workflowName || 'passthrough', resolved.model, {});
    }
    const compiled = compile(module, context);
    const workflowPromise = passthroughWorkflow(resolved.driver, compiled, tools, logger,
      { ...options, modelName: resolved.model });

    let result: ProcessResult;
    if (!timeoutMs) {
      result = await workflowPromise;
    } else {
      try {
        result = await withTimeout(workflowPromise, timeoutMs, `passthrough(${resolved.model})`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Workflow timeout:')) {
          logger.logError('passthrough', error.message, { model: resolved.model, timeoutMs });
        }
        throw error;
      }
    }
    const stats = getCacheStats(resolved.driver);
    if (stats) logger.logCacheStats?.(options.workflowName || 'passthrough', stats);
    return result;
  }

  if (def.mode === 'agentic') {
    const { driverSet, defaultModel, modelNames } = await buildDriverSet(aiService, overrides);
    if (logger.logDriverInfo) {
      logger.logDriverInfo(options.workflowName || 'agentic', defaultModel, { models: modelNames });
    }
    const workflowPromise = agenticWorkflow(driverSet, module, context, tools, logger,
      { ...options, modelName: defaultModel });

    let result: ProcessResult;
    if (!timeoutMs) {
      result = await workflowPromise;
    } else {
      try {
        result = await withTimeout(workflowPromise, timeoutMs, `agentic(${defaultModel})`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Workflow timeout:')) {
          logger.logError('agentic', error.message, { defaultModel, models: modelNames, timeoutMs });
        }
        throw error;
      }
    }
    const stats = getCacheStats(driverSet.default);
    if (stats) logger.logCacheStats?.(options.workflowName || 'agentic', stats);
    return result;
  }

  throw new Error(`Unsupported workflow mode: ${def.mode}`);
}
