// A node:test reporter that prints the slowest test files when the run ends (HITLD-131). It adds
// up each file's top-level tests, which a file runs one after another, so the total is close to the
// file's own time without its start-up. `npm test` runs it beside the spec reporter.
//
//   node --test --test-reporter=./core/test/helpers/slowest-reporter.mjs ...
//
// HITLD_TEST_SLOWEST sets how many files it lists (default 10; 0 lists none).

import { relative } from 'node:path';

/**
 * @param {Map<string, number>} totals file → milliseconds
 * @param {number} count
 * @param {string} [cwd]
 * @returns {string}
 */
export function slowestTable(totals, count, cwd = process.cwd()) {
  if (count <= 0 || totals.size === 0) return '';
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  const lines = rows.map(
    ([file, ms]) => `  ${(ms / 1000).toFixed(1).padStart(6)} s  ${relative(cwd, file) || file}`,
  );
  return `\nslowest test files (top-level tests added up; ${(all / 1000).toFixed(1)} s in ${totals.size} files):\n${lines.join('\n')}\n`;
}

/**
 * @param {AsyncIterable<{ type: string, data: any }>} source
 * @returns {AsyncGenerator<string>}
 */
export default async function* slowestReporter(source) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { data } = event;
    if (data.nesting !== 0 || !data.file) continue;
    totals.set(data.file, (totals.get(data.file) ?? 0) + (data.details?.duration_ms ?? 0));
  }
  const raw = process.env.HITLD_TEST_SLOWEST;
  const count = raw === undefined || raw === '' ? 10 : Number(raw);
  yield slowestTable(totals, Number.isFinite(count) ? count : 10);
}
