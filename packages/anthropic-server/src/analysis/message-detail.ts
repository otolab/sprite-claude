/**
 * Message detail extraction and display
 */
import fs from 'fs';
import path from 'path';
import type { LogEntry, PhaseData, Phase } from './types.js';
import { PHASES } from './types.js';

/**
 * Find a message entry by query string
 */
export function findMessageEntry(entries: LogEntry[], query: string | null): LogEntry | null {
  const requestEntries: LogEntry[] = [];

  // Collect all request entries
  for (const entry of entries) {
    if (entry.type === 'in' && entry.phase === PHASES.REQUEST) {
      requestEntries.push(entry);
    }
  }

  if (requestEntries.length === 0) {
    return null;
  }

  // If no query, return the latest (last) entry
  if (query === null) {
    return requestEntries[requestEntries.length - 1];
  }

  // Search from newest to oldest
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
  const phaseDataMap = new Map<Phase, PhaseData>();

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
export function filterPhaseData(allPhaseData: PhaseData[], phases?: Phase[]): PhaseData[] {
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
                   `📝 ${phaseName} - PROMPT\n` +
                   '='.repeat(80) + '\n\n';
    console.log(header + phaseData.prompt);
  }

  if (phaseData.output && showOutput) {
    const output = phaseData.output.content || JSON.stringify(phaseData.output, null, 2);
    const header = '\n' + '='.repeat(80) + '\n' +
                   `📤 ${phaseName} - OUTPUT\n` +
                   '='.repeat(80) + '\n\n';
    console.log(header + output);
  }

  if (phaseData.output && showMeta) {
    const meta: string[] = [];
    if (phaseData.output.model) meta.push(`Model: ${phaseData.output.model}`);
    if (phaseData.output.finishReason) meta.push(`Finish reason: ${phaseData.output.finishReason}`);
    if (phaseData.output.usage) {
      const u = phaseData.output.usage;
      meta.push(`Tokens: ${u.promptTokens || 0} in / ${u.completionTokens || 0} out`);
    }
    if (phaseData.output.toolCalls?.length) {
      meta.push(`Tool calls: ${phaseData.output.toolCalls.map((t: any) => t.name).join(', ')}`);
    }
    if (phaseData.output.structuredOutput) {
      meta.push(`Structured output: ${JSON.stringify(phaseData.output.structuredOutput).substring(0, 200)}`);
    }
    if (meta.length > 0) {
      const header = '\n' + '-'.repeat(60) + '\n' +
                     `📊 ${phaseName} - META\n` +
                     '-'.repeat(60);
      console.log(header);
      for (const line of meta) {
        console.log(`  ${line}`);
      }
    }
  }
}

/**
 * Display a structural overview of all entries for a request
 */
export function inspectRequest(entries: LogEntry[], seqId: string): void {
  const requestEntries = entries.filter(e => e.seqId === seqId);

  if (requestEntries.length === 0) {
    console.log('No entries found');
    return;
  }

  const requestIn = requestEntries.find(e => e.phase === PHASES.REQUEST && e.type === 'in');
  const timestamp = requestIn?.timestamp || requestEntries[0].timestamp;
  const requestedModel = requestIn?.data?.model || '?';
  const toolCount = requestIn?.data?.tools?.length || 0;
  const messageCount = requestIn?.data?.messages?.length || 0;

  console.log(`\nSeqID: ${seqId}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Model (requested): ${requestedModel}`);
  console.log(`Tools: ${toolCount}`);
  console.log(`Messages: ${messageCount}`);
  console.log(`\nEntries:`);

  for (const entry of requestEntries) {
    const tag = `${entry.phase}/${entry.type}`;
    const details: string[] = [];

    if (entry.type === 'in' && entry.phase === PHASES.REQUEST) {
      details.push(`model=${entry.data.model || '?'}`);
      details.push(`tools=${entry.data.tools?.length || 0}`);
      details.push(`messages=${entry.data.messages?.length || 0}`);
    } else if (entry.type === 'prompt') {
      const contentLen = entry.data.content?.length || 0;
      details.push(`content_length=${contentLen}`);
      if (entry.data.toolCount !== undefined) {
        details.push(`tool_count=${entry.data.toolCount}`);
      }
    } else if (entry.type === 'llm_response') {
      if (entry.data.model) details.push(`model=${entry.data.model}`);
      details.push(`finish=${entry.data.finishReason || '?'}`);
      details.push(`content_len=${entry.data.content?.length || 0}`);
      const tcCount = entry.data.toolCalls?.length || 0;
      if (tcCount > 0) {
        details.push(`toolCalls=${tcCount}(${entry.data.toolCalls.map((t: any) => t.name).join(',')})`);
      } else {
        details.push(`toolCalls=0`);
      }
    } else if (entry.type === 'out' && entry.phase === PHASES.RESPONSE) {
      details.push(`stop_reason=${entry.data.stop_reason || '?'}`);
      details.push(`content_blocks=${entry.data.content?.length || 0}`);
    } else if (entry.type === 'error') {
      details.push(`message=${entry.data.message || '?'}`);
    }

    console.log(`  ${tag.padEnd(35)} | ${details.join(' ')}`);
  }
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
    console.log(`✓ Saved prompt to: ${outputPath}`);
  }

  if (phaseData.output) {
    const output = phaseData.output.content || JSON.stringify(phaseData.output, null, 2);
    const filename = `${phaseName}_output_${seqId}.txt`;
    const outputPath = path.join('/tmp', filename);
    fs.writeFileSync(outputPath, output, 'utf-8');
    console.log(`✓ Saved output to: ${outputPath}`);
  }
}
