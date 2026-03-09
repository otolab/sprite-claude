import type { AIDriver, AIService, DriverCapability, SelectionOptions } from '@modular-prompt/driver';

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
 * @returns ResolvedDriver with driver instance and model metadata
 */
export async function resolveDriver(
  aiService: AIService,
  capabilities: DriverCapability[] = [],
  hints?: SelectionOptions,
): Promise<ResolvedDriver> {
  const models = aiService.selectModels(capabilities, { lenient: true, ...hints });
  if (!models.length) {
    throw new Error(`No suitable model found for capabilities: [${capabilities.join(', ')}]`);
  }

  const spec = models[0];
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
