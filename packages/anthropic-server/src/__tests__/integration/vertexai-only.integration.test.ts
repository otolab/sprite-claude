import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, setupDriverEnvironment } from '../../server/config.js';
import { AIService } from '@modular-prompt/driver';
import type { ApplicationConfig } from '@modular-prompt/driver';
import { compile } from '@modular-prompt/core';
import { resolve } from 'path';

describe('Vertex AI Only Configuration', () => {
  const configPath = resolve(process.cwd(), '../../config.test-vertexai.yaml');
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original environment variable
    originalEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    // Clear to ensure test isolation
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalEnv;
    } else {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  });

  it('should initialize AIService with config', () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const aiServiceConfig: ApplicationConfig = {
      models: config.models || [],
      drivers: config.drivers || {},
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 1024,
      },
    };

    const aiService = new AIService(aiServiceConfig);

    expect(aiService).toBeDefined();
    expect(config.models?.length).toBeGreaterThan(0);
  });

  it('should handle simple message request using Vertex AI', async () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const aiServiceConfig: ApplicationConfig = {
      models: config.models || [],
      drivers: config.drivers || {},
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 100,
      },
    };

    const aiService = new AIService(aiServiceConfig);

    const promptModule = {
      instructions: ['あなたは親切なアシスタントです。'],
      data: ['「こんにちは」と挨拶してください。'],
    };

    const compiledPrompt = compile(promptModule, {});

    // Request tools capability to ensure Vertex AI is selected
    const driver = await aiService.createDriverFromCapabilities(['tools'], {});

    expect(driver).toBeDefined();

    const result = await driver!.query(compiledPrompt, {
      maxTokens: 100,
    });

    console.log('Simple message result:', JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect(result.finishReason).not.toBe('error');
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle request with tools capability', async () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const aiServiceConfig: ApplicationConfig = {
      models: config.models || [],
      drivers: config.drivers || {},
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 100,
      },
    };

    const aiService = new AIService(aiServiceConfig);

    const driver = await aiService.createDriverFromCapabilities(['tools'], {});

    expect(driver).toBeDefined();

    // Vertex AI driver should support tools capability
    const promptModule = {
      instructions: ['あなたは親切なアシスタントです。'],
      data: ['現在の時刻を教えてください。'],
    };

    const compiledPrompt = compile(promptModule, {});

    const result = await driver!.query(compiledPrompt, {
      maxTokens: 100,
    });

    console.log('Tools request result:', JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect(result.finishReason).not.toBe('error');
  }, 30000);

  it('should select Vertex AI when tools capability is required', async () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const aiServiceConfig: ApplicationConfig = {
      models: config.models || [],
      drivers: config.drivers || {},
      defaultOptions: {
        temperature: 0.7,
        maxTokens: 50,
      },
    };

    const aiService = new AIService(aiServiceConfig);

    // Request tools capability - this will select Vertex AI
    const driver = await aiService.createDriverFromCapabilities(['tools'], {});

    expect(driver).toBeDefined();

    // Vertex AI should be able to handle requests
    const promptModule = {
      instructions: ['Return a short greeting in Japanese.'],
      data: [],
    };

    const compiledPrompt = compile(promptModule, {});

    const result = await driver!.query(compiledPrompt, {
      maxTokens: 50,
    });

    console.log('Vertex AI result:', JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect(result.finishReason).toBe('stop');
    expect(result.content).toBeDefined();
  }, 30000);
});
