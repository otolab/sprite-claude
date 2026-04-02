/**
 * Driver Cache Functionality Tests
 * Tests that the server caches driver instances across multiple requests
 */

import { describe, it, expect, vi } from 'vitest';
import { createServer } from './index.js';
import type { MessagesRequest } from '../schema.js';

// Mock driver instance
const mockDriverQuery = vi.fn().mockResolvedValue({
  content: 'test response',
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 5,
  },
});

const mockDriver = {
  query: mockDriverQuery,
};

// Mock createDriver to track calls
const mockCreateDriver = vi.fn().mockResolvedValue(mockDriver);
const mockSelectModels = vi.fn().mockReturnValue([
  { model: 'test-model', provider: 'mlx', capabilities: ['local'], priority: 10 }
]);

vi.mock('@modular-prompt/driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modular-prompt/driver')>();
  return {
    ...actual,
    MlxDriver: vi.fn().mockImplementation(() => mockDriver),
    AIService: vi.fn().mockImplementation(() => ({
      selectModels: mockSelectModels,
      createDriver: mockCreateDriver,
    })),
  };
});

describe('Driver Cache', () => {
  it('should cache driver instances for the same model across requests', async () => {
    // Create server
    const server = await createServer({
      port: 3002,
      model: 'test-model',
    });

    // Reset mock call counts
    mockCreateDriver.mockClear();
    mockSelectModels.mockClear();
    mockDriverQuery.mockClear();

    const request: MessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
    };

    // First request
    const response1 = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response1.statusCode).toBe(200);
    // agenticワークフローは4役割(default, chat, reasoning, structured)のドライバーを解決
    // agenticProcessは内部で複数回queryを呼ぶ(planning + output)
    const firstCreateCount = mockCreateDriver.mock.calls.length;
    const firstQueryCount = mockDriverQuery.mock.calls.length;
    expect(firstCreateCount).toBeGreaterThanOrEqual(1);
    expect(firstQueryCount).toBeGreaterThanOrEqual(1);

    // Second request — キャッシュにヒットするのでcreateDriverは増えない
    const response2 = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response2.statusCode).toBe(200);
    expect(mockCreateDriver).toHaveBeenCalledTimes(firstCreateCount); // Driver NOT created again (cached)
    expect(mockDriverQuery).toHaveBeenCalledTimes(firstQueryCount * 2); // Same query pattern repeated

    // Third request
    const response3 = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response3.statusCode).toBe(200);
    expect(mockCreateDriver).toHaveBeenCalledTimes(firstCreateCount); // Still cached
    expect(mockDriverQuery).toHaveBeenCalledTimes(firstQueryCount * 3);
  });
});
