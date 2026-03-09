/**
 * Session summary extraction and display
 */
import type { SessionMessage } from './types.js';
import { PHASES } from './types.js';
import { parseLogFile } from './log-reader.js';

/**
 * Extract session summary from log files
 */
export function extractSessionSummary(sessionFiles: string[]): SessionMessage[] {
  const messages: SessionMessage[] = [];

  for (const file of sessionFiles) {
    const entries = parseLogFile(file);
    const seqId = entries[0]?.seqId;
    if (!seqId) continue;

    // Find user message
    const requestEntry = entries.find(e => e.type === 'in' && e.phase === PHASES.REQUEST);
    if (!requestEntry) continue;

    const userMessages = requestEntry.data.messages?.filter((m: any) =>
      m.role === 'user' && m.content
    ) || [];

    const lastUserMsg = userMessages[userMessages.length - 1];
    const userMessage = Array.isArray(lastUserMsg?.content)
      ? lastUserMsg.content.map((c: any) => c.text || '').join(' ')
      : lastUserMsg?.content || '';

    // Check for passthrough/chat workflow (single phase, no P1/P2)
    const passthroughOutput = entries.find(e =>
      e.phase === 'passthrough' && e.type === 'llm_response'
    );
    const chatOutput = entries.find(e =>
      e.phase === 'chat' && e.type === 'llm_response'
    );

    if (passthroughOutput || chatOutput) {
      const output = passthroughOutput || chatOutput;
      const workflowType = passthroughOutput ? 'passthrough' : 'chat';
      const reason = output!.data.finishReason;
      const status = (reason === 'stop' || reason === 'tool_calls') ? 'success' : 'failed';

      messages.push({
        seqId,
        timestamp: requestEntry.timestamp,
        userMessage: userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''),
        phase1Status: status,
        phase1Type: 'response',
        phase2Status: 'missing',
        toolName: workflowType,  // ワークフロー種別を tool 欄で表示
        model: output!.data.model,
      });
      continue;
    }

    // Check Phase1
    const phase1Output = entries.find(e =>
      (e.phase === PHASES.PHASE1_ANALYSIS || e.phase === PHASES.PHASE1_DECISION)
      && e.type === 'llm_response'
    );
    const phase1Status = phase1Output
      ? (phase1Output.data.finishReason === 'stop' ? 'success' : 'failed')
      : 'missing';

    // Extract Phase1 type (tool/response)
    let phase1Type: 'tool' | 'response' | undefined;
    if (phase1Output?.data?.structuredOutput) {
      phase1Type = phase1Output.data.structuredOutput.action?.type;
    }

    // Check Phase2
    const phase2Output = entries.find(e =>
      (e.phase === PHASES.PHASE2_TOOL_GENERATION ||
       e.phase === PHASES.PHASE2_RESPONSE_GENERATION ||
       e.phase === PHASES.PHASE2_TOOL_CALL)
      && e.type === 'llm_response'
    );
    const phase2Status = phase2Output
      ? (phase2Output.data.finishReason === 'stop' ? 'success' : 'failed')
      : 'missing';

    // Determine Phase2 type from phase name
    let phase2Type: 'tool' | 'response' | undefined;
    if (phase2Output) {
      phase2Type = (phase2Output.phase === PHASES.PHASE2_TOOL_GENERATION ||
                    phase2Output.phase === PHASES.PHASE2_TOOL_CALL) ? 'tool' : 'response';
    }

    // Extract tool name from phase1
    let toolName: string | undefined;
    if (phase1Output?.data?.structuredOutput) {
      toolName = phase1Output.data.structuredOutput.action?.toolName;
    }

    // Check for errors
    const responseEntry = entries.find(e => e.phase === PHASES.RESPONSE && e.type === 'out');
    let error: string | undefined;
    if (responseEntry?.data?.content?.[0]?.text === 'Failed to generate tool parameters') {
      error = 'Failed to generate tool parameters';
    }

    // Extract model from first llm_response
    const firstLlmResponse = entries.find(e => e.type === 'llm_response');
    const model = firstLlmResponse?.data?.model;

    messages.push({
      seqId,
      timestamp: requestEntry.timestamp,
      userMessage: userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''),
      phase1Status,
      phase1Type,
      phase2Status,
      phase2Type,
      toolName,
      model,
      error,
    });
  }

  return messages;
}

/**
 * Display session summary table
 */
export function displaySessionSummary(summary: SessionMessage[], sessionId: number | string): void {
  console.log(`\n📊 Session Summary\n`);
  console.log(`🔍 Session ID (PID): ${sessionId}`);
  console.log(`📁 Total requests: ${summary.length}\n`);

  // Determine if any message has a model name to show
  const hasModels = summary.some(m => m.model);
  const modelColWidth = 30;

  console.log('P1/P2 Format: [Status][Type]  Status: ✓=success ✗=failed -=missing  Type: T=tool R=response\n');
  const headerWidth = hasModels ? 170 : 140;
  console.log('='.repeat(headerWidth));
  const modelHeader = hasModels ? ` Model${' '.repeat(modelColWidth - 6)} |` : '';
  console.log(`SeqID | Timestamp | P1      | P2      | Tool${' '.repeat(26)} |${modelHeader} User Message`);
  console.log('='.repeat(headerWidth));

  for (const msg of summary) {
    const timestamp = new Date(msg.timestamp).toISOString().substring(11, 19);

    // Phase1: status + type
    const p1Status = msg.phase1Status === 'success' ? '✓' : msg.phase1Status === 'failed' ? '✗' : '-';
    const p1Type = msg.phase1Type ? (msg.phase1Type === 'tool' ? 'T' : 'R') : ' ';
    const phase1 = `${p1Status}${p1Type}`;

    // Phase2: status + type
    const p2Status = msg.phase2Status === 'success' ? '✓' : msg.phase2Status === 'failed' ? '✗' : '-';
    const p2Type = msg.phase2Type ? (msg.phase2Type === 'tool' ? 'T' : 'R') : ' ';
    const phase2 = `${p2Status}${p2Type}`;

    const tool = (msg.toolName || '-').padEnd(30).substring(0, 30);
    const modelCol = hasModels ? ` ${(msg.model || '-').padEnd(modelColWidth).substring(0, modelColWidth)} |` : '';
    const userMsg = msg.userMessage.padEnd(40).substring(0, 40);

    const status = msg.error ? '⚠' : '';
    console.log(`${msg.seqId} | ${timestamp} | ${phase1.padEnd(7)} | ${phase2.padEnd(7)} | ${tool} |${modelCol} ${userMsg} ${status}`);

    if (msg.error) {
      console.log(`       └─ ERROR: ${msg.error}`);
    }
  }

  console.log('='.repeat(headerWidth));
  console.log(`\n✓ Total messages: ${summary.length}`);
  console.log(`✓ Failures: ${summary.filter(m => m.error || m.phase1Status === 'failed' || m.phase2Status === 'failed').length}\n`);
}
