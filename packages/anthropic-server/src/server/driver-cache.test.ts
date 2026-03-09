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
    expect(mockSelectModels).toHaveBeenCalledTimes(1);
    expect(mockCreateDriver).toHaveBeenCalledTimes(1); // Driver created
    expect(mockDriverQuery).toHaveBeenCalledTimes(1);

    // Second request
    const response2 = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response2.statusCode).toBe(200);
    expect(mockSelectModels).toHaveBeenCalledTimes(2); // Model selection called again
    expect(mockCreateDriver).toHaveBeenCalledTimes(1); // Driver NOT created again (cached)
    expect(mockDriverQuery).toHaveBeenCalledTimes(2); // Query called on same driver instance

    // Third request
    const response3 = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response3.statusCode).toBe(200);
    expect(mockSelectModels).toHaveBeenCalledTimes(3);
    expect(mockCreateDriver).toHaveBeenCalledTimes(1); // Still only created once
    expect(mockDriverQuery).toHaveBeenCalledTimes(3);
  });
});
