import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import type { ModelSpec, SelectionOptions } from '@modular-prompt/driver';
import type { WorkflowDefinition } from '@sprite-claude/engine';

/**
 * Prompt module definition in YAML format
 */
export interface PromptModuleDefinition {
  objective?: Array<string | Record<string, unknown>>;
  persona?: Array<string | Record<string, unknown>>;
  instructions?: Array<string | Record<string, unknown>>;
  materials?: Array<string | Record<string, unknown>>;
  terms?: Array<string | Record<string, unknown>>;
}

/**
 * Server configuration from config.yaml
 */
export interface ServerConfig {
  models?: (ModelSpec & { disabled?: boolean })[];
  drivers?: {
    mlx?: Record<string, unknown>;
    vertexai?: {
      project?: string;
      location?: string;
      credentialsPath?: string;
    };
    openai?: {
      apiKey?: string;
      baseURL?: string;
      organization?: string;
    };
    anthropic?: {
      apiKey?: string;
      baseURL?: string;
    };
    ollama?: {
      baseURL?: string;
    };
  };
  selection?: SelectionOptions & {
    requiredCapabilities?: string[];
  };
  server?: {
    port?: number;
    host?: string;
  };
  logging?: {
    level?: string;
    request_response_level?: string;
  };
  prompts?: Record<string, Array<string | PromptModuleDefinition>>;
  runtime?: {
    pid_dir?: string;
    log_dir?: string;
  };
  workflows?: Record<string, WorkflowDefinition>;
  modelMapping?: Record<string, string>;
  routingWorkflow?: string;
  defaultOptions?: Record<string, unknown>;
  /** ワークフロー実行のタイムアウト（ミリ秒）。デフォルト: 300000 (5分) */
  workflowTimeout?: number;
}

/**
 * Expand tilde (~) in path to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return resolve(homeDir, path.slice(2));
  }
  return resolve(path);
}

/**
 * Load configuration from YAML file
 */
export function loadConfig(configPath: string): ServerConfig {
  const expandedPath = expandPath(configPath);

  try {
    const content = readFileSync(expandedPath, 'utf8');
    const config = yaml.load(content) as ServerConfig;
    if (!config) return {};

    return config;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(`Config file not found: ${expandedPath}, using defaults`);
      return {};
    }
    throw new Error(`Failed to load config from ${expandedPath}: ${error}`);
  }
}

/**
 * Set up environment variables for drivers
 */
export function setupDriverEnvironment(config: ServerConfig): void {
  if (!config.drivers) return;

  // VertexAI credentials
  const vertexaiConfig = config.drivers.vertexai;
  if (vertexaiConfig?.credentialsPath) {
    const credentialsPath = expandPath(vertexaiConfig.credentialsPath);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    console.log(`Setting GOOGLE_APPLICATION_CREDENTIALS=${credentialsPath}`);
  }

  // Other drivers can be added here in the future
}

export { expandPath };
