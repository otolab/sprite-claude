import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createServer } from './fastify-server.js';
import { createServerLogger } from './logging.js';
import type { AnthropicServerOptions } from './types.js';

/**
 * Start Anthropic-compatible server
 *
 * This function:
 * - Clears previous log file on startup
 * - Creates and starts Fastify server
 * - Listens on specified host and port
 */
export async function startServer(options: AnthropicServerOptions = {}): Promise<FastifyInstance> {
  const serverLogger = createServerLogger(process.pid);

  // Clear log file on startup
  const logDir = join(homedir(), '.nympish-claude', 'logs');
  const logFile = join(logDir, 'anthropic-server.log');
  if (existsSync(logFile)) {
    try {
      unlinkSync(logFile);
      serverLogger.info('startup', 'Cleared previous log file');
    } catch (error) {
      serverLogger.warn('startup', 'Could not clear log file', { error: String(error) });
    }
  }

  const server = await createServer(options);

  const port = options.port || 3000;
  const host = options.host || '0.0.0.0';

  try {
    await server.listen({ port, host });
    serverLogger.info('startup', `Server running at http://${host}:${port}`);
    return server;
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

// Re-export types and functions
export type { AnthropicServerOptions } from './types.js';
export { createServer } from './fastify-server.js';
