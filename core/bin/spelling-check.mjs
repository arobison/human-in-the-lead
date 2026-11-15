#!/usr/bin/env node
// The spelling check (part of `npm run check`): tracked text files hold no British spelling.
//   node core/bin/spelling-check.mjs [--repo <dir>]
// Exit 0 when none is found, 1 when some are, 2 for a bad call.
import { parseArgs } from 'node:util';
import { checkSpelling, formatSpellingReport } from '../lib/spelling/check.mjs';

const { values } = parseArgs({ options: { repo: { type: 'string', default: '.' } } });

try {
  const report = checkSpelling(values.repo ?? '.');
  const out = formatSpellingReport(report);
  if (report.findings.length) console.error(out);
  else console.log(out);
  process.exit(report.findings.length ? 1 : 0);
} catch (error) {
  console.error(`spelling-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
