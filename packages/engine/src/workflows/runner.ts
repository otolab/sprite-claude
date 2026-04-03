import type { AIService, ModelSpec, DriverCapability } from '@modular-prompt/driver';
import type { PromptModule } from '@modular-prompt/core';
import { compile } from '@modular-prompt/core';
import type { DriverSet } from '@modular-prompt/process';
import type { WorkflowDefinition, WorkflowOptions, EngineTool, EngineLogger, ProcessResult } from '../types.js';
import { resolveDriver } from '../driver-cache.js';
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
): Promise<{ driverSet: DriverSet; defaultModel: string }> {
  const [defaultR, chatR, reasoningR, structuredR] = await Promise.all([
    resolveDriver(aiService, [], { preferLocal: true, lenient: true }, overrides.default),
    resolveDriver(aiService, ['chat'], { preferLocal: true, preferFast: true, lenient: false }, overrides.chat),
    resolveDriver(aiService, ['reasoning'], { preferLocal: true, lenient: false }, overrides.plan || overrides.thinking),
    resolveDriver(aiService, ['structured'], { preferLocal: true, lenient: false }, overrides.instruct),
  ]);
  if (!defaultR) throw new Error('No suitable model found for default.');
  return {
    driverSet: {
      default: defaultR.driver,
      chat: chatR?.driver || defaultR.driver,
      plan: reasoningR?.driver || defaultR.driver,
      instruct: structuredR?.driver || defaultR.driver,
      thinking: reasoningR?.driver || defaultR.driver,
    },
    defaultModel: defaultR.model,
  };
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

  if (def.mode === 'passthrough') {
    const resolved = await resolveDriver(aiService, [], { preferLocal: true, preferFast: true }, overrides.default);
    if (!resolved) throw new Error('No suitable model found for passthrough.');
    const compiled = compile(module, context);
    return passthroughWorkflow(resolved.driver, compiled, tools, logger,
      { ...options, modelName: resolved.model });
  }

  if (def.mode === 'agentic') {
    const { driverSet, defaultModel } = await buildDriverSet(aiService, overrides);
    return agenticWorkflow(driverSet, module, context, tools, logger,
      { ...options, modelName: defaultModel });
  }

  throw new Error(`Unsupported workflow mode: ${def.mode}`);
}
