/**
 * Session summary extraction and display
 */
import path from 'path';
import type { LogEntry, SessionMessage, WorkflowType } from './types.js';
import { PHASES } from './types.js';
import { parseLogFile } from './log-reader.js';

/**
 * Detect workflow type from log entries
 */
function detectWorkflow(entries: LogEntry[], requestData: any): WorkflowType {
  // Check by phase presence
  if (entries.some(e => e.phase === PHASES.AGENTIC)) {
    // Agentic workflow: distinguish routing vs main
    const tools = requestData?.tools?.length || 0;
    if (tools === 0) return 'routing';
    return 'agentic';
  }
  if (entries.some(e => e.phase === PHASES.PASSTHROUGH)) return 'passthrough';
  if (entries.some(e => e.phase === PHASES.PHASE1_ANALYSIS)) return 'rag';
  if (entries.some(e => e.phase === PHASES.PHASE1_DECISION)) return 'decision';
  if (entries.some(e => e.phase === PHASES.CHAT)) return 'chat';
  if (entries.some(e => e.phase === PHASES.MAIN)) return 'chat';
  return 'unknown';
}

/**
 * Extract last user message text (excluding system-reminder)
 */
function extractUserMessage(requestData: any): string {
  const messages = requestData?.messages || [];
  // Find last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    if (typeof msg.content === 'string') {
      const cleaned = msg.content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (cleaned) return cleaned;
    } else if (Array.isArray(msg.content)) {
      // Find text blocks that aren't system-reminder or tool_result
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j];
        if (block.type === 'text') {
          const cleaned = block.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          if (cleaned) return cleaned;
        }
      }
    }
  }
  // If all user messages are tool_result, indicate that
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'user') {
    const content = lastMsg.content;
    if (Array.isArray(content) && content.every((b: any) => b.type === 'tool_result')) {
      return '(tool_result)';
    }
  }
  return '';
}

/**
 * Extract tool names from response
 */
function extractToolNames(responseData: any): string[] {
  if (!responseData?.content) return [];
  return responseData.content
    .filter((b: any) => b.type === 'tool_use')
    .map((b: any) => b.name);
}

/**
 * Extract session summary from log files
 */
export function extractSessionSummary(sessionFiles: string[]): SessionMessage[] {
  const messages: SessionMessage[] = [];

  for (const file of sessionFiles) {
    const entries = parseLogFile(file);
    const seqId = entries[0]?.seqId;
    if (!seqId) continue;

    const filename = path.basename(file);
    const requestEntry = entries.find(e => e.type === 'in' && e.phase === PHASES.REQUEST);
    if (!requestEntry) continue;

    const requestData = requestEntry.data;
    const toolCount = requestData.tools?.length || 0;
    const messageCount = requestData.messages?.length || 0;
    const userMessage = extractUserMessage(requestData);
    const workflow = detectWorkflow(entries, requestData);

    // Find response
    const responseEntry = entries.find(e => e.type === 'out' && e.phase === PHASES.RESPONSE);
    const stopReason = responseEntry?.data?.stop_reason || '?';
    const toolNames = responseEntry ? extractToolNames(responseEntry.data) : [];

    // Find model from LLM response
    const llmResponse = entries.find(e => e.type === 'llm_response');
    const model = llmResponse?.data?.model;

    // Check for errors
    const errorEntry = entries.find(e => e.type === 'error');
    const error = errorEntry?.data?.message;

    messages.push({
      seqId,
      timestamp: requestEntry.timestamp,
      filename,
      workflow,
      toolCount,
      messageCount,
      stopReason,
      model,
      userMessage: userMessage.substring(0, 80) + (userMessage.length > 80 ? '...' : ''),
      toolNames: toolNames.length > 0 ? toolNames : undefined,
      error,
    });
  }

  return messages;
}

/**
 * Format workflow type for display (fixed width)
 */
function fmtWorkflow(wf: WorkflowType): string {
  const labels: Record<WorkflowType, string> = {
    agentic: 'agentic',
    passthrough: 'passthru',
    rag: 'rag',
    decision: 'decision',
    chat: 'chat',
    routing: 'routing',
    unknown: '?',
  };
  return (labels[wf] || '?').padEnd(8);
}

/**
 * Format result column: stop_reason + tool names
 */
function fmtResult(msg: SessionMessage): string {
  if (msg.stopReason === 'tool_use' && msg.toolNames?.length) {
    const names = msg.toolNames;
    // Shorten tool names: mcp__coeiro-operator__say -> say
    const short = names.map(n => {
      const parts = n.split('__');
      return parts[parts.length - 1];
    });
    if (names.length === 1) {
      return short[0];
    }
    // Deduplicate
    const unique = [...new Set(short)];
    if (unique.length === 1) {
      return `${unique[0]} x${names.length}`;
    }
    return unique.join(', ');
  }
  if (msg.stopReason === 'end_turn') return 'text';
  return msg.stopReason;
}

/**
 * Display session summary table
 */
export function displaySessionSummary(summary: SessionMessage[], sessionId: number | string): void {
  console.log(`\nSession: PID ${sessionId} (${summary.length} requests)`);
  console.log(`Path: ~/.sprite-claude/logs/requests/\n`);

  const header = `  Seq   Time      WF        Tools  Msgs  Result                  Model                  Message`;
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  for (const msg of summary) {
    const time = new Date(msg.timestamp).toISOString().substring(11, 19);
    const wf = fmtWorkflow(msg.workflow);
    const tools = String(msg.toolCount).padStart(3);
    const msgs = String(msg.messageCount).padStart(3);
    const result = fmtResult(msg).padEnd(22).substring(0, 22);
    const model = (msg.model || '-').padEnd(22).substring(0, 22);
    const userMsg = msg.userMessage.substring(0, 40);
    const warn = msg.error ? ' !' : '';

    console.log(`  ${msg.seqId}  ${time}  ${wf}  ${tools}   ${msgs}  ${result}  ${model}  ${userMsg}${warn}`);

    if (msg.error) {
      console.log(`        -> ${msg.error}`);
    }
  }

  console.log('  ' + '-'.repeat(header.length - 2));

  const errors = summary.filter(m => m.error).length;
  if (errors > 0) {
    console.log(`  ${summary.length} requests, ${errors} errors\n`);
  } else {
    console.log(`  ${summary.length} requests\n`);
  }
}
