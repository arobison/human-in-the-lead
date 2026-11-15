import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../lib/version.mjs';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  linkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { policyDefaults, resolvePolicy } from '../lib/policy/policy.mjs';
import { buildFixture } from '../lib/eval/fixtures.mjs';
import { GRADERS, MATCH_LIMITS, safeMatches } from '../lib/eval/graders.mjs';
import { compareToBaseline } from '../lib/eval/gate.mjs';
import { PLUGIN_EVALS, evalOffline } from '../lib/eval/offline.mjs';
import { PROFILES, missingCapabilities } from '../lib/eval/profiles.mjs';
import { discoverScenarios, loadActions, matchesFilter } from '../lib/eval/scenario.mjs';
import {
  getPath,
  readSandboxFile,
  sandboxPath,
  seededShuffle,
  writeSandboxFile,
} from '../lib/eval/util.mjs';
import { LiveNotBuilt, runLive } from '../lib/eval/live.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'hitld-eval-test-'));

/**
 * A directory to run from, with its own private store (so a test never writes to the real one),
 * and an evals directory holding the given scenarios.
 * @param {Record<string, Record<string, unknown>>} scenarios by name, under the piece "t"
 */
function workspace(scenarios) {
  const cwd = tmp();
  const evals = join(cwd, 'evals');
  const dir = join(evals, 'scenarios', 't');
  mkdirSync(dir, { recursive: true });
  const env = { XDG_DATA_HOME: tmp() };
  for (const [name, s] of Object.entries(scenarios)) write(cwd, name, s);
  return {
    cwd,
    env,
    /** @param {string} name @param {Record<string, unknown>} s */
    write: (name, s) => write(cwd, name, s),
    /** @param {Record<string, unknown>} [more] */
    run: (more = {}) => evalOffline({ cwd, env, evalsDir: 'evals', ...more }),
  };
}

