#!/usr/bin/env node

import { program } from 'commander';
import { startServer } from './server/index.js';
import { loadConfig, setupDriverEnvironment, type ServerConfig } from './server/config.js';

program
  .name('anthropic-server')
  .description('Anthropic Messages API compatible server using modular-prompt')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to config file (YAML)')
  .option('-p, --port <port>', 'Server port (overrides config)')
  .option('-h, --host <host>', 'Server host (overrides config)')
  .option('-m, --model <model>', 'MLX model name (legacy, for single model)')
  .option('--models <json>', 'Models configuration as JSON string (deprecated, use config file)')
  .option('--drivers <json>', 'Drivers configuration as JSON string (deprecated, use config file)')
  .option('--selection <json>', 'Selection options as JSON string (deprecated, use config file)')
  .option('--log-level <level>', 'Main log level (debug|info|warn|error)')
  .option('--req-res-level <level>', 'Request/Response log level (none|minimal|full)')
  .option('--max-tokens-phase1 <tokens>', 'Max tokens for Phase 1 (Analysis)', '2000')
  .option('--max-tokens-phase2-tool <tokens>', 'Max tokens for Phase 2 (Tool Generation)', '1000')
  .option('--max-tokens-phase2-response <tokens>', 'Max tokens for Phase 2 (Response Generation)', '2000')
  .option('--additional-instructions <text>', 'Additional instructions (inline text or @file reference)')
  .action(async (options) => {
    try {
      // Load config file if provided
      let config: ServerConfig = {};
      if (options.config) {
        config = loadConfig(options.config);
        // Set up environment variables for drivers (e.g., credentials)
        setupDriverEnvironment(config);
      }

      // disabled フィルタは AIService.selectModels() で処理 (driver 0.6.3+)
      let models = config.models;
      if (options.models) {
        console.warn('⚠️  --models option is deprecated, use config file instead');
        try {
          models = JSON.parse(options.models);
        } catch {
          console.error(`❌ Invalid models JSON: ${options.models}`);
          process.exit(1);
        }
      }

      let drivers = config.drivers;
      if (options.drivers) {
        console.warn('⚠️  --drivers option is deprecated, use config file instead');
        try {
          drivers = JSON.parse(options.drivers);
        } catch {
          console.error(`❌ Invalid drivers JSON: ${options.drivers}`);
          process.exit(1);
        }
      }

      let selection = config.selection;
      if (options.selection) {
        console.warn('⚠️  --selection option is deprecated, use config file instead');
        try {
          selection = JSON.parse(options.selection);
        } catch {
          console.error(`❌ Invalid selection JSON: ${options.selection}`);
          process.exit(1);
        }
      }

      // CLI options override config file
      const port = options.port ? parseInt(options.port, 10) : (config.server?.port || 3000);
      const host = options.host || config.server?.host || '0.0.0.0';
      const logLevel = options.logLevel || config.logging?.level || 'info';
      const reqResLevel = options.reqResLevel || config.logging?.request_response_level || 'full';
      const additionalInstructions = options.additionalInstructions || config.prompt?.additional_instructions;

      // Workflow mode from config
      const workflowMode = config.workflow?.mode as 'rag' | 'decision' | 'chat' | 'passthrough' | undefined;

      await startServer({
        port,
        host,
        model: options.model || 'mlx-community/gemma-2-2b-it-4bit',
        models,
        drivers,
        selection,
        logging: {
          level: logLevel as 'debug' | 'info' | 'warn' | 'error',
          requestResponseLevel: reqResLevel as 'none' | 'minimal' | 'full',
        },
        prompt: additionalInstructions ? {
          additionalInstructions,
        } : undefined,
        maxTokens: {
          phase1: parseInt(options.maxTokensPhase1, 10),
          phase2Tool: parseInt(options.maxTokensPhase2Tool, 10),
          phase2Response: parseInt(options.maxTokensPhase2Response, 10),
        },
        workflow: workflowMode ? { mode: workflowMode } : undefined,
      });
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
