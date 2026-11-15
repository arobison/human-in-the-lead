#!/usr/bin/env node
// Entry for the CI public check (design part 10.3, rule 7): what can be checked without the
// private term list. A committed store address or device list, and email addresses that are not
// noreply ones, in each commit of the range:
//   node core/bin/public-check.mjs --from <base sha> --to <head sha>
import { parseArgs } from 'node:util';
import { checkPublicRange, formatPublicReport } from '../lib/guard/public-check.mjs';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    repo: { type: 'string', default: '.' },
  },
});

if (!values.to) {
  console.error('usage: public-check [--from <sha>] --to <sha> [--repo <dir>]');
  process.exit(2);
}

const report = checkPublicRange({ cwd: values.repo ?? '.', from: values.from, to: values.to });
console.log(formatPublicReport(report));
process.exit(report.findings.length ? 1 : 0);
