#!/usr/bin/env node
/**
 * Log extraction tool with Commander.js
 */
import { Command } from 'commander';
import { PHASES, PHASE_DESCRIPTIONS, type Phase } from './types.js';
import { findSessionFiles, parseLogFile, extractSessionId, findServerLogFile, parseServerLogFile } from './log-reader.js';
import { extractSessionSummary, displaySessionSummary } from './session-summary.js';
import {
  findMessageEntry,
  extractAllPhaseData,
  filterPhaseData,
  displayPhaseData,
  savePhaseData,
  inspectRequest,
} from './message-detail.js';

const program = new Command();

program
  .name('extract-log')
  .description('Extract prompts and outputs from sprite-claude logs')
  .version('2.0.0')
  .addHelpText('after', `
Examples:
  # Show session summary (default command)
  $ extract-log summary
  $ extract-log summary --session 12345

  # Show latest message details
  $ extract-log show
  $ extract-log show --latest

  # Show message from specific session
  $ extract-log show --session 12345

  # Search for specific message
  $ extract-log show "user query text"
  $ extract-log show --session 12345 "user query text"

  # Filter by phase
  $ extract-log show --phase phase1-analysis
  $ extract-log show --phase phase1-analysis phase2-tool-generation

  # Show only prompts or outputs
  $ extract-log show --prompt-only
  $ extract-log show --output-only

  # Save to files
  $ extract-log show --save

  # List available phases
  $ extract-log phases
`);

/**
 * Summary command: Display session summary
 */
