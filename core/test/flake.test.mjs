// Flaky tests (design 14.7): the quarantine file and its guard, the base comparison, burn-in, the
// quarantine honored by the full suite, the evidence in the private store, the digest section and
// the commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { runMergeQueue, shellExec } from '../lib/merge/queue.mjs';
import {
  QUARANTINE_PATH,
  activeEntries,
  addEntry,
  checkQuarantine,
  emptyQuarantine,
  expiredEntries,
  expiredQuestion,
  expiryFrom,
  flakeDigest,
  parseTestReport,
  quarantineEvidence,
  readFlakes,
  recordFlakes,
  serializeQuarantine,
} from '../lib/merge/quarantine.mjs';
import { commitAll, fixtureGit, putFiles } from '../lib/eval/orchestrator-fixtures.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { makeConsumer } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const NOW = new Date('2026-11-15T12:00:00Z');
const minimal = { schema_version: 1, project: { id: 'test', key: 'W' } };

/** @param {Record<string, unknown>} [over] */
const entry = (over = {}) => ({
  id: 'suite > a flaky test',
  expires: '2026-11-29',
  fix_item: 'W-9',
  ...over,
});
const file = (/** @type {Record<string, unknown>[]} */ ...tests) =>
  JSON.stringify({ schema_version: 1, tests });

// --- the policy and the file's schema --------------------------------------------------------

test('policy flake: the defaults are the decided ones, and the bounds hold', () => {
  const p = resolvePolicy(minimal).policy?.flake;
  assert.equal(p.compare_runs, 10);
  assert.equal(p.burn_in_runs, 5);
  assert.equal(p.quarantine_days, 14);
  assert.equal(p.fixed_runs, 100);
  assert.equal(p.burn_in_command, undefined);
  assert.equal(resolvePolicy({ ...minimal, flake: { compare_runs: 0 } }).policy, null);
  assert.equal(resolvePolicy({ ...minimal, flake: { quarantine_days: 365 } }).policy, null);
  assert.equal(
    resolvePolicy({ ...minimal, flake: { burn_in_command: 'node b.mjs' } }).errors.length,
    0,
  );
  assert.equal(resolvePolicy({ ...minimal, flake: { retries: 3 } }).policy, null);
});

test('policy flake: the burn-in command is marked as code to run, and no other setting is', () => {
  const s = schemas().get('policy/flake');
  const marked = Object.entries(s.properties)
    .filter(([, v]) => /** @type {any} */ (v)['x-hitld-executes'])
    .map(([k]) => k);
  assert.deepEqual(marked, ['burn_in_command']);
});

// --- the guard on the quarantine file --------------------------------------------------------

test('the guard refuses an entry without an expiry or a fix item, and says which', () => {
  assert.deepEqual(checkQuarantine(file(entry())).problems, []);
  const noExpiry = checkQuarantine(file({ id: 't', fix_item: 'W-9' }));
  assert.equal(noExpiry.file, null);
  assert.deepEqual(noExpiry.problems, ['"t": no expiry. A quarantine always ends']);
  const noFix = checkQuarantine(file({ id: 't', expires: '2026-12-01' }));
  assert.match(noFix.problems.join('\n'), /"t": no fix item/);
  const neither = checkQuarantine(file({ id: 't' }));
  assert.equal(neither.problems.length, 2);
  assert.match(checkQuarantine(file(entry({ expires: '2026-13-40' }))).problems[0], /not a date/);
  assert.match(checkQuarantine(file(entry({ fix_item: '' }))).problems.join(), /no fix item/);
});

test('the guard refuses evidence and anything else the file may not hold', () => {
  const log = checkQuarantine(file(entry({ log: 'AssertionError: expected 1' })));
  assert.match(log.problems.join('\n'), /tests\[0\]\.log: is not a known key/);
  assert.match(
    checkQuarantine(file(entry({ fix_item: 'not an item' }))).problems.join('\n'),
    /fix_item/,
  );
  assert.match(checkQuarantine('not json').problems[0], /not JSON/);
  assert.match(checkQuarantine('[]').problems[0], /JSON object/);
  assert.match(
    checkQuarantine(JSON.stringify({ tests: [entry()] })).problems.join('\n'),
    /schema_version: is required/,
  );
  assert.match(
    checkQuarantine(file(entry(), entry())).problems.join('\n'),
    /appears twice with the same scope/,
  );
  assert.deepEqual(checkQuarantine(file(entry(), entry({ environments: ['win32'] }))).problems, []);
});

