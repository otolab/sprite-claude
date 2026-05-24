/**
 * Message detail extraction and display
 */
import fs from 'fs';
import path from 'path';
import type { LogEntry, PhaseData, WorkflowType } from './types.js';
import { PHASES } from './types.js';

/**
 * Find a message entry by query string
 */
export function findMessageEntry(entries: LogEntry[], query: string | null): LogEntry | null {
  const requestEntries: LogEntry[] = [];

  for (const entry of entries) {
    if (entry.type === 'in' && entry.phase === PHASES.REQUEST) {
      requestEntries.push(entry);
    }
  }

  if (requestEntries.length === 0) {
    return null;
  }

  if (query === null) {
    return requestEntries[requestEntries.length - 1];
  }

  for (let i = requestEntries.length - 1; i >= 0; i--) {
    const entry = requestEntries[i];
    const messages = entry.data.messages || [];

    for (const msg of messages) {
      if (msg.role === 'user' && msg.content) {
        const contentStr = Array.isArray(msg.content)
          ? msg.content.map((c: any) => c.text || '').join(' ')
          : msg.content;

        if (contentStr.includes(query)) {
          return entry;
        }
      }
    }
  }

  return null;
}

/**
 * Extract all phase data for a specific seqId
 */
export function extractAllPhaseData(entries: LogEntry[], seqId: string): PhaseData[] {
  const phaseDataMap = new Map<string, PhaseData>();

  for (const entry of entries) {
    if (entry.seqId !== seqId) continue;

    const phase = entry.phase;

    if (!phaseDataMap.has(phase)) {
      phaseDataMap.set(phase, { phase });
    }

    const phaseData = phaseDataMap.get(phase)!;

    if (entry.type === 'prompt') {
      phaseData.prompt = entry.data.content;
    } else if (entry.type === 'llm_response') {
      phaseData.output = entry.data;
    }
  }

  return Array.from(phaseDataMap.values());
}

/**
 * Filter phase data by phase names
 */
export function filterPhaseData(allPhaseData: PhaseData[], phases?: string[]): PhaseData[] {
  if (!phases || phases.length === 0) {
    return allPhaseData;
  }

  return allPhaseData.filter(pd => phases.includes(pd.phase));
}

/**
 * Display phase data
 */
