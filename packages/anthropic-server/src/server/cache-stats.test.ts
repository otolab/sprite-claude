import { describe, it, expect } from 'vitest';
import { getCacheStats, getAllCacheStats } from '@sprite-claude/engine';

describe('getCacheStats', () => {
  it('should return undefined for a driver without cacheController', () => {
    const driver = { query: async () => ({}) } as any;
    expect(getCacheStats(driver)).toBeUndefined();
  });

  it('should return undefined when cacheController lacks getStats', () => {
    const driver = { query: async () => ({}), cacheController: {} } as any;
    expect(getCacheStats(driver)).toBeUndefined();
  });

  it('should return stats from cacheController.getStats()', () => {
    const mockStats = {
      totalQueries: 10,
      incremental: 7,
      fresh: 3,
      totalPromptTokens: 5000,
      prefillReusedTokens: 3500,
      cacheGrowthTokens: 1500,
    };
    const driver = {
      query: async () => ({}),
      cacheController: { getStats: () => mockStats },
    } as any;

    const result = getCacheStats(driver);
    expect(result).toEqual(mockStats);
  });
});

describe('getAllCacheStats', () => {
  const makeDriver = (stats?: Record<string, number>) => ({
    query: async () => ({}),
    ...(stats && { cacheController: { getStats: () => stats } }),
  }) as any;

  const mockStats = {
    totalQueries: 10, incremental: 7, fresh: 3,
    totalPromptTokens: 5000, prefillReusedTokens: 3500, cacheGrowthTokens: 1500,
  };

  it('should return empty object when no drivers have cache', () => {
    const driverSet = { default: makeDriver(), chat: makeDriver() };
    expect(getAllCacheStats(driverSet)).toEqual({});
  });

  it('should collect stats from all unique drivers', () => {
    const stats2 = { ...mockStats, totalQueries: 20 };
    const driverSet = {
      default: makeDriver(mockStats),
      thinking: makeDriver(stats2),
    };
    const result = getAllCacheStats(driverSet);
    expect(result).toEqual({ default: mockStats, thinking: stats2 });
  });

  it('should deduplicate shared driver instances', () => {
    const shared = makeDriver(mockStats);
    const driverSet = { default: shared, chat: shared, plan: shared };
    const result = getAllCacheStats(driverSet);
    expect(Object.keys(result)).toEqual(['default']);
    expect(result.default).toEqual(mockStats);
  });
});
