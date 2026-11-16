// The faster checks (HITLD-131): which checks CI runs for a pull request's paths, which tests
// check:fast picks, the isolated home every test and eval case runs in, and the slowest-files
// report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../../scripts/ci-changes.mjs';
import { TEST_RUNNER, nearImports, selectTests } from '../../scripts/check-fast.mjs';
import { isolatedEnv, isolateProcessEnv } from '../lib/isolated-env.mjs';
import { ISOLATED_HOME, REAL_HOME_DIRS, reached } from './helpers/isolated-home.mjs';
import { slowestTable } from './helpers/slowest-reporter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a pull request that changes only work/ skips the code checks; CodeQL also skips docs and text', () => {
  assert.deepEqual(classify(['work/items/HITLD-1-x.md', 'work/views/index.md']), {
    code: false,
    codeql: false,
  });
  assert.deepEqual(classify(['docs/guide/a.md', 'README.md', 'work/items/a.md']), {
    code: true,
    codeql: false,
  });
  assert.deepEqual(classify(['skills/execute/SKILL.md']), { code: true, codeql: false });
  assert.deepEqual(classify(['work/items/a.md', 'core/lib/x.mjs']), { code: true, codeql: true });
  assert.deepEqual(classify(['.github/workflows/ci.yml']), { code: true, codeql: true });
  assert.deepEqual(classify(['schemas/item.schema.json']), { code: true, codeql: true });
  // Nothing seen is not "only text".
  assert.deepEqual(classify([]), { code: true, codeql: true });
});

test('CI keeps every job name that may be required, and decides skips inside the jobs', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const job of [
    'check',
    'dco',
    'public',
    'typecheck',
    'format',
    'tests',
    'evals',
    'tracker',
  ]) {
    assert.match(ci, new RegExp(`^  ${job}:$`, 'm'), `job ${job}`);
  }
  // No path filter on the workflow: a filtered-out run would leave required checks waiting.
  assert.doesNotMatch(ci, /paths(-ignore)?:/);
  const codeql = readFileSync(join(ROOT, '.github', 'workflows', 'codeql.yml'), 'utf8');
  assert.match(codeql, /name: Analyze \(\$\{\{ matrix\.language \}\}\)/);
  assert.doesNotMatch(codeql, /paths(-ignore)?:/);
  for (const text of [ci, codeql]) assert.match(text, /node scripts\/ci-changes\.mjs/);
});

test('check:fast picks the tests that use the touched area, a changed test, and the build test', () => {
  /** @type {Record<string, string>} */
  const files = {
    'core/lib/a/one.mjs': "import { b } from '../beta/two.mjs';\n",
    'core/lib/a/other.mjs': '',
    'core/lib/beta/two.mjs': '',
    'core/lib/c/three.mjs': "const dir = join(root, 'schemas');\n",
    'core/lib/packaging/build.mjs': '',
    'core/test/helpers/h.mjs': "import '../../lib/c/three.mjs';\n",
    'core/test/a.test.mjs': "import '../lib/a/other.mjs';\n",
    'core/test/b.test.mjs': "import { x } from '../lib/a/one.mjs';\n",
    'core/test/c.test.mjs': "const { c } = await import('../lib/c/three.mjs');\n",
    'core/test/h.test.mjs': "import { h } from './helpers/h.mjs';\n",
    'core/test/beta-more.test.mjs': '',
    'core/test/build.test.mjs': "import { build } from '../lib/packaging/build.mjs';\n",
  };
  const read = (/** @type {string} */ f) => files[f] ?? null;
  const tests = Object.keys(files).filter((f) => f.endsWith('.test.mjs'));
  // A test's own imports, through its helpers, and no further.
  assert.deepEqual(
    [...nearImports('core/test/h.test.mjs', read)].sort(),
    ['core/lib/c/three.mjs', 'core/test/h.test.mjs', 'core/test/helpers/h.mjs'].sort(),
  );
  assert.ok(!nearImports('core/test/b.test.mjs', read).has('core/lib/beta/two.mjs'));
  const pick = (/** @type {string[]} */ changed) => selectTests(changed, tests, read);
  // A module's area is its directory: both tests that use core/lib/a run, and the build test.
  assert.deepEqual(pick(['core/lib/a/one.mjs']).tests, [
    'core/test/a.test.mjs',
    'core/test/b.test.mjs',
    'core/test/build.test.mjs',
  ]);
  // A test named after the area runs too; one that reaches it only through another area does not.
  assert.deepEqual(pick(['core/lib/beta/two.mjs']).tests, [
    'core/test/beta-more.test.mjs',
    'core/test/build.test.mjs',
  ]);
  assert.deepEqual(pick(['core/test/h.test.mjs']).tests, [
    'core/test/h.test.mjs',
    'core/test/build.test.mjs',
  ]);
  assert.ok(pick(['core/test/helpers/h.mjs']).tests.includes('core/test/h.test.mjs'));
  // A data directory: the tests whose own modules name it.
  assert.deepEqual(pick(['schemas/item.schema.json']).tests, [
    'core/test/c.test.mjs',
    'core/test/h.test.mjs',
    'core/test/build.test.mjs',
  ]);
  // Tracker files are for `hitld work check`, and touch no plugin source.
  assert.deepEqual(pick(['work/items/a.md']).tests, []);
  // A top-level file: everything.
  assert.equal(pick(['package.json']).all, true);
  assert.equal(pick(['package.json']).tests.length, tests.length);
});

