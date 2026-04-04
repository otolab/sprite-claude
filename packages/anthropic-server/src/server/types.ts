import type { AIService, ModelSpec, SelectionOptions } from '@modular-prompt/driver';
import type { PromptModuleDefinition } from './config.js';
import type { WorkflowDefinition } from '@sprite-claude/engine';

/**
 * Options for Anthropic-compatible server
 */
export interface AnthropicServerOptions {
  // Server settings
  port?: number;
  host?: string;

  // Legacy: Single model specification (for backward compatibility)
  model?: string;

  // AIService configuration
  models?: ModelSpec[];
  drivers?: {
    openai?: { apiKey?: string; baseURL?: string; organization?: string };
    anthropic?: { apiKey?: string; baseURL?: string };
    vertexai?: { project?: string; location?: string };
    mlx?: { baseURL?: string; pythonPath?: string };
    ollama?: { baseURL?: string };
  };

  // Model selection options
  selection?: SelectionOptions & {
    requiredCapabilities?: string[];
  };

  // Logging settings
  logging?: {
    // Request/Response log level
    // 'none': Don't save req/res files
    // 'minimal': Save metadata only (model, tokens, stop_reason, etc.)
    // 'full': Save complete req/res (default)
    requestResponseLevel?: 'none' | 'minimal' | 'full';
    // Main log level
    level?: 'debug' | 'info' | 'warn' | 'error';
  };

  // Prompt settings
  prompts?: Record<string, Array<string | PromptModuleDefinition>>;

  // Configuration directory
  configDir?: string;

  // Token limits
  maxTokens?: {
    // Max tokens for Phase 1 (Analysis)
    phase1?: number;
    // Max tokens for Phase 2 Tool Generation
    phase2Tool?: number;
    // Max tokens for Phase 2 Response Generation
    phase2Response?: number;
  };

  workflows?: Record<string, WorkflowDefinition>;
  modelMapping?: Record<string, string>;
  routingWorkflow?: string;
}

// Extend Fastify instance type
declare module 'fastify' {
  interface FastifyInstance {
    aiService: AIService;
  }
}
