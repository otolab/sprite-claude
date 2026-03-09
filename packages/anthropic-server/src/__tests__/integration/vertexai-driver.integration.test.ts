import { describe, it, expect } from 'vitest';
import { VertexAIDriver } from '@modular-prompt/driver';
import { compile } from '@modular-prompt/core';

describe('VertexAI Driver Integration', () => {
  it('should import VertexAIDriver successfully', () => {
    expect(VertexAIDriver).toBeDefined();
    expect(typeof VertexAIDriver).toBe('function');
    expect(VertexAIDriver.name).toBe('VertexAIDriver');
  });

  it('should import compile successfully', () => {
    expect(compile).toBeDefined();
    expect(typeof compile).toBe('function');
  });

  it('should create VertexAIDriver instance', () => {
    const driver = new VertexAIDriver({
      project: 'otolab-161708',
      location: 'us-central1',
    });
    expect(driver).toBeDefined();
  });

  it('should call Vertex AI API and get response', async () => {
    const driver = new VertexAIDriver({
      project: 'otolab-161708',
      location: 'us-central1',
      model: 'gemini-2.0-flash-001',
    });

    const promptModule = {
      instructions: ['あなたは親切なアシスタントです。'],
      data: ['こんにちは！'],
    };

    const compiledPrompt = compile(promptModule, {});
    const result = await driver.query(compiledPrompt, {
      maxTokens: 50,
      temperature: 0.7,
    });

    // デバッグ情報を出力
    console.log('Result:', JSON.stringify(result, null, 2));

    // レスポンスが返ってくることを確認
    expect(result).toBeDefined();
    expect(result.finishReason).not.toBe('error');

    if (result.finishReason === 'error') {
      throw new Error('API call returned error');
    }

    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);

    await driver.close();
  }, 30000); // 30秒のタイムアウト
});