/** @param {string} cwd @param {string} name @param {Record<string, unknown>} s */
function write(cwd, name, s) {
  const dir = join(cwd, 'evals', 'scenarios', 't');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.scenario.json`), JSON.stringify(s));
}

/**
 * A scenario that validates an item and expects `valid`.
 * @param {string} name @param {{ expectValid: boolean, category?: string, extra?: Record<string, unknown> }} o
 */
const itemScenario = (name, { expectValid, category = 'schema', extra = {} }) => ({
  schema_version: 1,
  id: `t/${name}`,
  suite: 't',
  category,
  description: 'validates an item',
  mode: 'offline',
  steps: [
    {
      id: 'v',
      action: 'schema.validate',
      with: {
        schema: 'item',
        entity: true,
        data: {
          schema_version: 1,
          id: 'FX-1',
          kind: 'work',
          title: 'x',
          state: 'proposed',
          classification: 'public',
        },
      },
    },
  ],
  graders: [{ grader: 'equals', with: { path: 'steps.v.valid', value: expectValid } }],
  ...extra,
});

test('the shipped scenarios all load and every one passes', async () => {
  const dir = tmp();
  const result = await evalOffline({ cwd: dir, env: { XDG_DATA_HOME: tmp() } });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  const summary = /** @type {any} */ (result.summary);
  assert.equal(summary.failed + summary.errors, 0);
  assert.ok(summary.passed >= 6);
  // Cases a profile cannot run are reported as such, not as passes.
  assert.ok(summary.not_applicable >= 2);
  assert.equal(summary.passed + summary.not_applicable, summary.total);
});

test('a run is recorded with the plugin version, schema versions, policy hash and settings', async () => {
  const w = workspace({ ok: itemScenario('ok', { expectValid: true }) });
  const result = await w.run();
  assert.equal(result.ok, true);
  const text = readFileSync(/** @type {string} */ (result.stored), 'utf8');
  const doc = JSON.parse(text);
  assert.deepEqual(schemas().validateEntity('eval-result', doc), []);
  assert.equal(doc.mode, 'offline');
  assert.equal(doc.plugin.name, 'human-in-the-lead');
  assert.equal(doc.plugin.version, VERSION);
  assert.equal(doc.schema_versions.item, 1);
  assert.equal(doc.schema_versions['eval-result'], 3);
  assert.match(doc.policy_hash, /^[0-9a-f]{64}$/);
  assert.equal(doc.policy_source, 'defaults');
  assert.equal(doc.settings.seed, 1);
  assert.deepEqual(doc.harness.profiles, ['copilot-cloud-agent', 'full', 'minimal']);
  assert.match(doc.scenario_set.version, /^[0-9a-f]{12}$/);
  assert.match(doc.id, /^EV-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
});

test('the gate: with no baseline a passing run is ok, and says there was nothing to compare', async () => {
  const w = workspace({ ok: itemScenario('ok', { expectValid: true }) });
  const result = await w.run();
  const gate = /** @type {any} */ (result.gate);
  assert.equal(gate.ok, true);
  assert.equal(gate.baseline, null);
  assert.match(gate.notes[0], /no baseline/);
});

test('the gate catches a deliberately degraded scenario', async () => {
  const w = workspace({
    a: itemScenario('a', { expectValid: true }),
    b: itemScenario('b', { expectValid: true }),
  });
  const base = await w.run({ acceptBaseline: true });
  assert.equal(base.ok, true);
  assert.ok(base.baseline_accepted);

  // The same run again passes the gate against the baseline.
  const again = /** @type {any} */ (await w.run());
  assert.equal(again.ok, true);
  assert.equal(again.gate.ok, true);
  assert.ok(again.gate.baseline);

  // Degrade scenario b: it now expects the opposite of what the system does.
  w.write('b', itemScenario('b', { expectValid: false }));
  const degraded = /** @type {any} */ (await w.run());
  assert.equal(degraded.ok, false);
  assert.equal(degraded.gate.ok, false);
  const kinds = degraded.gate.failures.map((/** @type {any} */ f) => f.kind).sort();
  assert.deepEqual(kinds, ['category-dropped', 'scenario-regressed']);
  assert.match(
    degraded.gate.failures.find((/** @type {any} */ f) => f.kind === 'scenario-regressed').message,
    /t\/b@none passed in the baseline and now fails/,
  );
  // The transcript of the failure is kept.
  assert.equal(degraded.problems.length, 1);
  assert.ok(
    existsSync(
      join(
        w.env.XDG_DATA_HOME,
        'human-in-the-lead',
        'hitld-evals',
        degraded.problems[0].transcript,
      ),
    ),
  );

  // The same through the command line: exit code 1.
  /** @type {string[]} */
  const out = [];
  const code = await main(['eval', '--offline', '--evals-dir', 'evals'], {
    out: (t) => out.push(t),
    err: () => {},
    cwd: w.cwd,
    env: w.env,
  });
  assert.equal(code, EXIT.failed);
  assert.equal(JSON.parse(out.join('')).gate.ok, false);
});

test('the gate: a scenario removed since the baseline is a failure, not a quiet drop', async () => {
  const w = workspace({
    a: itemScenario('a', { expectValid: true }),
    b: itemScenario('b', { expectValid: true }),
  });
  await w.run({ acceptBaseline: true });
  rmScenario(w.cwd, 'b');
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.gate.failures.map((/** @type {any} */ f) => f.kind),
    ['scenario-missing'],
  );
  // A filtered run does not call the scenarios it was not asked to run missing.
  const filtered = /** @type {any} */ (await w.run({ scenarios: 't/a' }));
  assert.equal(filtered.gate.ok, true);
  assert.ok(filtered.gate.baseline);
});

/** @param {string} cwd @param {string} name */
function rmScenario(cwd, name) {
  const f = join(cwd, 'evals', 'scenarios', 't', `${name}.scenario.json`);
  rmSync(f);
}

test('a baseline needs a full, passing run, and is per seed', async () => {
  const w = workspace({
    a: itemScenario('a', { expectValid: true }),
    bad: itemScenario('bad', { expectValid: false }),
  });
  const failing = /** @type {any} */ (await w.run({ acceptBaseline: true }));
  assert.equal(failing.ok, false);
  assert.match(failing.baseline_refused, /failing scenarios/);
  assert.equal(failing.baseline_accepted, undefined);

  w.write('bad', itemScenario('bad', { expectValid: true }));
  const partial = /** @type {any} */ (await w.run({ acceptBaseline: true, scenarios: 't/a' }));
  assert.match(partial.baseline_refused, /full run/);

  const full = /** @type {any} */ (await w.run({ acceptBaseline: true }));
  assert.ok(full.baseline_accepted);
  const otherSeed = /** @type {any} */ (await w.run({ seed: 7 }));
  assert.equal(otherSeed.gate.baseline, null);
});

test('the gate: a floor fails a run whatever the baseline says', () => {
  const run = fakeResult({ 'injection-containment': 0.875 });
  const verdict = compareToBaseline(run, null, thresholds());
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].kind, 'below-floor');
  assert.match(
    verdict.failures[0].message,
    /injection-containment scored 0.875, below its floor 1/,
  );
});

test('the gate: tokens above tolerance fail, within it pass; wall time is never gated', () => {
  const base = fakeResult({ x: 1 }, { tokens: 1000, wall_ms: 10 });
  const within = fakeResult({ x: 1 }, { tokens: 1099, wall_ms: 5000 });
  const over = fakeResult({ x: 1 }, { tokens: 1101, wall_ms: 10 });
  assert.equal(compareToBaseline(within, base, thresholds()).ok, true);
  const verdict = compareToBaseline(over, base, thresholds());
  assert.deepEqual(
    verdict.failures.map((f) => f.kind),
    ['tokens-rose'],
  );
});

test('the gate: a scenario that was not applicable is not counted as passing', () => {
  const base = fakeResult({ x: 1 });
  const now = fakeResult({ x: 1 });
  now.scenarios[0].result = 'not-applicable';
  now.scenarios[0].reason = 'lacks a capability';
  now.summary.categories = {};
  const verdict = compareToBaseline(now, base, thresholds());
  assert.deepEqual(
    verdict.failures.map((f) => f.kind),
    ['scenario-not-run'],
  );
});

/**
 * @param {Record<string, number>} categories
 * @param {{ tokens?: number | null, wall_ms?: number }} [one]
 */
function fakeResult(categories, one = {}) {
  const entries = Object.entries(categories);
  return /** @type {any} */ ({
    id: 'EV-20261114T000000Z-aaaaaa',
    plugin: { version: '0.0.0' },
    policy_hash: 'h',
    schema_versions: {},
    scenario_set: { version: 'v' },
    scenarios: entries.map(([category, score]) => ({
      id: `p/${category}`,
      profile: 'none',
      category,
      result: score === 1 ? 'pass' : 'fail',
      score,
      graders: [],
      tokens: one.tokens ?? null,
      wall_ms: one.wall_ms ?? 0,
    })),
    summary: {
      categories: Object.fromEntries(entries.map(([c, score]) => [c, { score, scenarios: 1 }])),
    },
  });
}

const thresholds = () => ({
  category_floors: { 'injection-containment': 1 },
  score_tolerance: 0,
  tokens_tolerance: 0.1,
});

test('a scenario file that does not load is an error in the results, never skipped', async () => {
  const w = workspace({
    good: itemScenario('good', { expectValid: true }),
    wrongid: { ...itemScenario('wrongid', { expectValid: true }), id: 't/other' },
    unknownaction: {
      ...itemScenario('unknownaction', { expectValid: true }),
      steps: [{ id: 's', action: 'shell.run', with: {} }],
    },
    badwith: {
      ...itemScenario('badwith', { expectValid: true }),
      steps: [{ id: 's', action: 'cli', with: { argv: [] } }],
    },
    needsharness: {
      ...itemScenario('needsharness', { expectValid: true }),
      steps: [{ id: 's', action: 'adapter.capabilities' }],
    },
  });
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.ok, false);
  assert.equal(result.summary.total, 5);
  assert.equal(result.summary.errors, 4);
  const reasons = Object.fromEntries(
    result.problems.map((/** @type {any} */ p) => [p.scenario, p.reason]),
  );
  assert.match(reasons['t/wrongid'], /id is "t\/other", but the file's path says "t\/wrongid"/);
  assert.match(reasons['t/unknownaction'], /unknown action "shell.run"/);
  assert.match(reasons['t/badwith'], /argv must have at least 1 item/);
  assert.match(reasons['t/needsharness'], /must declare a `harness`/);
});

test('a scenario file is data: a key that names code is refused in it', async () => {
  const w = workspace({
    s: {
      ...itemScenario('s', { expectValid: true }),
      steps: [
        { id: 'v', action: 'schema.validate', with: { schema: 'item', data: { on_merge: 'x' } } },
      ],
    },
  });
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.ok, false);
  assert.match(result.problems[0].reason, /names code to run/);
  // And the schema refuses a top-level one.
  const errors = schemas().validateEntity('eval-scenario', {
    ...itemScenario('s', { expectValid: true }),
    script: 'x',
  });
  assert.match(errors[0].message, /names code to run/);
});

test('a scenario that breaks while running is an error with the step named, not a failure', async () => {
  const w = workspace({
    broken: {
      ...itemScenario('broken', { expectValid: true }),
      steps: [{ id: 'w', action: 'file.write', with: { path: '../outside.txt', content: 'x' } }],
    },
  });
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.summary.errors, 1);
  assert.match(
    result.problems[0].reason,
    /step w \(file.write\) failed to run: path "..\/outside.txt" leaves the sandbox/,
  );
});

test('model_judge and live scenarios are not applicable offline, never passed', async () => {
  const w = workspace({
    judged: {
      ...itemScenario('judged', { expectValid: true }),
      graders: [{ grader: 'model_judge', with: { path: 'steps.v.valid', rubric: 'is it good' } }],
    },
    live: itemScenario('live', { expectValid: true, extra: { mode: 'live' } }),
  });
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.summary.passed, 0);
  assert.equal(result.summary.not_applicable, 2);
  assert.equal(result.ok, true);
});

test('a scenario runs under each profile it names, and a missing capability is not applicable', async () => {
  const w = workspace({
    par: {
      schema_version: 1,
      id: 't/par',
      suite: 't',
      category: 'portability',
      description: 'needs parallel subagents',
      mode: 'offline',
      harness: { profiles: ['*'], requires: { parallel_subagents: true } },
      steps: [{ id: 'c', action: 'adapter.capabilities' }],
      graders: [{ grader: 'equals', with: { path: 'steps.c.parallel_subagents', value: true } }],
    },
  });
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.not_applicable, 2);
  const stored = JSON.parse(readFileSync(result.stored, 'utf8'));
  const by = Object.fromEntries(
    stored.scenarios.map((/** @type {any} */ s) => [s.profile, s.result]),
  );
  assert.deepEqual(by, {
    full: 'pass',
    minimal: 'not-applicable',
    'copilot-cloud-agent': 'not-applicable',
  });
  assert.deepEqual(stored.summary.categories, { portability: { score: 1, scenarios: 1 } });
});

test('profiles: the Copilot cloud agent profile is a valid capability set, and differs from full', () => {
  for (const p of Object.values(PROFILES)) {
    assert.deepEqual(schemas().validate('harness-capabilities', p.capabilities), [], p.id);
  }
  const c = PROFILES['copilot-cloud-agent'].capabilities;
  assert.equal(c.parallel_subagents, false);
  assert.equal(c.background_completion, false);
  assert.equal(c.hooks, 'subset');
  assert.deepEqual(missingCapabilities(c, { hooks: ['full', 'subset'] }), []);
  assert.match(missingCapabilities(c, { hooks: 'full' })[0], /hooks: needs "full", has "subset"/);
});

test('the fixture generator is deterministic by seed, and its policy validates', () => {
  const a = buildFixture(tmp(), { generator: 'repo' }, { seed: 5, evalsDir: '' });
  const b = buildFixture(tmp(), { generator: 'repo' }, { seed: 5, evalsDir: '' });
  const c = buildFixture(tmp(), { generator: 'repo' }, { seed: 6, evalsDir: '' });
  assert.deepEqual(a.files, b.files);
  assert.notDeepEqual(a.files, c.files);
  for (const f of a.files)
    assert.equal(readFileSync(join(a.dir, f), 'utf8'), readFileSync(join(b.dir, f), 'utf8'));
  const policy = JSON.parse(readFileSync(join(a.dir, '.human-in-the-lead/policy.json'), 'utf8'));
  assert.deepEqual(resolvePolicy(policy).errors, []);
  assert.deepEqual(a.project, { id: 'fixture-repo', key: 'FX' });
});

test('the fixture generator: languages, module counts, and a git repository with a fixed commit', () => {
  const py = buildFixture(
    tmp(),
    { generator: 'repo', options: { language: 'python', modules: 3 } },
    { seed: 1, evalsDir: '' },
  );
  assert.equal(py.files.filter((f) => f.endsWith('.py')).length, 6);
  assert.ok(!py.files.includes('package.json'));
  const js = buildFixture(
    tmp(),
    { generator: 'repo', options: { modules: 1 } },
    { seed: 1, evalsDir: '' },
  );
  assert.equal(js.files.filter((f) => f.endsWith('.js')).length, 2);
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'repo', options: { language: 'cobol' } },
        { seed: 1, evalsDir: '' },
      ),
    /language must be/,
  );
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'repo', options: { modules: 99 } },
        { seed: 1, evalsDir: '' },
      ),
    /modules must be/,
  );
  const g1 = buildFixture(
    tmp(),
    { generator: 'repo', options: { git: true } },
    { seed: 3, evalsDir: '' },
  );
  const g2 = buildFixture(
    tmp(),
    { generator: 'repo', options: { git: true } },
    { seed: 3, evalsDir: '' },
  );
  assert.match(/** @type {string} */ (g1.commit), /^[0-9a-f]{40}$/);
  assert.equal(g1.commit, g2.commit);
  assert.throws(
    () => buildFixture(tmp(), { generator: 'nope' }, { seed: 1, evalsDir: '' }),
    /unknown fixture generator/,
  );
});

test('the copy generator copies a fixture directory fresh, and will not leave evals/fixtures', () => {
  const evals = tmp();
  mkdirSync(join(evals, 'fixtures', 'small', 'src'), { recursive: true });
  writeFileSync(join(evals, 'fixtures', 'small', 'src', 'a.txt'), 'hello');
  const f = buildFixture(
    tmp(),
    { generator: 'copy', options: { from: 'small' } },
    { seed: 1, evalsDir: evals },
  );
  assert.deepEqual(f.files, ['src/a.txt']);
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'copy', options: { from: '../x' } },
        { seed: 1, evalsDir: evals },
      ),
    /must name a directory/,
  );
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'copy', options: { from: 'missing' } },
        { seed: 1, evalsDir: evals },
      ),
    /is not a directory/,
  );
});

test('paths: the sandbox is not escapable, and getPath reads lists with [*]', () => {
  const s = tmp();
  assert.throws(() => sandboxPath(s, '../x'), /leaves the sandbox/);
  assert.throws(() => sandboxPath(s, '/etc/passwd'), /relative/);
  assert.equal(sandboxPath(s, 'a/b'), join(s, 'a/b'));
  const data = { a: [{ m: 'x' }, { m: 'y' }, { n: 1 }], s: { 'x-y': 2 } };
  assert.deepEqual(getPath(data, 'a[*].m'), { found: true, value: ['x', 'y'] });
  assert.deepEqual(getPath(data, 'a[1].m'), { found: true, value: 'y' });
  assert.equal(getPath(data, 'a[5].m').found, false);
  assert.equal(getPath(data, '__proto__').found, false);
  assert.equal(getPath(data, 'a.length').found, false);
});

test('the seeded order is reproducible and depends on the seed', () => {
  const list = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(seededShuffle(list, 3), seededShuffle(list, 3));
  assert.notDeepEqual(seededShuffle(list, 3), seededShuffle(list, 4));
  assert.deepEqual(
    [...seededShuffle(list, 3)].sort((a, b) => a - b),
    list,
  );
});

test('graders say what they found', () => {
  const state = {
    steps: { s: { n: 3, list: [{ m: 'alpha' }, { m: 'beta' }], bad: { schema_version: 1 } } },
    sandbox: tmp(),
    adapterCalls: [{ method: 'dispatch', args: [] }],
  };
  const run = (/** @type {string} */ g, /** @type {any} */ w) => GRADERS[g].run(w, state);
  assert.equal(run('equals', { path: 'steps.s.n', value: 3 }).passed, true);
  assert.match(run('equals', { path: 'steps.s.n', value: 4 }).message, /is 3, expected 4/);
  assert.match(
    run('equals', { path: 'steps.s.gone', value: 1 }).message,
    /was not produced by any step/,
  );
  assert.equal(run('matches', { path: 'steps.s.list[*].m', pattern: '^be' }).passed, true);
  assert.equal(
    run('matches', { path: 'steps.s.list[*].m', pattern: '^be', mode: 'all' }).passed,
    false,
  );
  assert.equal(run('count', { path: 'steps.s.list', equals: 2 }).passed, true);
  assert.equal(run('count', { path: 'steps.s.list', max: 1 }).passed, false);
  assert.equal(run('contains', { path: 'steps.s.list', value: { m: 'beta' } }).passed, true);
  assert.equal(run('schema', { path: 'steps.s.bad', schema: 'item', entity: true }).passed, false);
  assert.equal(run('file_exists', { path: 'nope.txt' }).passed, false);
  assert.equal(run('file_exists', { path: 'nope.txt', present: false }).passed, true);
  assert.equal(run('adapter_calls', { method: 'dispatch', equals: 1 }).passed, true);
  assert.equal(run('adapter_calls', { method: 'ask', equals: 0 }).passed, true);
  assert.throws(() => run('model_judge', { path: 'steps.s.n', rubric: 'r' }), /needs a model/);
});

test('the command: a mode is required, --live is a marked seam, and the help lists the options', async () => {
  /** @param {string[]} argv */
  const go = async (argv) => {
    let out = '';
    const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd: tmp(), env: {} });
    return { code, out };
  };
  const none = await go(['eval']);
  assert.equal(none.code, EXIT.failed);
  assert.equal(JSON.parse(none.out).error, 'usage');
  const live = await go(['eval', '--live']);
  assert.equal(JSON.parse(live.out).error, 'not_built');
  assert.match(JSON.parse(live.out).message, /live.mjs/);
  await assert.rejects(() => runLive([], { harness: 'x', models: {}, k: 3 }), LiveNotBuilt);
  const help = await go(['eval', '--help']);
  for (const opt of [
    '--offline',
    '--live',
    '--scenarios',
    '--seed',
    '--accept-baseline',
    '--evals-dir',
  ]) {
    assert.ok(help.out.includes(opt), opt);
  }
  const empty = await go(['eval', '--offline', '--scenarios', 'no-such-piece']);
  assert.equal(JSON.parse(empty.out).error, 'no_scenarios');
});

test('filters match an ID or the start of one', () => {
  assert.equal(matchesFilter('foundation/a', null), true);
  assert.equal(matchesFilter('foundation/a', 'foundation'), true);
  assert.equal(matchesFilter('foundation/a', 'foundation/a'), true);
  assert.equal(matchesFilter('foundation/a', 'rights, foundation/'), true);
  assert.equal(matchesFilter('foundation/a', 'rights'), false);
});

test('actions are loaded from files in the actions directory, each name once', async () => {
  const actions = await loadActions();
  for (const name of [
    'cli',
    'file.write',
    'file.set-json',
    'schema.validate',
    'adapter.dispatch',
    'adapter.capabilities',
  ]) {
    assert.ok(actions[name], name);
  }
  assert.ok(
    readdirSync(fileURLToPath(new URL('../lib/eval/actions/', import.meta.url))).includes(
      'builtin.mjs',
    ),
  );
});

test('the shipped scenarios have the ID their path says and each category is named', async () => {
  const loaded = discoverScenarios(PLUGIN_EVALS, await loadActions());
  assert.ok(loaded.length >= 4);
  for (const l of loaded) {
    assert.deepEqual(l.problems, [], l.id);
    assert.equal(l.scenario?.id, l.id);
  }
});

test('the eval policy section has documented defaults, and refuses a floor outside 0 to 1', () => {
  const d = policyDefaults().eval;
  assert.equal(d.category_floors['injection-containment'], 1);
  assert.ok(
    d.category_floors['escalation-recall'] > 0 && d.category_floors['escalation-recall'] < 1,
  );
  assert.equal(d.score_tolerance, 0);
  assert.equal(d.tokens_tolerance, 0.1);
  const project = { id: 'p', key: 'PX' };
  const ok = resolvePolicy({
    schema_version: 1,
    project,
    eval: { category_floors: { triage: 0.8 } },
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.policy?.eval.category_floors['injection-containment'], 1, 'maps merge');
  const bad = resolvePolicy({
    schema_version: 1,
    project,
    eval: { category_floors: { triage: 1.5 } },
  });
  assert.match(bad.errors[0].message, /above the maximum 1/);
});

test('a symbolic link cannot take a path out of the sandbox', () => {
  const outside = tmp();
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  const sandbox = tmp();
  mkdirSync(join(sandbox, 'real'));
  symlinkSync(outside, join(sandbox, 'dirlink'));
  symlinkSync(join(outside, 'secret.txt'), join(sandbox, 'filelink'));
  symlinkSync(join(outside, 'not-there'), join(sandbox, 'dangling'));
  symlinkSync(join(sandbox, 'real'), join(sandbox, 'inside-link'));
  // A relative path through a symlinked directory, to a file that exists and one that does not.
  assert.throws(() => sandboxPath(sandbox, 'dirlink/secret.txt'), /through a symbolic link/);
  assert.throws(() => sandboxPath(sandbox, 'dirlink/new/file.txt'), /through a symbolic link/);
  assert.throws(() => sandboxPath(sandbox, 'dirlink'), /through a symbolic link/);
  assert.throws(() => sandboxPath(sandbox, 'filelink'), /through a symbolic link/);
  assert.throws(() => sandboxPath(sandbox, 'dangling'), /does not resolve/);
  // A link that stays inside is fine; a plain new path is fine.
  assert.equal(sandboxPath(sandbox, 'inside-link/x.txt'), join(sandbox, 'inside-link/x.txt'));
  assert.equal(sandboxPath(sandbox, 'a/b/c.txt'), join(sandbox, 'a/b/c.txt'));
  // The last component is never followed, even if the check were bypassed.
  assert.throws(() => writeSandboxFile(join(sandbox, 'filelink'), 'overwritten'));
  assert.throws(() => readSandboxFile(join(sandbox, 'filelink')));
  assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'secret');
});

test('actions cannot write or read through a link out of the sandbox', async () => {
  const outside = tmp();
  writeFileSync(join(outside, 'p.json'), '{}');
  const w = workspace({
    probe: {
      ...itemScenario('probe', { expectValid: true }),
      fixture: { generator: 'copy', options: { from: 'clean' } },
      steps: [{ id: 'w', action: 'file.write', with: { path: 'x/y.txt', content: 'x' } }],
      graders: [{ grader: 'equals', with: { path: 'steps.w.path', value: 'x/y.txt' } }],
    },
  });
  mkdirSync(join(w.cwd, 'evals', 'fixtures', 'clean'), { recursive: true });
  writeFileSync(join(w.cwd, 'evals', 'fixtures', 'clean', 'a.txt'), 'a');
  assert.equal(/** @type {any} */ (await w.run()).ok, true);
  // The same fixture with a link out is refused whole.
  symlinkSync(outside, join(w.cwd, 'evals', 'fixtures', 'clean', 'escape'));
  const result = /** @type {any} */ (await w.run());
  assert.equal(result.ok, false);
  assert.match(result.problems[0].reason, /escape is a symbolic link/);
});

test('the copy generator refuses hard-linked files', () => {
  const outside = tmp();
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  const evals = tmp();
  mkdirSync(join(evals, 'fixtures', 'withhard'), { recursive: true });
  linkSync(join(outside, 'secret.txt'), join(evals, 'fixtures', 'withhard', 'hard.txt'));
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'copy', options: { from: 'withhard' } },
        { seed: 1, evalsDir: evals },
      ),
    /hard\.txt is a hard link/,
  );
});

test('the copy generator refuses symbolic links, in the fixture and as the fixture', () => {
  const outside = tmp();
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  const evals = tmp();
  const fx = join(evals, 'fixtures');
  mkdirSync(join(fx, 'withfile'), { recursive: true });
  mkdirSync(join(fx, 'withdir', 'sub'), { recursive: true });
  symlinkSync(join(outside, 'secret.txt'), join(fx, 'withfile', 'link.txt'));
  symlinkSync(outside, join(fx, 'withdir', 'sub', 'dirlink'));
  symlinkSync(outside, join(fx, 'asdir'));
  const copy = (/** @type {string} */ from) => () => {
    const dir = tmp();
    try {
      return buildFixture(
        dir,
        { generator: 'copy', options: { from } },
        { seed: 1, evalsDir: evals },
      );
    } finally {
      assert.deepEqual(
        readdirSync(dir).filter((n) => n.includes('link') || n === 'secret.txt'),
        [],
      );
    }
  };
  assert.throws(copy('withfile'), /link\.txt is a symbolic link/);
  assert.throws(copy('withdir'), /sub\/dirlink is a symbolic link/);
  assert.throws(copy('asdir'), /is a symbolic link/);
  // A fixtures directory that is itself a link is refused too.
  const evals2 = tmp();
  symlinkSync(fx, join(evals2, 'fixtures'));
  assert.throws(
    () =>
      buildFixture(
        tmp(),
        { generator: 'copy', options: { from: 'withfile' } },
        { seed: 1, evalsDir: evals2 },
      ),
    /symbolic link/,
  );
});

test('a catastrophic pattern fails fast as a grader error, and does not hang the run', async () => {
  const evil = '^(a+)+$';
  const input = `${'a'.repeat(40)}!`;
  const started = performance.now();
  assert.throws(() => safeMatches(evil, [input]), /took longer than \d+ ms and was stopped/);
  assert.ok(performance.now() - started < MATCH_LIMITS.timeoutMs + 3000);
  // Through a scenario: the grader errors, the scenario fails, the run finishes.
  const w = workspace({
    redos: {
      ...itemScenario('redos', { expectValid: true }),
      steps: [
        {
          id: 'v',
          action: 'file.write',
          with: { path: 'a.txt', content: input },
        },
        {
          id: 'c',
          action: 'schema.validate',
          with: { schema: 'item', data: { title: input } },
        },
      ],
      graders: [
        {
          id: 'evil',
          grader: 'matches',
          with: { path: 'steps.c.errors[*].message', pattern: evil },
        },
      ],
    },
  });
  const t = performance.now();
  const result = /** @type {any} */ (await w.run());
  assert.ok(performance.now() - t < 15000);
  assert.equal(result.ok, false);
});

test('matches: normal patterns still work, and limits and bad patterns are errors', () => {
  assert.deepEqual(safeMatches('^be', ['alpha', 'beta', 7]), [false, true, false]);
  assert.deepEqual(safeMatches('é+', ['caf\u00e9']), [true]);
  assert.throws(
    () => safeMatches('a'.repeat(MATCH_LIMITS.patternLength + 1), ['a']),
    /limit is 200/,
  );
  assert.throws(
    () => safeMatches('a', ['a'.repeat(MATCH_LIMITS.inputLength + 1)]),
    /limit is 10000/,
  );
  assert.throws(() => safeMatches('a', Array(MATCH_LIMITS.inputs + 1).fill('a')), /limit is 500/);
  assert.throws(() => safeMatches('(', ['a']), /the pattern is invalid/);
  // A long pattern is also refused when the scenario is loaded.
  assert.match(JSON.stringify(GRADERS.matches.input.properties.pattern), /"maxLength":200/);
});
