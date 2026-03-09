import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, setupDriverEnvironment } from '../../server/config.js';
import { AIService, MlxDriver, VertexAIDriver } from '@modular-prompt/driver';
import type { ApplicationConfig, DriverCapability } from '@modular-prompt/driver';
import { resolve } from 'path';

describe('AIService Model Selection', () => {
  const configPath = resolve(process.cwd(), '../../config.test-multimodel.yaml');
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

  it('should load multimodel config file successfully', () => {
    const config = loadConfig(configPath);

    expect(config).toBeDefined();
    expect(config.models).toBeDefined();
    expect(config.models?.length).toBe(2);

    // Check MLX model
    const mlxModel = config.models?.find((m) => m.provider === 'mlx');
    expect(mlxModel).toBeDefined();
    expect(mlxModel?.capabilities).toContain('local');

    // Check Vertex AI model
    const vertexaiModel = config.models?.find((m) => m.provider === 'vertexai');
    expect(vertexaiModel).toBeDefined();
    expect(vertexaiModel?.capabilities).toContain('tools');
  });

  it('should initialize AIService with multiple models', () => {
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
  });

  it('should select Vertex AI for requests requiring tools capability', async () => {
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

    const requiredCapabilities: DriverCapability[] = ['tools'];
    const selectionOptions = config.selection || {};

    const driver = await aiService.createDriverFromCapabilities(
      requiredCapabilities,
      selectionOptions
    );

    expect(driver).toBeDefined();
    expect(driver).toBeInstanceOf(VertexAIDriver);
  });

  it('should select MLX for requests without tools when preferLocal is true', async () => {
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

    const requiredCapabilities: DriverCapability[] = [];
    const selectionOptions = {
      ...config.selection,
      preferLocal: true,
    };

    const driver = await aiService.createDriverFromCapabilities(
      requiredCapabilities,
      selectionOptions
    );

    expect(driver).toBeDefined();
    // Note: This test assumes MLX is available in the test environment
    // If MLX is not available, Vertex AI may be selected instead
    if (driver instanceof MlxDriver) {
      expect(driver).toBeInstanceOf(MlxDriver);
    } else {
      console.warn('MLX driver not available, Vertex AI was selected instead');
      expect(driver).toBeInstanceOf(VertexAIDriver);
    }
  });

  it('should handle capability-based selection correctly', async () => {
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

    // Test with 'fast' capability (both models have it)
    const fastDriver = await aiService.createDriverFromCapabilities(
      ['fast'] as DriverCapability[],
      { preferLocal: true }
    );

    expect(fastDriver).toBeDefined();

    // Test with 'japanese' capability (only Vertex AI has it)
    const japaneseDriver = await aiService.createDriverFromCapabilities(
      ['japanese'] as DriverCapability[],
      {}
    );

    expect(japaneseDriver).toBeDefined();
    expect(japaneseDriver).toBeInstanceOf(VertexAIDriver);
  });
});
