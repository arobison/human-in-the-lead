#!/usr/bin/env node
// Entry for the release workflow's record-to-tag check (core/lib/release/check.mjs):
//   node core/bin/release-check.mjs [--commit <sha>] [--main <ref>] [--pr <n>]...
//     [--output <file>] [--message-file <file>] [--notes-file <file>] [--repo <dir>]
// Prints the result as JSON. --output appends tag, version and prerelease as key=value lines (a
// GitHub step output file); --message-file writes the annotated tag's message; --notes-file the
// release notes. Exit 0: the record may be tagged, or the commit adds none (tag is empty).
// Exit 1: refused. Exit 2: usage.
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkReleaseCommit } from '../lib/release/check.mjs';

/** @type {ReturnType<typeof parseArgs>['values']} */
let values;
try {
  ({ values } = parseArgs({
    options: {
      commit: { type: 'string', default: 'HEAD' },
      main: { type: 'string' },
      pr: { type: 'string', multiple: true },
      output: { type: 'string' },
      'message-file': { type: 'string' },
      'notes-file': { type: 'string' },
      repo: { type: 'string', default: '.' },
    },
  }));
} catch (e) {
  console.error(String(/** @type {Error} */ (e).message));
  process.exit(2);
}
const prs = /** @type {string[] | undefined} */ (values.pr)
  ?.flatMap((s) => s.split(/[\s,]+/))
  .filter(Boolean);
if (prs?.some((n) => !/^[1-9]\d*$/.test(n))) {
  console.error('--pr takes pull request numbers');
  process.exit(2);
}

const r = await checkReleaseCommit({
  root: String(values.repo),
  commit: String(values.commit),
  main: typeof values.main === 'string' ? values.main : undefined,
  prs: prs?.map(Number),
});
console.log(JSON.stringify(r, null, 2));
if (r.ok && r.tag) {
  if (typeof values.output === 'string') {
    appendFileSync(
      values.output,
      `tag=${r.tag}\nversion=${r.version}\nprerelease=${r.prerelease}\nrecord=${r.record}\n`,
    );
  }
  if (typeof values['message-file'] === 'string') {
    writeFileSync(values['message-file'], `${r.message}\n`);
  }
  if (typeof values['notes-file'] === 'string') {
    writeFileSync(values['notes-file'], `${r.notes}\n\nRelease record: \`${r.record}\`.\n`);
  }
} else if (r.ok && typeof values.output === 'string') {
  appendFileSync(values.output, 'tag=\n');
}
if (!r.ok) console.error(`refused:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`);
process.exit(r.ok ? 0 : 1);