export function displayPhaseData(
  phaseData: PhaseData,
  showPrompt: boolean,
  showOutput: boolean,
  showMeta: boolean = false,
): void {
  const phaseName = phaseData.phase.toUpperCase().replace(/-/g, ' ');

  if (phaseData.prompt && showPrompt) {
    const header = '\n' + '='.repeat(80) + '\n' +
                   `  ${phaseName} - PROMPT\n` +
                   '='.repeat(80) + '\n\n';
    console.log(header + phaseData.prompt);
  }

  if (phaseData.output && showOutput) {
    const output = phaseData.output.content || phaseData.output.output || JSON.stringify(phaseData.output, null, 2);
    const header = '\n' + '='.repeat(80) + '\n' +
                   `  ${phaseName} - OUTPUT\n` +
                   '='.repeat(80) + '\n\n';
    console.log(header + output);
  }

  if (phaseData.output && showMeta) {
    const meta: string[] = [];
    if (phaseData.output.model) meta.push(`Model: ${phaseData.output.model}`);
    if (phaseData.output.finishReason) meta.push(`Finish reason: ${phaseData.output.finishReason}`);
    // usage（consumedUsage: 全query合計）
    if (phaseData.output.consumedUsage) {
      const u = phaseData.output.consumedUsage;
      meta.push(`Usage (total): ${u.promptTokens || 0} in / ${u.completionTokens || 0} out`);
    } else if (phaseData.output.usage) {
      const u = phaseData.output.usage;
      meta.push(`Usage (total): ${u.promptTokens || 0} in / ${u.completionTokens || 0} out`);
    }
    // responseUsage（最終応答のusage）
    if (phaseData.output.responseUsage) {
      const u = phaseData.output.responseUsage;
      meta.push(`Usage (response): ${u.promptTokens || 0} in / ${u.completionTokens || 0} out`);
    }
    if (phaseData.output.toolCalls?.length) {
      meta.push(`Tool calls: ${phaseData.output.toolCalls.map((t: any) => t.name).join(', ')}`);
    }
    if (phaseData.output.structuredOutput) {
      meta.push(`Structured output: ${JSON.stringify(phaseData.output.structuredOutput).substring(0, 200)}`);
    }
    // errors
    if (phaseData.output.errors?.length) {
      meta.push(`Errors: ${phaseData.output.errors.length}`);
      for (const err of phaseData.output.errors) {
        meta.push(`  [${err.level}] ${err.message}`);
      }
    }
    // logEntries件数
    if (phaseData.output.logEntries?.length) {
      meta.push(`Log entries: ${phaseData.output.logEntries.length}`);
    }
    if (meta.length > 0) {
      const header = '\n' + '-'.repeat(60) + '\n' +
                     `  ${phaseName} - META\n` +
                     '-'.repeat(60);
      console.log(header);
      for (const line of meta) {
        console.log(`  ${line}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Request structure display (show --seq)
// ---------------------------------------------------------------------------

/**
 * Detect workflow type from entries
 */
function detectWorkflow(entries: LogEntry[], requestData: any): WorkflowType {
  if (entries.some(e => e.phase === PHASES.AGENTIC)) {
    const tools = requestData?.tools?.length || 0;
    if (tools === 0) return 'routing';
    return 'agentic';
  }
  if (entries.some(e => e.phase === PHASES.PASSTHROUGH)) return 'passthrough';
  if (entries.some(e => e.phase === PHASES.PHASE1_ANALYSIS)) return 'rag';
  if (entries.some(e => e.phase === PHASES.PHASE1_DECISION)) return 'decision';
  if (entries.some(e => e.phase === PHASES.CHAT)) return 'chat';
  return 'unknown';
}

/**
 * Display structural overview of a request (show --seq)
 *
 * Shows file path, line numbers, and entry summaries.
 * The viewer can use line numbers to jump to raw JSONL.
 */
export function inspectRequest(entries: LogEntry[], seqId: string, filePath?: string): void {
  const requestEntries = entries.filter(e => e.seqId === seqId);

  if (requestEntries.length === 0) {
    console.log('No entries found');
    return;
  }

  const requestIn = requestEntries.find(e => e.phase === PHASES.REQUEST && e.type === 'in');
  const requestData = requestIn?.data;
  const workflow = detectWorkflow(requestEntries, requestData);
  const llmResponse = requestEntries.find(e => e.type === 'llm_response');
  const model = llmResponse?.data?.model || '?';

  console.log(`\n  SeqID: ${seqId} | ${workflow} | ${model}`);
  if (filePath) {
    console.log(`  File: ${filePath}`);
  }
  console.log(`  Entries:`);

  for (let i = 0; i < requestEntries.length; i++) {
    const entry = requestEntries[i];
    const lineNum = `L${i + 1}`;
    const tag = `${entry.phase}/${entry.type}`;
    const details: string[] = [];

    if (entry.type === 'in' && entry.phase === PHASES.REQUEST) {
      details.push(`model=${entry.data.model || '?'}`);
      details.push(`tools=${entry.data.tools?.length || 0}`);
      details.push(`messages=${entry.data.messages?.length || 0}`);
    } else if (entry.type === 'prompt') {
      const contentLen = entry.data.content?.length || 0;
      details.push(`${contentLen} chars`);
      if (entry.data.toolCount !== undefined) {
        details.push(`tools=${entry.data.toolCount}`);
      }
    } else if (entry.type === 'llm_response') {
      if (entry.data.model) details.push(`model=${entry.data.model}`);
      details.push(`finish=${entry.data.finishReason || '?'}`);
      const content = entry.data.content || '';
      details.push(`${content.length} chars`);
      const tcCount = entry.data.toolCalls?.length || 0;
      if (tcCount > 0) {
        const names = entry.data.toolCalls.map((t: any) => t.name).join(', ');
        details.push(`toolCalls=${tcCount}(${names})`);
      }
      if (content.includes('<think>')) {
        details.push('has-think');
      }
      // usage情報
      if (entry.data.consumedUsage) {
        const u = entry.data.consumedUsage;
        details.push(`tokens=${u.promptTokens || 0}+${u.completionTokens || 0}`);
      } else if (entry.data.usage) {
        const u = entry.data.usage;
        details.push(`tokens=${u.promptTokens || 0}+${u.completionTokens || 0}`);
      }
      // エラー件数
      if (entry.data.errors?.length) {
        details.push(`errors=${entry.data.errors.length}`);
      }
      // executionLog（agenticProcess内部タスク）
      if (entry.data.taskTypeCounts && Object.keys(entry.data.taskTypeCounts).length > 0) {
        const counts = Object.entries(entry.data.taskTypeCounts)
          .map(([type, count]) => `${type}:${count}`)
          .join(',');
        details.push(`tasks=${entry.data.executionLog?.length || 0}(${counts})`);
      } else if (entry.data.executionLog?.length) {
        details.push(`tasks=${entry.data.executionLog.length}`);
      }
      // ドライバログ件数
      if (entry.data.logEntries?.length) {
        details.push(`logs=${entry.data.logEntries.length}`);
      }
    } else if (entry.type === 'out' && entry.phase === PHASES.RESPONSE) {
      details.push(`stop=${entry.data.stop_reason || '?'}`);
      const blocks = entry.data.content || [];
      const types = blocks.map((b: any) => b.type);
      details.push(`blocks=[${types.join(', ')}]`);
    } else if (entry.type === 'error') {
      details.push(entry.data.message || '?');
    } else if (entry.type === 'driver_info') {
      details.push(`model=${entry.data.model || '?'}`);
      if (entry.data.models) {
        const roles = Object.entries(entry.data.models)
          .map(([role, model]) => `${role}=${model}`)
          .join(', ');
        details.push(`roles={${roles}}`);
      }
    }

    console.log(`    ${lineNum.padEnd(4)} ${tag.padEnd(30)} ${details.join('  ')}`);
  }
}

// ---------------------------------------------------------------------------
// Message structure display (show --seq --messages)
// ---------------------------------------------------------------------------

/**
 * Truncate text for display, replacing newlines
 */
function truncate(text: string, maxLen: number): string {
  const single = text.replace(/\n/g, '\\n');
  if (single.length <= maxLen) return single;
  return single.substring(0, maxLen - 3) + '...';
}

/**
 * Display message structure map
 *
 * Shows each message and content block with JSONPath-like references
 * so the viewer can locate data in raw JSONL.
 */
export function displayMessages(requestData: any): void {
  const messages = requestData?.messages || [];

  console.log(`\n  Messages: ${messages.length} entries  (in .data.messages)\n`);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role;
    const prefix = `  [${i}]`;

    if (typeof msg.content === 'string') {
      const hasReminder = msg.content.includes('<system-reminder>');
      const label = hasReminder ? '<system-reminder>' : truncate(msg.content, 60);
      console.log(`${prefix}  ${role.padEnd(10)} text        ${msg.content.length} chars  ${label}`);
    } else if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        const bp = `.content[${j}]`;

        if (block.type === 'text') {
          const text = block.text || '';
          let label: string;
          if (text.includes('<system-reminder>')) {
            label = '<system-reminder>';
          } else if (text.includes('<think>')) {
            // Show think content briefly
            const thinkEnd = text.indexOf('</think>');
            const inner = thinkEnd > 0 ? text.substring(7, thinkEnd).trim() : '';
            label = `<think> ${truncate(inner || '(empty)', 50)}`;
          } else {
            label = truncate(text, 60);
          }
          console.log(`${prefix}  ${role.padEnd(10)} text     ${bp.padEnd(14)} ${String(text.length).padStart(5)} chars  ${label}`);
        } else if (block.type === 'tool_use') {
          const shortName = block.name.split('__').pop() || block.name;
          const idShort = block.id?.substring(0, 16) || '?';
          console.log(`${prefix}  ${role.padEnd(10)} tool_use ${bp.padEnd(14)} id=${idShort}  ${shortName}`);
        } else if (block.type === 'tool_result') {
          const idShort = block.tool_use_id?.substring(0, 16) || '?';
          let contentPreview = '';
          if (typeof block.content === 'string') {
            contentPreview = truncate(block.content, 40);
          } else if (Array.isArray(block.content)) {
            const text = block.content.map((c: any) => c.text || '').join(' ');
            contentPreview = truncate(text, 40);
          }
          const errFlag = block.is_error ? ' ERROR' : '';
          console.log(`${prefix}  ${role.padEnd(10)} tool_res ${bp.padEnd(14)} id=${idShort}  ${contentPreview}${errFlag}`);
        } else {
          console.log(`${prefix}  ${role.padEnd(10)} ${block.type.padEnd(8)} ${bp}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Raw value extraction (show --raw)
// ---------------------------------------------------------------------------

/**
 * Extract a value from JSONL entry data using a simple dot-path.
 *
 * Supported paths:
 *   .data.messages[1].content[0].text
 *   .data.content
 *   .data.toolCalls[0].arguments
 *
 * Line number (L1, L2, ...) can prefix to select the entry:
 *   L3.data.content
 */
export function extractRawValue(entries: LogEntry[], pathExpr: string): string | null {
  let targetEntry: LogEntry | undefined;
  let dotPath = pathExpr;

  // Parse Ln prefix
  const lineMatch = pathExpr.match(/^L(\d+)\.(.*)$/);
  if (lineMatch) {
    const lineIdx = parseInt(lineMatch[1]) - 1;
    if (lineIdx < 0 || lineIdx >= entries.length) return null;
    targetEntry = entries[lineIdx];
    dotPath = lineMatch[2];
  } else {
    // Default to first entry
    targetEntry = entries[0];
    if (dotPath.startsWith('.')) dotPath = dotPath.substring(1);
  }

  if (!targetEntry) return null;

  // Navigate the path
  let current: any = targetEntry;
  const segments = dotPath.match(/[^.\[\]]+|\[\d+\]/g) || [];

  for (const seg of segments) {
    if (current === undefined || current === null) return null;
    const idxMatch = seg.match(/^\[(\d+)\]$/);
    if (idxMatch) {
      current = current[parseInt(idxMatch[1])];
    } else {
      current = current[seg];
    }
  }

  if (current === undefined || current === null) return null;
  if (typeof current === 'string') return current;
  return JSON.stringify(current, null, 2);
}

/**
 * Save phase data to file
 */
export function savePhaseData(phaseData: PhaseData, seqId: string): void {
  const phaseName = phaseData.phase.replace(/-/g, '_');

  if (phaseData.prompt) {
    const filename = `${phaseName}_prompt_${seqId}.txt`;
    const outputPath = path.join('/tmp', filename);
    fs.writeFileSync(outputPath, phaseData.prompt, 'utf-8');
    console.log(`  Saved prompt to: ${outputPath}`);
  }

  if (phaseData.output) {
    const output = phaseData.output.content || JSON.stringify(phaseData.output, null, 2);
    const filename = `${phaseName}_output_${seqId}.txt`;
    const outputPath = path.join('/tmp', filename);
    fs.writeFileSync(outputPath, output, 'utf-8');
    console.log(`  Saved output to: ${outputPath}`);
  }
}
