import type { AIDriver, AIService, DriverCapability, ModelSpec, SelectionOptions } from '@modular-prompt/driver';
import type { CacheStats } from './types.js';

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

/** In-flight driver creation promises to prevent duplicate concurrent creation */
const inflight = new Map<string, Promise<AIDriver>>();

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

  // Deduplicate concurrent creation for the same key
  const pending = inflight.get(key);
  if (pending) {
    const driver = await pending;
    return { driver, model: spec.model, provider: spec.provider, isNew: false };
  }

  const promise = aiService.createDriver(spec);
  inflight.set(key, promise);
  try {
    const driver = await promise;

    // Apply per-model defaultOptions from metadata
    // AIDriver interface lacks defaultOptions but concrete drivers (VertexAI, etc.) support it
    const modelDefaults = (spec.metadata as Record<string, unknown> | undefined)?.defaultOptions;
    if (modelDefaults && typeof modelDefaults === 'object') {
      const d = driver as unknown as { defaultOptions?: Record<string, unknown> };
      d.defaultOptions = { ...d.defaultOptions, ...modelDefaults as Record<string, unknown> };
    }

    cache.set(key, driver);
    const extras: string[] = [`capabilities: [${capabilities.join(', ')}]`];
    if (spec.driverOptions?.cacheDir) extras.push(`kvCache: ${spec.driverOptions.cacheDir}`);
    console.log(`[engine] Driver resolved: ${key} (${extras.join(', ')})`);
    return { driver, model: spec.model, provider: spec.provider, isNew: true };
  } finally {
    inflight.delete(key);
  }
}

/**
 * Extract cache stats from a driver's cacheController (if present).
 * Works with MlxDriver which has a private cacheController with getStats().
 */
export function getCacheStats(driver: AIDriver): CacheStats | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrl = (driver as any).cacheController;
  if (!ctrl || typeof ctrl.getStats !== 'function') return undefined;
  return ctrl.getStats();
}

/**
 * Clear the driver cache (for testing)
 */
export function clearDriverCache(): void {
  cache.clear();
  inflight.clear();
}
