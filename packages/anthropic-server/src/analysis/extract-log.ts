#!/usr/bin/env node
/**
 * extract-log: Navigate sprite-claude request logs
 *
 * Logs are JSONL files at ~/.sprite-claude/logs/requests/
 * Each file = one request, each line = one entry (request, prompt, llm_response, response)
 *
 * Drill-down flow:
 *   summary  ->  show --seq <id>  ->  show --seq <id> --messages  ->  show --seq <id> --raw <path>
 *   (files)      (entries)            (message structure)              (raw value)
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
  displayMessages,
  extractRawValue,
} from './message-detail.js';

const program = new Command();

program
  .name('extract-log')
  .description(`Navigate sprite-claude request logs.

Logs are JSONL files in ~/.sprite-claude/logs/requests/.
Each file is one request. Each line is an entry (request/prompt/llm_response/response).

Drill-down:
  summary                         List all requests in a session (file-level map)
  show --seq <id>                 Show entries in a request (entry-level map)
  show --seq <id> --messages      Show message structure (message-level map)
  show --seq <id> --raw <path>    Extract raw value by path`)
  .version('3.0.0')
  .addHelpText('after', `
Examples:
  # 1. Session overview (which files to look at)
  extract-log summary
  extract-log summary --session 9706

  # 2. Request structure (which entries/lines to look at)
  extract-log show --seq 0014
  extract-log show                          # latest request

  # 3. Message structure (what's in the messages array)
  extract-log show --seq 0014 --messages

  # 4. Raw value (read specific data from JSONL)
  extract-log show --seq 0014 --raw 'L1.data.messages[1].content[0].text'
  extract-log show --seq 0014 --raw 'L3.data.content'

  # Show prompt/output content
  extract-log show --seq 0014 --phase agentic
  extract-log show --seq 0014 --phase agentic --meta

  # Save to files
  extract-log show --seq 0014 --save

  # Server lifecycle logs
  extract-log server
`);

// ---------------------------------------------------------------------------
// summary: session overview (file-level map)
// ---------------------------------------------------------------------------
program
  .command('summary')
  .description(`List all requests in a session.
Shows: seqId, workflow type, tools/messages count, result, model, user message.
Each row = one JSONL file. Use seqId with "show --seq" to drill down.`)
  .option('-s, --session <pid>', 'Session ID (PID). Default: latest session')
  .action(async (options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const sessionFiles = findSessionFiles(sessionId);

      if (sessionFiles.length === 0) {
        console.error('No session files found');
        process.exit(1);
      }

      const actualSessionId = extractSessionId(sessionFiles[0]) || 'unknown';
      const summary = extractSessionSummary(sessionFiles);
      displaySessionSummary(summary, actualSessionId);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// show: request detail (entry-level / message-level / raw)
// ---------------------------------------------------------------------------
program
  .command('show')
  .description(`Show details of a specific request.

Default: entry-level map (what entries exist, their sizes)
  --messages: message-level map (content blocks with JSONPath references)
  --raw <path>: extract raw value (e.g., L3.data.content)
  --phase <name>: show prompt/output content for a phase`)
  .argument('[query]', 'Search text in user messages. Default: latest request')
  .option('-s, --session <pid>', 'Session ID (PID). Default: latest session')
  .option('--seq <seqId>', 'Sequence ID (e.g., 0014). More reliable than text search')
  .option('-m, --messages', 'Show message structure map')
  .option('-r, --raw <path>', 'Extract raw value by path (e.g., L1.data.messages[0].content)')
  .option('-p, --phase <phases...>', 'Show prompt/output for phases (e.g., agentic passthrough)')
  .option('--prompt-only', 'With --phase: show only prompts')
  .option('--output-only', 'With --phase: show only outputs')
  .option('--meta', 'With --phase: show LLM response metadata')
  .option('--save', 'With --phase: save to /tmp files')
  .action(async (query, options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const sessionFiles = findSessionFiles(sessionId);

      if (sessionFiles.length === 0) {
        console.error('No session files found');
        process.exit(1);
      }

      // Collect all entries
      const allEntries: ReturnType<typeof parseLogFile> = [];
      const fileMap = new Map<string, string>(); // seqId -> filePath
      for (const file of sessionFiles) {
        const entries = parseLogFile(file);
        for (const e of entries) {
          if (!fileMap.has(e.seqId)) {
            fileMap.set(e.seqId, file);
          }
        }
        allEntries.push(...entries);
      }

      // Determine target seqId
      let targetSeqId: string;

      if (options.seq) {
        targetSeqId = options.seq.padStart(4, '0');
      } else {
        const logFile = sessionFiles[sessionFiles.length - 1];
        const entries = parseLogFile(logFile);
        const messageEntry = findMessageEntry(entries, query || null);
        if (!messageEntry) {
          console.error('Message not found');
          process.exit(1);
        }
        targetSeqId = messageEntry.seqId;
      }

      const seqEntries = allEntries.filter(e => e.seqId === targetSeqId);
      if (seqEntries.length === 0) {
        console.error(`No entries found for seq ${targetSeqId}`);
        process.exit(1);
      }

      const filePath = fileMap.get(targetSeqId);

      // --raw: extract and print a specific value
      if (options.raw) {
        const value = extractRawValue(seqEntries, options.raw);
        if (value === null) {
          console.error(`Path not found: ${options.raw}`);
          process.exit(1);
        }
        console.log(value);
        return;
      }

      // --messages: show message structure map
      if (options.messages) {
        const requestEntry = seqEntries.find(e => e.type === 'in' && e.phase === PHASES.REQUEST);
        if (!requestEntry) {
          console.error('No request entry found');
          process.exit(1);
        }
        console.log(`\n  SeqID: ${targetSeqId}`);
        if (filePath) console.log(`  File: ${filePath}`);
        displayMessages(requestEntry.data);
        console.log('');
        return;
      }

      // --phase: show prompt/output content
      if (options.phase) {
        const allPhaseData = extractAllPhaseData(seqEntries, targetSeqId);
        const phaseFilter = options.phase as Phase[];
        const phaseData = filterPhaseData(allPhaseData, phaseFilter);

        if (phaseData.length === 0) {
          console.log('No phase data found for the specified phases');
          return;
        }

        const showPrompt = options.promptOnly || (!options.promptOnly && !options.outputOnly);
        const showOutput = options.outputOnly || (!options.promptOnly && !options.outputOnly);
        const showMeta = !!options.meta;

        for (const pd of phaseData) {
          displayPhaseData(pd, showPrompt, showOutput, showMeta);
          if (options.save) {
            savePhaseData(pd, targetSeqId);
          }
        }
        console.log('');
        return;
      }

      // Default: entry-level map
      inspectRequest(seqEntries, targetSeqId, filePath);
      console.log('');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// phases: list available phase types
// ---------------------------------------------------------------------------
program
  .command('phases')
  .description('List all phase types that appear in log entries')
  .action(() => {
    console.log('\nPhase types:\n');

    for (const [, value] of Object.entries(PHASES)) {
      const description = PHASE_DESCRIPTIONS[value as Phase];
      console.log(`  ${value.padEnd(30)} ${description}`);
    }

    console.log(`\nUsage: extract-log show --seq 0014 --phase agentic\n`);
  });

// ---------------------------------------------------------------------------
// server: server lifecycle logs
// ---------------------------------------------------------------------------
program
  .command('server')
  .description('Display server lifecycle logs (startup, config, driver info)')
  .option('-s, --session <pid>', 'Session ID (PID). Default: latest server log')
  .option('-l, --level <levels...>', 'Filter by level (info, warn, error, debug)')
  .option('-c, --category <categories...>', 'Filter by category (startup, config, driver, request, shutdown)')
  .action(async (options) => {
    try {
      const sessionId = options.session ? parseInt(options.session) : null;
      const logFile = findServerLogFile(sessionId);

      if (!logFile) {
        console.error('No server log file found');
        process.exit(1);
      }

      const entries = parseServerLogFile(logFile);

      let filtered = entries;
      if (options.level) {
        const levels = new Set(options.level as string[]);
        filtered = filtered.filter(e => levels.has(e.level));
      }
      if (options.category) {
        const categories = new Set(options.category as string[]);
        filtered = filtered.filter(e => categories.has(e.category));
      }

      const pidMatch = logFile.match(/server-(\d+)\.jsonl$/);
      const displayPid = pidMatch ? pidMatch[1] : 'unknown';

      console.log(`\n  Server Log (PID: ${displayPid})`);
      console.log(`  File: ${logFile}`);
      console.log(`  Entries: ${entries.length}, Filtered: ${filtered.length}\n`);

      const header = '  Time          Level  Category  Message';
      console.log(header);
      console.log('  ' + '-'.repeat(header.length - 2));

      for (const entry of filtered) {
        const time = new Date(entry.timestamp).toISOString().substring(11, 23);
        const level = entry.level.padEnd(5);
        const category = entry.category.padEnd(8);
        console.log(`  ${time}  ${level}  ${category}  ${entry.message}`);
        if (entry.data) {
          console.log(`                                ${JSON.stringify(entry.data)}`);
        }
      }

      console.log('');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Default: show help
if (process.argv.length === 2) {
  program.help();
}

program.parse();
