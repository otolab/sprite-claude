import type { AIDriver, AIService, DriverCapability, ModelSpec, SelectionOptions } from '@modular-prompt/driver';

/**
 * Resolved driver with model metadata
 */
export interface ResolvedDriver {
  driver: AIDriver;
  model: string;
  provider: string;
  /** true when the driver was newly created (cache miss) */
  isNew: boolean;
}

/**
 * Module-level driver cache keyed by "provider:model"
 * Shared across all AIService instances.
 */
const cache = new Map<string, AIDriver>();

/**
 * Resolve a driver for the given capabilities.
 *
 * 1. AIService.selectModels() で最適なモデルを選択
 * 2. キャッシュにあればそれを返す
 * 3. なければ AIService.createDriver() で生成してキャッシュ
 *
 * @param aiService - AI service instance
 * @param capabilities - Required capabilities for this phase
 * @param hints - Additional selection hints (preferLocal, preferFast, etc.)
 * @param overrideSpec - Override model spec (skips selectModels)
 * @returns ResolvedDriver with driver instance and model metadata
 */
export async function resolveDriver(
  aiService: AIService,
  capabilities: DriverCapability[] = [],
  hints?: SelectionOptions,
  overrideSpec?: ModelSpec,
): Promise<ResolvedDriver | null> {
  let spec: ModelSpec | null;
  if (overrideSpec) {
    spec = overrideSpec;
  } else {
    const models = aiService.selectModels(capabilities, hints);
    spec = models.length ? models[0] : null;
  }
  if (!spec) return null;

  const key = `${spec.provider}:${spec.model}`;

  const cached = cache.get(key);
  if (cached) return { driver: cached, model: spec.model, provider: spec.provider, isNew: false };

  const driver = await aiService.createDriver(spec);
  cache.set(key, driver);
  console.log(`[engine] Driver resolved: ${key} (capabilities: [${capabilities.join(', ')}])`);
  return { driver, model: spec.model, provider: spec.provider, isNew: true };
}

/**
 * Clear the driver cache (for testing)
 */
export function clearDriverCache(): void {
  cache.clear();
}
