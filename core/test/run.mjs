// `npm test`: the test suite in a temporary directory of its own, which must be empty afterward.
// Every test removes what it makes (helpers/tmp.mjs); a run that leaves anything behind fails and
// names it, and the directory is removed either way. Arguments, when given, replace the default
// file pattern, as `node --test` takes them.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What a tool keeps in the temporary directory as a cache, not a test's: Prettier's compile cache. */
const CACHES = new Set(['node-compile-cache']);

const root = mkdtempSync(join(tmpdir(), 'hitld-test-run-'));
const args = process.argv.slice(2);
// A run started from inside another test run is a run of its own, not a child of that one.
const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
const run = spawnSync(
  process.execPath,
  ['--test', ...(args.length ? args : ['core/test/**/*.test.mjs'])],
  { stdio: 'inherit', env: { ...env, TMPDIR: root, TMP: root, TEMP: root } },
);

const left = readdirSync(root).filter((name) => !CACHES.has(name));
rmSync(root, { recursive: true, force: true, maxRetries: 3 });
if (left.length) {
  /** @type {Map<string, number>} */
  const byPrefix = new Map();
  for (const name of left) {
    const prefix = name.replace(/[A-Za-z0-9]{6}$/, '*');
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const lines = [...byPrefix].sort((a, b) => b[1] - a[1]).map(([p, n]) => `  ${n} ${p}`);
  process.stderr.write(
    `\nThe tests left ${left.length} ${left.length === 1 ? 'entry' : 'entries'} in their temporary directory; each test removes what it makes (core/test/helpers/tmp.mjs):\n${lines.join('\n')}\n`,
  );
  process.exit(1);
}
process.exit(run.status ?? 1);
