#!/usr/bin/env node
// Entry for the CI DCO job:
//   node core/bin/dco-check.mjs --mode pr --from <base sha> --to <head sha>
//   node core/bin/dco-check.mjs --mode main --from <before sha> --to <after sha>
import { parseArgs } from 'node:util';
import { checkCommits, formatReport, readCommits } from '../lib/dco/check.mjs';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    repo: { type: 'string', default: '.' },
  },
});

if ((values.mode !== 'pr' && values.mode !== 'main') || !values.to) {
  console.error('usage: dco-check --mode pr|main [--from <sha>] --to <sha> [--repo <dir>]');
  process.exit(2);
}

const report = checkCommits(readCommits(values.repo ?? '.', values.from, values.to), values.mode);
console.log(formatReport(report, values.mode));
process.exit(report.findings.length ? 1 : 0);