test('npm test and check:fast run the tests one way: isolated, reporting the slowest files', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, `node ${TEST_RUNNER}`);
  const runner = readFileSync(join(ROOT, TEST_RUNNER), 'utf8');
  assert.match(runner, /'--import',\s*join\(HERE, 'helpers', 'isolated-home\.mjs'\)/);
  assert.match(runner, /helpers', 'slowest-reporter\.mjs'/);
  assert.match(runner, /\['--test', \.\.\.TEST_FLAGS,/);
  assert.equal(pkg.scripts['check:fast'], 'node scripts/check-fast.mjs');
  assert.match(pkg.scripts['format:check'], /--cache/);
  const ignore = readFileSync(join(ROOT, '.prettierignore'), 'utf8');
  assert.match(ignore, /^plugins\/human-in-the-lead\/$/m);
});

test('an isolated environment keeps only what programs need, with a home of its own', () => {
  const base = {
    PATH: ['/usr/bin', '/home/someone/.local/bin', '/bin'].join(delimiter),
    HOME: '/home/someone',
    LANG: 'C.UTF-8',
    HITLD_STORE_REMOTE: 'https://example.invalid/store.git',
    XDG_CONFIG_HOME: '/home/someone/.config',
    GIT_CONFIG_GLOBAL: '/home/someone/.gitconfig',
    GIT_DIR: '/somewhere/.git',
    CI: 'true',
  };
  const env = isolatedEnv('/tmp/h', base);
  assert.equal(env.HOME, '/tmp/h');
  assert.equal(env.XDG_CONFIG_HOME, join('/tmp/h', '.config'));
  assert.equal(env.XDG_DATA_HOME, join('/tmp/h', '.local', 'share'));
  assert.equal(env.GIT_CONFIG_GLOBAL, join('/tmp/h', '.gitconfig'));
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.LANG, 'C.UTF-8');
  for (const name of ['HITLD_STORE_REMOTE', 'GIT_DIR', 'CI']) assert.equal(env[name], undefined);
  const path = env.PATH.split(delimiter);
  assert.equal(path[0], dirname(process.execPath), "node's own directory first");
  assert.ok(path.includes('/usr/bin') && path.includes('/bin'));
  assert.ok(!path.includes('/home/someone/.local/bin'), 'no program from the old home');
});

test('isolating process.env changes the same object, and puts it back', () => {
  const before = { ...process.env };
  process.env.HITLD_PROBE = 'x';
  const restore = isolateProcessEnv(join(ISOLATED_HOME, 'nested'));
  assert.equal(process.env.HITLD_PROBE, undefined);
  assert.equal(process.env.HOME, join(ISOLATED_HOME, 'nested'));
  assert.equal(homedir(), join(ISOLATED_HOME, 'nested'));
  restore();
  assert.equal(process.env.HITLD_PROBE, 'x');
  delete process.env.HITLD_PROBE;
  assert.deepEqual({ ...process.env }, before);
});

test('every test file runs with an isolated home, and one that reaches the real home fails', () => {
  assert.equal(homedir(), ISOLATED_HOME);
  assert.ok(statSync(ISOLATED_HOME).isDirectory());
  assert.equal(
    Object.keys(process.env).filter((n) => n.startsWith('HITLD_')).length,
    0,
    'no HITLD_* variable reaches a test',
  );
  assert.ok(!REAL_HOME_DIRS.some((h) => ISOLATED_HOME === h));
  for (const real of REAL_HOME_DIRS) {
    const probe = join(real, '.config', 'human-in-the-lead', 'person.json');
    const count = reached.length;
    assert.throws(() => existsSync(probe), /reached the real home directory/);
    assert.throws(() => readFileSync(probe), /reached the real home directory/);
    assert.equal(reached.length, count + 2);
    // Recorded hits fail the file at exit; these two were this test's own.
    reached.splice(count);
  }
});

test('the slowest-files report lists files by time, slowest first, with paths from the checkout', () => {
  const totals = new Map([
    [join(ROOT, 'core/test/a.test.mjs'), 1500],
    [join(ROOT, 'core/test/b.test.mjs'), 25_300],
    [join(ROOT, 'core/test/c.test.mjs'), 300],
  ]);
  const text = slowestTable(totals, 2, ROOT);
  assert.match(text, /27\.1 s in 3 files/);
  const rows = text.trim().split('\n').slice(1);
  assert.deepEqual(rows, ['    25.3 s  core/test/b.test.mjs', '     1.5 s  core/test/a.test.mjs']);
  assert.equal(slowestTable(totals, 0, ROOT), '');
});
