import { describe, it, expect } from 'vitest';
import { getCacheStats } from '@sprite-claude/engine';

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
