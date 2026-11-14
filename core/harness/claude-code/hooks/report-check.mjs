#!/usr/bin/env node
// SubagentStop and Stop: an executor's final message must be the report in the fixed shape
// (design part 5.6), so the orchestrator never parses free text. If it is not, the executor is
// asked once to fix it; a second miss is left for the orchestrator's report check.

import { parseReport } from '../../../lib/contract/report.mjs';
import { isExecutor, readHookInput } from './input.mjs';

const input = readHookInput();
if (isExecutor(input, process.env) && input.stop_hook_active !== true) {
  const text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  const { errors } = parseReport(text);
  if (errors.length) {
    const reason = [
      'End with the report in the fixed shape from AGENTS.md, and nothing else. Problems:',
      ...errors.slice(0, 8).map((e) => `- ${e}`),
    ].join('\n');
    process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  }
}
