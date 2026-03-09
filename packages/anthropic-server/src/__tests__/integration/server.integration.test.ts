import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../../server/index.js';
import type { MessagesRequest } from '../../schema.js';

// Mock driver classes with partial mock
const mockDriverQuery = vi.fn().mockResolvedValue({
  content: 'こんにちは!元気ですよ。',
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 15,
  },
});

const mockDriver = {
  query: mockDriverQuery,
};

vi.mock('@modular-prompt/driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modular-prompt/driver')>();
  return {
    ...actual,
    MlxDriver: vi.fn().mockImplementation(() => mockDriver),
    AIService: vi.fn().mockImplementation(() => ({
      createDriverFromCapabilities: vi.fn().mockResolvedValue(mockDriver),
      selectModels: vi.fn().mockReturnValue([
        { model: 'test-model', provider: 'mlx', capabilities: ['local'], priority: 10 }
      ]),
      createDriver: vi.fn().mockResolvedValue(mockDriver),
    })),
  };
});

describe('Anthropic Server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    server = await createServer({
      port: 3001,
      model: 'test-model',
    });
  });

  it('should respond to health check', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('should handle messages request', async () => {
    const request: MessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: 'こんにちは、元気ですか?',
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('id');
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe('text');
    expect(body.content[0].text).toBe('こんにちは!元気ですよ。');
    expect(body.model).toBe('claude-3-5-sonnet-20241022');
    expect(body.stop_reason).toBe('end_turn');
    // Note: Both input_tokens and output_tokens are currently hardcoded to 0 in messages/index.ts (TODO item)
    expect(body.usage.input_tokens).toBe(0);
    expect(body.usage.output_tokens).toBe(0);
  });

  it('should handle system message', async () => {
    const request: MessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: 'あなたは親切なアシスタントです。',
      messages: [
        {
          role: 'user',
          content: 'こんにちは',
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response.statusCode).toBe(200);
  });

  it('should handle multi-turn conversation', async () => {
    const request: MessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: '私の名前は太郎です',
        },
        {
          role: 'assistant',
          content: 'こんにちは太郎さん!',
        },
        {
          role: 'user',
          content: '私の名前は何ですか?',
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: request,
    });

    expect(response.statusCode).toBe(200);
  });
});