program
  .command('summary')
  .description('Display session summary (list of all requests)')
  .option('-s, --session <pid>', 'Session ID (PID). If not specified, uses latest session')
  .action(async (options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const sessionFiles = findSessionFiles(sessionId);

      if (sessionFiles.length === 0) {
        console.error('❌ No session files found');
        process.exit(1);
      }

      const actualSessionId = extractSessionId(sessionFiles[0]) || 'unknown';
      const summary = extractSessionSummary(sessionFiles);
      displaySessionSummary(summary, actualSessionId);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Show command: Display detailed message with prompts/outputs
 */
program
  .command('show')
  .description('Show detailed prompts and outputs for a specific request')
  .argument('[query]', 'Search query to find the message. If not specified, shows latest message')
  .option('-s, --session <pid>', 'Session ID (PID). If not specified, uses latest session')
  .option('-l, --latest', 'Show latest message (same as omitting query)')
  .option('-p, --phase <phases...>', 'Filter by specific phases (e.g., phase1-analysis main)')
  .option('--prompt-only', 'Show only prompts')
  .option('--output-only', 'Show only outputs')
  .option('--meta', 'Show LLM response metadata (model, finishReason, usage, toolCalls)')
  .option('--save', 'Save to files in /tmp')
  .action(async (query, options) => {
    try {
      // Handle --latest flag
      const searchQuery = options.latest ? null : query || null;

      // Get session files
      const sessionId = options.session ? parseInt(options.session) : null;
      const sessionFiles = findSessionFiles(sessionId);

      if (sessionFiles.length === 0) {
        console.error('❌ No session files found');
        process.exit(1);
      }

      // Use the latest file from the session
      const logFile = sessionFiles[sessionFiles.length - 1];
      const entries = parseLogFile(logFile);
      const messageEntry = findMessageEntry(entries, searchQuery);

      if (!messageEntry) {
        console.error('❌ Message not found');
        process.exit(1);
      }

      console.log(`\n🔍 Found message in seqId: ${messageEntry.seqId}`);
      console.log(`📁 Log file: ${logFile}`);
      console.log(`  Timestamp: ${messageEntry.timestamp}\n`);

      // Extract all phase data
      const allPhaseData = extractAllPhaseData(entries, messageEntry.seqId);

      // Filter by phase if specified
      const phaseFilter = options.phase as Phase[] | undefined;
      const phaseData = filterPhaseData(allPhaseData, phaseFilter);

      if (phaseData.length === 0) {
        console.log('⚠️  No phase data found for the specified filters');
        return;
      }

      // Determine what to show
      const showPrompt = options.promptOnly || (!options.promptOnly && !options.outputOnly);
      const showOutput = options.outputOnly || (!options.promptOnly && !options.outputOnly);
      const showMeta = !!options.meta;

      // Display phase data
      for (const pd of phaseData) {
        displayPhaseData(pd, showPrompt, showOutput, showMeta);

        if (options.save) {
          savePhaseData(pd, messageEntry.seqId);
        }
      }

      console.log('\n✓ Done\n');
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Phases command: List all available phases
 */
program
  .command('phases')
  .description('List all available phase types')
  .action(() => {
    console.log('\n📋 Available Phase Types\n');
    console.log('='.repeat(80));

    const phaseEntries = Object.entries(PHASES);
    for (const [, value] of phaseEntries) {
      const description = PHASE_DESCRIPTIONS[value as Phase];
      console.log(`${value.padEnd(30)} ${description}`);
    }

    console.log('='.repeat(80));
    console.log('\n💡 Usage:');
    console.log('  extract-log show --phase phase1-analysis');
    console.log('  extract-log show "search term" --phase main phase2-response-generation\n');
  });

/**
 * Inspect command: Display structural overview of a request
 */
program
  .command('inspect')
  .description('Display structural overview of all entries for a specific request')
  .argument('[query]', 'Search query to find the message. If not specified, shows latest message')
  .option('-s, --session <pid>', 'Session ID (PID)')
  .option('--seq <seqId>', 'Sequence ID (e.g., 0003)')
  .action(async (query, options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const sessionFiles = findSessionFiles(sessionId);

      if (sessionFiles.length === 0) {
        console.error('❌ No session files found');
        process.exit(1);
      }

      // Collect all entries from all session files
      const allEntries: ReturnType<typeof parseLogFile> = [];
      for (const file of sessionFiles) {
        allEntries.push(...parseLogFile(file));
      }

      let targetSeqId: string;

      if (options.seq) {
        targetSeqId = options.seq.padStart(4, '0');
      } else {
        // Find by query or use latest
        const logFile = sessionFiles[sessionFiles.length - 1];
        const entries = parseLogFile(logFile);
        const messageEntry = findMessageEntry(entries, query || null);
        if (!messageEntry) {
          console.error('❌ Message not found');
          process.exit(1);
        }
        targetSeqId = messageEntry.seqId;
      }

      inspectRequest(allEntries, targetSeqId);
      console.log('');
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Server command: Display server lifecycle logs
 */
program
  .command('server')
  .description('Display server lifecycle logs (startup, config, errors)')
  .option('-s, --session <pid>', 'Session ID (PID). If not specified, uses latest server log')
  .option('-l, --level <levels...>', 'Filter by log level (info, warn, error, debug)')
  .option('-c, --category <categories...>', 'Filter by category (startup, config, driver, request, shutdown)')
  .action(async (options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const logFile = findServerLogFile(sessionId);

      if (!logFile) {
        console.error('❌ No server log file found');
        process.exit(1);
      }

      const entries = parseServerLogFile(logFile);

      // Apply filters
      let filtered = entries;
      if (options.level) {
        const levels = new Set(options.level as string[]);
        filtered = filtered.filter(e => levels.has(e.level));
      }
      if (options.category) {
        const categories = new Set(options.category as string[]);
        filtered = filtered.filter(e => categories.has(e.category));
      }

      // Extract PID from filename
      const pidMatch = logFile.match(/server-(\d+)\.jsonl$/);
      const displayPid = pidMatch ? pidMatch[1] : 'unknown';

      console.log(`\n📋 Server Log (PID: ${displayPid})\n`);
      console.log(`📁 Log file: ${logFile}`);
      console.log(`📊 Total entries: ${entries.length}, Filtered: ${filtered.length}\n`);
      console.log('='.repeat(120));
      console.log('Timestamp         | Level | Category | Message');
      console.log('='.repeat(120));

      for (const entry of filtered) {
        const time = new Date(entry.timestamp).toISOString().substring(11, 23);
        const level = entry.level.padEnd(5);
        const category = entry.category.padEnd(8);
        const levelIcon = entry.level === 'error' ? '✗' : entry.level === 'warn' ? '⚠' : ' ';
        console.log(`${time} | ${levelIcon}${level} | ${category} | ${entry.message}`);
        if (entry.data) {
          console.log(`                   |       |          | ${JSON.stringify(entry.data)}`);
        }
      }

      console.log('='.repeat(120));
      console.log(`\n✓ Done\n`);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Show help if no command is specified
if (process.argv.length === 2) {
  program.help();
}

program.parse();
