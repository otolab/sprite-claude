import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, setupDriverEnvironment } from '../../server/config.js';
import { VertexAIDriver } from '@modular-prompt/driver';
import { compile } from '@modular-prompt/core';
import { resolve } from 'path';

describe('Vertex AI Configuration Integration', () => {
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

  it('should load config file successfully', () => {
    const config = loadConfig(configPath);

    expect(config).toBeDefined();
    expect(config.models).toBeDefined();
    expect(config.drivers).toBeDefined();
  });

  it('should load Vertex AI driver configuration', () => {
    const config = loadConfig(configPath);

    expect(config.drivers?.vertexai).toBeDefined();
    expect(config.drivers?.vertexai?.project).toBe('otolab-161708');
    expect(config.drivers?.vertexai?.location).toBe('us-central1');
    expect(config.drivers?.vertexai?.credentialsPath).toBeDefined();
  });

  it('should set up environment variables for credentials', () => {
    const config = loadConfig(configPath);

    setupDriverEnvironment(config);

    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeDefined();
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toContain('otolab-vertexai-key.json');
  });

  it('should initialize VertexAIDriver with config', () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const vertexaiConfig = config.drivers?.vertexai;
    expect(vertexaiConfig).toBeDefined();

    const driver = new VertexAIDriver({
      project: vertexaiConfig!.project,
      location: vertexaiConfig!.location,
      model: 'gemini-2.0-flash-exp',
    });

    expect(driver).toBeDefined();
  });

  it('should call Vertex AI API and get response', async () => {
    const config = loadConfig(configPath);
    setupDriverEnvironment(config);

    const vertexaiConfig = config.drivers?.vertexai;
    expect(vertexaiConfig).toBeDefined();

    const driver = new VertexAIDriver({
      project: vertexaiConfig!.project,
      location: vertexaiConfig!.location,
      model: 'gemini-2.0-flash-exp',
    });

    const promptModule = {
      instructions: ['あなたは親切なアシスタントです。'],
      data: ['こんにちは！'],
    };

    const compiledPrompt = compile(promptModule, {});

    const result = await driver.query(compiledPrompt, {
      maxTokens: 50,
    });

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect(result.finishReason).not.toBe('error');

    if (result.finishReason === 'error') {
      throw new Error('API call returned error');
    }

    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  }, 30000);
});
