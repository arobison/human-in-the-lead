// The skipped tests CI reports (HITLD-185): the reporter that records each skip with its reason,
// the allowlist of skips expected on a platform, and the tests job that installs age and fails on
// a skip the allowlist does not expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SKIPS,
  cell,
  checkSkips,
  parseSkips,
  skipsSummary,
} from '../../scripts/test-skips.mjs';
import { tempDir } from './helpers/tmp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @type {{ expected: import('../../scripts/test-skips.mjs').Expected[] }} */
const { expected } = JSON.parse(readFileSync(EXPECTED_SKIPS, 'utf8'));

const AGE_SKIP = {
  file: 'core/test/age.test.mjs',
  name: 'interop: a file this code writes opens with the age program',
  reason: 'the age program (age, age-keygen) is not installed; interop not tested',
};
const LINK_SKIP = {
  file: 'core/test/eval.test.mjs',
  name: 'a linked scenario is refused',
  reason: 'Windows: creating symbolic links needs Developer Mode or admin',
};

test('every expected skip names files that give its reason, and none is expected on Linux', () => {
  assert.ok(expected.length > 0 && expected.length <= 8, 'a short list');
  for (const entry of expected) {
    assert.ok(entry.why, `${entry.reason}: says why`);
    assert.ok(!entry.platforms.includes('linux'), `${entry.reason}: CI runs on Linux`);
    for (const file of entry.files) {
      assert.ok(existsSync(join(ROOT, file)), file);
      assert.ok(
        readFileSync(join(ROOT, file), 'utf8').includes(entry.reason),
        `${file} gives the reason "${entry.reason}"`,
      );
    }
  }
});

test('a skip is expected only on a listed platform, in a listed file, with the reason', () => {
  const onLinux = checkSkips([AGE_SKIP, LINK_SKIP], expected, 'linux');
  assert.deepEqual(onLinux.unexpected, [AGE_SKIP, LINK_SKIP]);
  const onWindows = checkSkips([AGE_SKIP, LINK_SKIP], expected, 'win32');
  assert.deepEqual(onWindows.unexpected, [AGE_SKIP]);
  assert.deepEqual(
    onWindows.expected.map((s) => s.name),
    [LINK_SKIP.name],
  );
  // The same reason in a file the entry does not name, or no reason at all, is not expected.
  const elsewhere = { ...LINK_SKIP, file: 'core/test/age.test.mjs' };
  const silent = { ...LINK_SKIP, reason: '' };
  assert.equal(checkSkips([elsewhere, silent], expected, 'win32').unexpected.length, 2);
});

test('the summary lists each skip with its reason and says which are not expected', () => {
  const text = skipsSummary(checkSkips([AGE_SKIP], expected, 'linux'), 'linux');
  assert.match(text, /1 test\(s\) skipped\. 1 of them is not expected on linux/);
  assert.match(
    text,
    /\| not expected \| core\/test\/age\.test\.mjs \| interop: .* \| the age program/,
  );
  assert.match(skipsSummary({ expected: [], unexpected: [] }, 'linux'), /No test skipped on linux/);
});

test('a test name with a backslash, a pipe or a backtick stays inside its table cell', () => {
  assert.equal(cell('a \\| b'), 'a \\\\\\| b');
  assert.equal(cell('run `age` | then\\'), 'run \\`age\\` \\| then\\\\');
  assert.equal(cell('two\nlines\r\nhere'), 'two lines here');
  const odd = { file: 'core/test/x.test.mjs', name: 'C:\\path | `code`', reason: 'why \\ not' };
  const text = skipsSummary(checkSkips([odd], expected, 'linux'), 'linux');
  const row = text.split('\n').find((line) => line.startsWith('| not expected'));
  assert.equal(
    row,
    '| not expected | core/test/x.test.mjs | C:\\\\path \\| \\`code\\` | why \\\\ not |',
  );
});

test('the reporter writes one line per skipped test, and the check fails on one not expected', () => {
  const dir = tempDir('hitld-skips-');
  const file = join(dir, 'sample.test.mjs');
  writeFileSync(
    file,
    [
      "import { test } from 'node:test';",
      "test('runs', () => {});",
      "test('skips with a reason', { skip: 'no tool here' }, () => {});",
      "test('skips without one', { skip: true }, () => {});",
      '',
    ].join('\n'),
  );
  const out = join(dir, 'skips.jsonl');
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${join(ROOT, 'core', 'test', 'helpers', 'skips-reporter.mjs')}`,
      `--test-reporter-destination=${out}`,
      file,
    ],
    // A run of its own, not a child of this one (core/test/run.mjs does the same).
    { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(parseSkips(readFileSync(out, 'utf8')), [
    { file: 'sample.test.mjs', name: 'skips with a reason', reason: 'no tool here' },
    { file: 'sample.test.mjs', name: 'skips without one', reason: '' },
  ]);
  const check = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test-skips.mjs'), out], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(check.status, 1);
  assert.match(check.stdout, /2 test\(s\) skipped\. 2 of them are not expected/);
  // No file of skips: the run did not report, which fails too.
  const missing = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'test-skips.mjs'), join(dir, 'none.jsonl')],
    { encoding: 'utf8' },
  );
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /did not report its skips/);
});

test('the tests job installs age, records the skips, and checks them even after a failure', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const tests = ci.slice(ci.indexOf('\n  tests:\n'), ci.indexOf('\n  evals:\n'));
  assert.match(tests, /apt-get install [^\n]*\bage\b/);
  assert.match(tests, /age --version/);
  assert.match(tests, /HITLD_TEST_SKIPS_FILE: \$\{\{ runner\.temp \}\}\/skips\.jsonl/);
  assert.match(tests, /node scripts\/test-skips\.mjs "\$RUNNER_TEMP\/skips\.jsonl"/);
  assert.match(
    tests,
    /if: \$\{\{ \(success\(\) \|\| failure\(\)\) && steps\.changes\.outputs\.code == 'true' \}\}/,
  );
});