test('an entry is active until the end of its expiry day, and only where its scope holds', () => {
  const f = checkQuarantine(
    file(
      entry({ id: 'a', expires: '2026-11-15' }),
      entry({ id: 'b', expires: '2026-11-14' }),
      entry({ id: 'c', environments: ['win32'] }),
    ),
  ).file;
  assert.deepEqual(
    activeEntries(f, NOW, ['linux']).map((e) => e.id),
    ['a'],
  );
  assert.deepEqual(
    activeEntries(f, NOW, ['win32']).map((e) => e.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    expiredEntries(f, NOW).map((e) => e.id),
    ['b'],
  );
  assert.equal(expiryFrom(NOW, 14), '2026-11-29');
});

test('addEntry applies the guard to the result', () => {
  const added = addEntry(emptyQuarantine(), entry());
  assert.ok('file' in added);
  assert.match(serializeQuarantine(added.file), /"fix_item": "W-9"/);
  const bad = addEntry(emptyQuarantine(), entry({ fix_item: undefined }));
  assert.ok('problems' in bad);
  assert.ok('problems' in addEntry(added.file, entry()));
});

test('a test report is a versioned list of outcomes; anything else is no report', () => {
  const ok = parseTestReport(
    JSON.stringify({
      schema_version: 1,
      tests: [
        { id: 'a', outcome: 'pass' },
        { id: 'b', outcome: 'fail', file: 'test/b.js' },
      ],
    }),
  );
  assert.deepEqual(ok, [
    { id: 'a', outcome: 'pass' },
    { id: 'b', outcome: 'fail', file: 'test/b.js' },
  ]);
  assert.equal(parseTestReport('{}'), null);
  assert.equal(parseTestReport('nope'), null);
  assert.equal(
    parseTestReport(JSON.stringify({ schema_version: 1, tests: [{ id: 'a', outcome: 'maybe' }] })),
    null,
  );
});

// --- the queue, on a repository whose suite reports its tests ---------------------------------

const SUITE = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const { tests } = JSON.parse(readFileSync('tests.json', 'utf8'));
const out = [];
for (const t of tests) {
  let n = 0;
  if (t.mode === 'odd' || t.mode === 'once') {
    const f = join(dir, t.id);
    n = (existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0) + 1;
    writeFileSync(f, String(n));
  }
  const fails = t.mode === 'fail' || (t.mode === 'odd' && n % 2 === 1) || (t.mode === 'once' && n === 1);
  out.push({ id: t.id, outcome: fails ? 'fail' : 'pass', file: t.file });
}
if (process.env.HITLD_TEST_REPORT && !process.env.NO_REPORT) {
  writeFileSync(process.env.HITLD_TEST_REPORT, JSON.stringify({ schema_version: 1, tests: out }));
}
process.exit(out.some((t) => t.outcome === 'fail') ? 1 : 0);
`;

/** @param {{ id: string, mode: string, file?: string }[]} tests */
const testsJson = (tests) => JSON.stringify({ tests }, null, 2) + '\n';

/**
 * A repository whose full suite runs the tests listed in tests.json. A test's mode: pass, fail,
 * odd (fails on every odd run anywhere, counted outside the repository) or once (fails the first
 * time it runs).
 * @param {{ id: string, mode: string, file?: string }[]} tests
 * @param {Record<string, string>} [files]
 */
function makeRepo(tests, files = {}) {
  const base = realpathSync(tempDir('hitld-flake-'));
  const root = join(base, 'repo');
  mkdirSync(root);
  fixtureGit(root, 'init', '-q', '-b', 'main');
  fixtureGit(root, 'config', 'user.name', 'Fixture');
  fixtureGit(root, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(root, 'config', 'commit.gpgsign', 'false');
  putFiles(root, { 'suite.mjs': SUITE, 'tests.json': testsJson(tests), ...files });
  commitAll(root, 'main');
  const counters = join(base, 'counters');
  /** @param {string} name @param {Record<string, string>} change */
  const branch = (name, change) => {
    fixtureGit(root, 'switch', '-q', '-c', name, 'main');
    putFiles(root, change);
    commitAll(root, name);
    fixtureGit(root, 'switch', '-q', 'main');
  };
  /** @param {Record<string, unknown>} [flake] @param {Record<string, unknown>} [more] */
  const settings = (flake = {}, more = {}) => ({
    mainBranch: 'main',
    batchMax: 4,
    fastChecks: [],
    fullSuite: [`node suite.mjs ${JSON.stringify(counters)}`],
    generated: [],
    flakeReruns: 1,
    flake: { compareRuns: 3, compareRunsMax: 3, burnInRuns: 3, testGlobs: ['test/**'], ...flake },
    ...more,
  });
  return { root, base, counters, branch, settings };
}

const W1 = [{ item: 'W-1', branch: 'W-1' }];

test('a failure that passes on rerun and fails on the base too is a pre-existing flake: nobody is blamed', async () => {
  const r = makeRepo([{ id: 'flaky', mode: 'odd', file: 'test/flaky.js' }]);
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(
    q.merged.map((m) => m.item),
    ['W-1'],
  );
  assert.deepEqual(q.rejected, []);
  assert.notEqual(fixtureGit(r.root, 'rev-parse', 'main'), before);
  assert.equal(q.flakes.length, 1);
  const f = q.flakes[0];
  assert.equal(f.outcome, 'preexisting');
  assert.deepEqual(f.tests, ['flaky']);
  assert.deepEqual(f.quarantinable, ['flaky']);
  assert.deepEqual(f.base, { runs: 1, failures: 1 });
  assert.equal(f.runs, 2); // the rerun, and one run on the base
  assert.equal(q.failures.length, 1);
  assert.equal(q.incident, null);
});

test('a failure only the candidate shows, again and again, is the change: it is bisected and sent back', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', {
    'tests.json': testsJson([
      { id: 'ok', mode: 'pass' },
      { id: 'new', mode: 'odd', file: 'test/new.js' },
    ]),
  });
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(q.merged, []);
  assert.equal(q.rejected.length, 1);
  assert.equal(q.rejected[0].reason, 'suite');
  assert.match(String(q.rejected[0].message), /fails intermittently with your branch/);
  assert.equal(q.flakes[0].outcome, 'introduced');
  assert.deepEqual(q.flakes[0].base, { runs: 3, failures: 0 });
  assert.equal(q.flakes[0].candidate.failures, 1);
  assert.equal(q.incident, null);
  assert.equal(fixtureGit(r.root, 'rev-parse', 'main'), before);
});

test('a failure that shows on neither side is inconclusive: counted, nobody blamed, the batch merges', async () => {
  const r = makeRepo([{ id: 'once', mode: 'once' }]);
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(
    q.merged.map((m) => m.item),
    ['W-1'],
  );
  assert.equal(q.flakes[0].outcome, 'inconclusive');
  assert.deepEqual(q.flakes[0].quarantinable, []);
  assert.deepEqual(q.flakes[0].base, { runs: 3, failures: 0 });
  assert.deepEqual(q.flakes[0].candidate, { runs: 3, failures: 0 });
});

test('the comparison never runs more than the ceiling', async () => {
  const r = makeRepo([{ id: 'once', mode: 'once' }]);
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({ compareRuns: 50, compareRunsMax: 2 }),
  });
  assert.deepEqual(q.flakes[0].base, { runs: 2, failures: 0 });
  assert.deepEqual(q.flakes[0].candidate, { runs: 2, failures: 0 });
});

test('a failure that fails again on the rerun is real: no comparison, and the culprit goes back as before', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', {
    'tests.json': testsJson([
      { id: 'ok', mode: 'pass' },
      { id: 'bad', mode: 'fail' },
    ]),
  });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(q.flakes, []);
  assert.equal(q.failures[0].outcome, 'real');
  assert.equal(q.rejected[0].reason, 'suite');
  assert.equal(q.rejected[0].message, undefined);
});

test('with flake_reruns 0 a failure is not rerun and is bisected at once', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', {
    'tests.json': testsJson([
      { id: 'ok', mode: 'pass' },
      { id: 'bad', mode: 'fail' },
    ]),
  });
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({}, { flakeReruns: 0 }),
  });
  assert.equal(q.failures[0].outcome, 'real');
  assert.equal(q.failures[0].runs, 0);
  assert.equal(q.rejected[0].reason, 'suite');
});

test('without a test report the comparison works on the whole suite, and nothing is quarantinable', async () => {
  const r = makeRepo([{ id: 'flaky', mode: 'odd' }]);
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings(),
    exec: (cmd, cwd, env) => shellExec(`NO_REPORT=1 ${cmd}`, cwd, env),
  });
  assert.equal(q.flakes[0].outcome, 'preexisting');
  assert.deepEqual(q.flakes[0].tests, []);
  assert.deepEqual(q.flakes[0].quarantinable, []);
  assert.equal(q.merged.length, 1);
});

test('a flake in a test the branch changed is not quarantinable', async () => {
  const r = makeRepo([{ id: 'flaky', mode: 'odd', file: 'test/flaky.js' }], {
    'test/flaky.js': '// a\n',
  });
  r.branch('W-1', { 'test/flaky.js': '// changed\n' });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.equal(q.flakes[0].outcome, 'preexisting');
  assert.deepEqual(q.flakes[0].tests, ['flaky']);
  assert.deepEqual(q.flakes[0].quarantinable, []);
});

// --- the quarantine honored by the full suite -------------------------------------------------

const BAD = [
  { id: 'ok', mode: 'pass' },
  { id: 'bad', mode: 'fail', file: 'test/bad.js' },
];

test('a quarantined test still runs but does not fail the suite, and the failure is recorded', async () => {
  const r = makeRepo(BAD, { [QUARANTINE_PATH]: file(entry({ id: 'bad', expires: '2999-01-01' })) });
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(
    q.merged.map((m) => m.item),
    ['W-1'],
  );
  assert.deepEqual(q.failures, []);
  assert.deepEqual(q.excused, [{ commit: q.excused[0].commit, tests: ['bad'] }]);
});

test('an expired entry, or one scoped to another environment, gates', async () => {
  for (const q of [
    entry({ id: 'bad', expires: '2020-01-01' }),
    entry({ id: 'bad', expires: '2999-01-01', environments: ['no-such-environment'] }),
  ]) {
    const r = makeRepo(BAD, { [QUARANTINE_PATH]: file(q) });
    r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
    const res = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
    assert.deepEqual(res.merged, []);
    // It gates again, and main itself has the failing test.
    assert.equal(res.incident?.kind, 'main_red');
  }
});

test('an entry for this environment holds, by the policy label too', async () => {
  const r = makeRepo(BAD, {
    [QUARANTINE_PATH]: file(entry({ id: 'bad', expires: '2999-01-01', environments: ['pg-16'] })),
  });
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({ environments: ['pg-16'] }),
  });
  assert.equal(q.merged.length, 1);
});

test("a quarantined test the branch changed is the branch's to fix", async () => {
  const r = makeRepo(BAD, { [QUARANTINE_PATH]: file(entry({ id: 'bad', expires: '2999-01-01' })) });
  r.branch('W-1', { 'test/bad.js': '// changed\n' });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(q.merged, []);
  assert.equal(q.rejected[0].reason, 'suite');
});

test('a failure of another test beside a quarantined one still fails the suite', async () => {
  const r = makeRepo(
    [
      { id: 'bad', mode: 'fail' },
      { id: 'also-bad', mode: 'fail' },
    ],
    { [QUARANTINE_PATH]: file(entry({ id: 'bad', expires: '2999-01-01' })) },
  );
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(q.merged, []);
});

test('a branch that changes the quarantine file is sent back, whatever the entry says', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', { [QUARANTINE_PATH]: file(entry({ id: 'ok', expires: '2999-01-01' })) });
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.deepEqual(
    q.rejected.map((x) => [x.item, x.reason, x.files]),
    [['W-1', 'quarantine', [QUARANTINE_PATH]]],
  );
  assert.match(String(q.rejected[0].message), /Only the orchestrator quarantines a test/);
  assert.equal(fixtureGit(r.root, 'rev-parse', 'main'), before);
});

test('a quarantine file on main that fails the guard stops the queue', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }], {
    [QUARANTINE_PATH]: file({ id: 'bad', fix_item: 'W-9' }),
  });
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({ repoRoot: r.root, entries: W1, settings: r.settings() });
  assert.equal(q.incident?.kind, 'quarantine');
  assert.match(String(q.incident?.message), /no expiry/);
  assert.deepEqual(q.merged, []);
  assert.equal(fixtureGit(r.root, 'rev-parse', 'main'), before);
});

// --- burn-in -----------------------------------------------------------------------------------

test('tests a branch adds or changes are burned in, with a seed that differs each run', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', { 'test/new.test.js': '// new\n', 'src/a.js': 'export const a = 1;\n' });
  /** @type {Record<string, string>[]} */
  const calls = [];
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({ burnInCommand: 'burn-in' }),
    exec: (cmd, cwd, env) => {
      if (cmd !== 'burn-in') return shellExec(cmd, cwd, env);
      calls.push(env);
      return { ok: true, output: '' };
    },
  });
  assert.equal(q.merged.length, 1);
  assert.deepEqual(q.burn_ins, [{ item: 'W-1', runs: 3, ok: true }]);
  assert.deepEqual(
    calls.map((c) => c.HITLD_BURN_IN_RUN),
    ['1', '2', '3'],
  );
  assert.equal(new Set(calls.map((c) => c.HITLD_BURN_IN_SEED)).size, 3);
  assert.ok(calls.every((c) => c.HITLD_BURN_IN_FILES === 'test/new.test.js'));
});

test('a new test that fails once in burn-in sends its branch back before it can gate anyone', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', { 'test/new.test.js': '// new\n' });
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({ burnInCommand: 'burn-in' }),
    exec: (cmd, cwd, env) =>
      cmd === 'burn-in'
        ? { ok: env.HITLD_BURN_IN_RUN !== '2', output: 'order dependent' }
        : shellExec(cmd, cwd, env),
  });
  assert.deepEqual(q.merged, []);
  assert.deepEqual(
    q.rejected.map((x) => [x.reason, x.files]),
    [['burn_in', ['test/new.test.js']]],
  );
  assert.match(String(q.rejected[0].message), /failed on run 2 of 3/);
  assert.deepEqual(q.burn_ins, [{ item: 'W-1', runs: 2, ok: false }]);
  assert.equal(q.suite_runs, 0);
  assert.equal(fixtureGit(r.root, 'rev-parse', 'main'), before);
});

test('a branch that changes no test, or a project with no burn-in command, is not burned in', async () => {
  const r = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r.branch('W-1', { 'src/a.js': 'export const a = 1;\n' });
  const none = await runMergeQueue({
    repoRoot: r.root,
    entries: W1,
    settings: r.settings({ burnInCommand: 'burn-in' }),
    exec: (cmd, cwd, env) =>
      cmd === 'burn-in' ? { ok: false, output: 'ran' } : shellExec(cmd, cwd, env),
  });
  assert.deepEqual(none.burn_ins, []);
  assert.equal(none.merged.length, 1);
  const r2 = makeRepo([{ id: 'ok', mode: 'pass' }]);
  r2.branch('W-1', { 'test/new.test.js': '// new\n' });
  const without = await runMergeQueue({ repoRoot: r2.root, entries: W1, settings: r2.settings() });
  assert.deepEqual(without.burn_ins, []);
  assert.equal(without.merged.length, 1);
});

// --- the evidence, the digest and the measures --------------------------------------------------

/** @param {Partial<import('../lib/merge/queue.mjs').Failure>} [over] @returns {import('../lib/merge/queue.mjs').Failure} */
const failure = (over = {}) => ({
  commit: 'abc',
  command: 'node suite.mjs',
  output: 'boom',
  outcome: 'preexisting',
  items: ['W-1'],
  tests: ['t1'],
  quarantinable: ['t1'],
  base: { runs: 1, failures: 1 },
  candidate: { runs: 0, failures: 0 },
  runs: 2,
  ...over,
});

test('the evidence stays in the private store, keyed by test ID, and lets a test be quarantined', () => {
  const store = openStore(tempDir('hitld-flake-store-'));
  recordFlakes(store, {
    failures: [failure(), failure({ outcome: 'real', tests: ['t2'], quarantinable: [], runs: 1 })],
    excused: [{ commit: 'abc', tests: ['t1'] }],
    burn_ins: [{ item: 'W-1', runs: 5, ok: true }],
  });
  const records = readFlakes(store);
  assert.deepEqual(
    records.map((r) => r.kind),
    ['failure', 'failure', 'excused', 'burn_in'],
  );
  assert.equal(records[0].output, 'boom');
  assert.ok(quarantineEvidence(records, 't1'));
  assert.equal(quarantineEvidence(records, 't2'), null);
  assert.equal(quarantineEvidence(records, 'unknown'), null);
});

test('the digest lists the quarantine with expiry and fix item, and the flake measures', () => {
  const records = [
    { kind: 'failure', ...failure() },
    { kind: 'failure', ...failure({ outcome: 'inconclusive', runs: 7, quarantinable: [] }) },
    { kind: 'failure', ...failure({ outcome: 'real', runs: 1 }) },
    { kind: 'failure', ...failure({ outcome: 'real', runs: 1 }) },
    { kind: 'excused', commit: 'abc', tests: ['t1'] },
    { kind: 'burn_in', item: 'W-1', runs: 5, ok: true },
    { kind: 'quarantined', at: '2026-11-01T00:00:00.000Z', test: 't1', fix_item: 'W-9' },
    { kind: 'quarantined', at: '2026-11-01T00:00:00.000Z', test: 't3', fix_item: 'W-8' },
    { kind: 'removed', at: '2026-11-04T00:00:00.000Z', test: 't3', fix_item: 'W-8' },
  ];
  const d = flakeDigest({
    file: checkQuarantine(
      file(entry({ id: 't1', expires: '2026-12-01' }), entry({ id: 't2', expires: '2026-11-10' })),
    ).file,
    records,
    now: NOW,
    labels: ['linux'],
    quarantineDays: 14,
  });
  assert.equal(d.size, 2);
  assert.deepEqual(d.expired, ['t2']);
  assert.deepEqual(
    d.quarantined.map((e) => [e.test, e.expires, e.fix_item, e.failures_excused]),
    [
      ['t1', '2026-12-01', 'W-9', 1],
      ['t2', '2026-11-10', 'W-9', 0],
    ],
  );
  assert.equal(d.quarantined[0].age_days, 14);
  assert.equal(d.oldest_days, 18);
  assert.deepEqual(d.measures, {
    failures: 4,
    flake_candidates: 2,
    flake_rate: 0.5,
    preexisting: 1,
    introduced: 0,
    inconclusive: 1,
    flake_cost_runs: 9,
    burn_in_runs: 5,
    excused_failures: 1,
    time_to_deflake_days: 3,
  });
  const q = expiredQuestion(checkQuarantine(file(entry({ id: 't2' }))).file?.tests[0] ?? entry());
  assert.deepEqual(schemas().validate('question', q), []);
});

// --- the commands --------------------------------------------------------------------------------

/** @param {ReturnType<typeof makeConsumer>} c */
function consumerStore(c) {
  return openStore(privateStorePath('orch-fixture', { env: c.env, repoRoot: c.root }));
}

test('hitld check quarantine: ok without a file, refused with an entry that has no expiry', async () => {
  const c = makeConsumer();
  const none = await c.hitld(['check', 'quarantine']);
  assert.equal(none.exit, 0);
  assert.equal(none.result.present, false);
  writeFileSync(join(c.root, QUARANTINE_PATH), file({ id: 't', fix_item: 'W-1' }));
  const bad = await c.hitld(['check', 'quarantine']);
  assert.equal(bad.exit, 1);
  assert.deepEqual(bad.result.problems, ['"t": no expiry. A quarantine always ends']);
  writeFileSync(join(c.root, QUARANTINE_PATH), file(entry({ fix_item: 'W-1' })));
  const good = await c.hitld(['check', 'quarantine']);
  assert.equal(good.exit, 0);
  assert.equal(good.result.tests, 1);
});

test("hitld quarantine add needs the queue's evidence and a fix item, and sets the expiry itself", async () => {
  const c = makeConsumer();
  const args = ['quarantine', 'add', '--test', 't1', '--fix-item', 'W-1'];
  const none = await c.hitld(args);
  assert.equal(none.exit, 1);
  assert.equal(none.result.error, 'no-evidence');

  recordFlakes(consumerStore(c), { failures: [failure()], excused: [], burn_ins: [] });
  const missing = await c.hitld(['quarantine', 'add', '--test', 't1', '--fix-item', 'W-999']);
  assert.equal(missing.result.error, 'fix-item');
  const decision = await c.hitld(['quarantine', 'add', '--test', 't9', '--fix-item', 'W-1']);
  assert.equal(decision.result.error, 'no-evidence');

  const ok = await c.hitld([...args, '--environment', 'linux']);
  assert.equal(ok.exit, 0, JSON.stringify(ok.result));
  assert.equal(ok.result.entry.expires, expiryFrom(new Date(), 14));
  assert.match(ok.result.next, /commit \.human-in-the-lead\/quarantine\.json/);
  const text = readFileSync(join(c.root, QUARANTINE_PATH), 'utf8');
  assert.deepEqual(JSON.parse(text).tests, [
    { id: 't1', environments: ['linux'], expires: ok.result.entry.expires, fix_item: 'W-1' },
  ]);
  assert.equal((await c.hitld(['check', 'quarantine'])).exit, 0);
  const again = await c.hitld([...args, '--environment', 'linux']);
  assert.equal(again.result.error, 'already-quarantined');

  const list = await c.hitld(['quarantine', 'list']);
  assert.equal(list.exit, 0);
  assert.equal(list.result.size, 1);
  assert.equal(list.result.quarantined[0].fix_item, 'W-1');
  assert.equal(list.result.measures.failures, 1);
  assert.deepEqual(list.result.decisions, []);
});

test('hitld quarantine: an executor may not, and a stale entry needs the owner to renew it', async () => {
  const c = makeConsumer();
  recordFlakes(consumerStore(c), { failures: [failure()], excused: [], burn_ins: [] });
  const denied = await c.hitld(['quarantine', 'add', '--test', 't1', '--fix-item', 'W-1'], {
    env: { HITLD_ROLE: 'executor' },
  });
  assert.equal(denied.exit, 1);
  assert.equal(denied.result.error, 'not-permitted');
  assert.equal((await c.hitld(['check', 'quarantine'])).result.present, false);

  writeFileSync(
    join(c.root, QUARANTINE_PATH),
    file(entry({ id: 't1', expires: '2020-01-01', fix_item: 'W-1' })),
  );
  const list = await c.hitld(['quarantine', 'list']);
  assert.deepEqual(list.result.expired, ['t1']);
  assert.equal(list.result.decisions[0].fix_item, 'W-1');
  const renew = await c.hitld(['quarantine', 'add', '--test', 't1', '--fix-item', 'W-1']);
  assert.equal(renew.result.error, 'decision');
  const notAnswered = await c.hitld([
    'quarantine',
    'add',
    '--test',
    't1',
    '--fix-item',
    'W-1',
    '--decision',
    'W-2',
  ]);
  assert.equal(notAnswered.result.error, 'decision');
});

test('hitld quarantine remove: held until the fix is done, or the entry has expired', async () => {
  const c = makeConsumer();
  writeFileSync(
    join(c.root, QUARANTINE_PATH),
    file(entry({ id: 't1', expires: '2999-01-01', fix_item: 'W-1' })),
  );
  const held = await c.hitld(['quarantine', 'remove', '--test', 't1']);
  assert.equal(held.result.error, 'fix-not-done');
  assert.equal(
    (await c.hitld(['quarantine', 'remove', '--test', 'nope'])).result.error,
    'not-found',
  );
  writeFileSync(
    join(c.root, QUARANTINE_PATH),
    file(entry({ id: 't1', expires: '2020-01-01', fix_item: 'W-1' })),
  );
  const gone = await c.hitld(['quarantine', 'remove', '--test', 't1']);
  assert.equal(gone.exit, 0, JSON.stringify(gone.result));
  assert.deepEqual(JSON.parse(readFileSync(join(c.root, QUARANTINE_PATH), 'utf8')).tests, []);
  assert.ok(readFlakes(consumerStore(c)).some((r) => r.kind === 'removed' && r.test === 't1'));
});

// --- the harness guard ---------------------------------------------------------------------------

const GUARD = fileURLToPath(new URL('../harness/claude-code/hooks/guard.mjs', import.meta.url));
/** @param {string} command @param {boolean} [executor] */
const guard = (command, executor = true) =>
  spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({
      ...(executor ? { agent_type: 'human-in-the-lead:executor-tier2' } : {}),
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  }).stdout;

test('guard: an executor may read the quarantine file but not write it or run the quarantine commands', () => {
  for (const command of [
    'hitld quarantine add --test t --fix-item W-1',
    'node core/bin/hitld.mjs quarantine remove --test t',
    'echo {} > .human-in-the-lead/quarantine.json',
    'sed -i s/a/b/ .human-in-the-lead/quarantine.json',
    'rm .human-in-the-lead/quarantine.json',
    'git checkout main -- .human-in-the-lead/quarantine.json',
  ]) {
    assert.match(guard(command), /"deny"/, command);
  }
  assert.equal(guard('cat .human-in-the-lead/quarantine.json'), '');
  assert.equal(guard('hitld check quarantine'), '');
  assert.equal(guard('hitld quarantine add --test t --fix-item W-1', false), '');
});
