/**
 * Log file reading utilities
 */
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import type { LogEntry, ServerLogEntry } from './types.js';

/**
 * Get logs directory path
 */
export function getLogsDir(): string {
  return path.join(homedir(), '.sprite-claude/logs/requests');
}

/**
 * Parse a single JSONL log file
 */
export function parseLogFile(filePath: string): LogEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  return lines.map(line => JSON.parse(line) as LogEntry);
}

/**
 * Find all log files for a specific session (PID)
 */
export function findSessionFiles(sessionId: number | null): string[] {
  const logsDir = getLogsDir();

  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }

  const files = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    throw new Error('No log files found');
  }

  if (sessionId) {
    // Filter files by session (PID)
    return files
      .filter(f => {
        const match = f.match(/-(\d+)-\d{4}\.jsonl$/);
        return match && parseInt(match[1]) === sessionId;
      })
      .map(f => path.join(logsDir, f));
  }

  // Find latest session (PID)
  const latestFile = files[files.length - 1];
  const match = latestFile.match(/-(\d+)-\d{4}\.jsonl$/);
  if (!match) {
    throw new Error('Could not extract session ID from filename');
  }

  const latestSessionId = parseInt(match[1]);
  return files
    .filter(f => {
      const m = f.match(/-(\d+)-\d{4}\.jsonl$/);
      return m && parseInt(m[1]) === latestSessionId;
    })
    .map(f => path.join(logsDir, f));
}

/**
 * Find the latest log file
 */
export function findLatestLogFile(): string {
  const logsDir = getLogsDir();

  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }

  const files = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No log files found');
  }

  return path.join(logsDir, files[0]);
}

/**
 * Extract session ID (PID) from log filename
 */
export function extractSessionId(filename: string): number | null {
  const match = filename.match(/-(\d+)-\d{4}\.jsonl$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Find server log file for a session
 */
export function findServerLogFile(sessionId: number | null): string | null {
  const logsDir = getLogsDir();
  const parentDir = path.resolve(logsDir, '..');

  if (sessionId) {
    const filePath = path.join(parentDir, `server-${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) return filePath;
    return null;
  }

  // Find latest server log
  const files = fs.readdirSync(parentDir)
    .filter(f => f.startsWith('server-') && f.endsWith('.jsonl'))
    .map(f => path.join(parentDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files.length > 0 ? files[0] : null;
}

/**
 * Parse server log file
 */
export function parseServerLogFile(filePath: string): ServerLogEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line) as ServerLogEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ServerLogEntry => entry !== null);
}
