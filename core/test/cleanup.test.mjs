// The test run cleans up after itself (HITLD-130): `npm test` runs the suite in a temporary
// directory of its own and fails, naming what is left, when a test leaves anything in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmp.mjs';

const RUN = resolve(fileURLToPath(import.meta.url), '..', 'run.mjs');
const HELPER = resolve(fileURLToPath(import.meta.url), '..', 'helpers', 'tmp.mjs');

/** Run core/test/run.mjs on one test file whose body is `body`. @param {string} body */
function runOn(body) {
  const dir = tempDir('hitld-cleanup-');
  const file = join(dir, 'probe.test.mjs');
  writeFileSync(
    file,
    `import { test } from 'node:test';\nimport { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport { tempDir } from ${JSON.stringify(HELPER)};\n${body}\n`,
  );
  const before = new Set(readdirSync(tmpdir()));
  const r = spawnSync(process.execPath, [RUN, file], { encoding: 'utf8' });
  const added = readdirSync(tmpdir()).filter(
    (n) => !before.has(n) && n.startsWith('hitld-test-run-'),
  );
  return { status: r.status, stderr: r.stderr, added };
}

test('a test that removes what it makes passes, and the run leaves nothing behind', () => {
  const r = runOn(`test('clean', () => { tempDir('hitld-probe-'); });`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.added, [], "the run's own directory is removed");
});

test('a test that leaves a temporary directory behind fails the run, which names it', () => {
  const r = runOn(`test('leaky', () => { mkdtempSync(join(tmpdir(), 'hitld-leak-')); });`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /left 1 entry in their temporary directory/);
  assert.match(r.stderr, /1 hitld-leak-\*/);
  assert.deepEqual(r.added, [], "the run's own directory is removed even so");
});
