import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoOnMain } from './eval-git.mjs';
import { main } from '../lib/cli/main.mjs';
import { COMMANDS } from '../lib/cli/table.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { openStore } from '../lib/store/store.mjs';
import { DETAIL_LIMIT, GRADERS, boundVerdict } from '../lib/eval/graders.mjs';
import { acceptRefusal, fromLegacyResult, readBaseline } from '../lib/eval/results.mjs';
import { renderEvalReport } from '../lib/eval/report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'hitld-eval-accept-test-'));

/**
 * A scenario that validates an item; `grader` is its one grader.
 * @param {string} name @param {Record<string, unknown>} grader
 */
const scenario = (name, grader) => ({
  schema_version: 1,
  id: `t/${name}`,
  suite: 't',
  category: 'schema',
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
  graders: [grader],
});
const GOOD = { grader: 'equals', with: { path: 'steps.v.valid', value: true } };
const BAD = { grader: 'equals', with: { path: 'steps.v.valid', value: false } };

/** A directory with its own private store and evals; `hitld` runs a command in it. */
/** @param {Record<string, Record<string, unknown>>} [scenarios] */
function workspace(scenarios = { a: GOOD }) {
  const cwd = tmp();
  const dir = join(cwd, 'evals', 'scenarios', 't');
  mkdirSync(dir, { recursive: true });
  /** @param {string} name @param {Record<string, unknown>} grader */
  const put = (name, grader) =>
    writeFileSync(join(dir, `${name}.scenario.json`), JSON.stringify(scenario(name, grader)));
  for (const [name, g] of Object.entries(scenarios)) put(name, g);
  repoOnMain(cwd); // a baseline is accepted only from a run on main with a clean tree
  const env = { XDG_DATA_HOME: tmp() };
  /** @param {string[]} argv @param {Record<string, string>} [more] */
  const hitld = async (argv, more = {}) => {
    /** @type {string[]} */
    const out = [];
    const code = await main(argv, {
      out: (t) => out.push(t),
      err: () => {},
      cwd,
      env: { ...env, ...more },
    });
    return { code, json: JSON.parse(out.join('') || 'null') };
  };
  const store = () =>
    openStore(
      join(
        realpathSync.native(/** @type {string} */ (env.XDG_DATA_HOME)),
        'human-in-the-lead',
        'hitld-evals',
      ),
    );
  const offline = (
    /** @type {string[]} */ extra = [],
    /** @type {Record<string, string>} */ more = {},
  ) => hitld(['eval', '--offline', '--evals-dir', 'evals', ...extra], more);
  return { cwd, dir, env, hitld, store, put, offline };
}

test('eval accept: a full, passing run becomes the baseline, recorded as the owner’s, without a re-run', async () => {
  const w = workspace();
  const ran = await w.offline();
  assert.equal(ran.code, 0);
  const before = w.store().list('eval/results/');
  const r = await w.hitld(['eval', 'accept', '--result', ran.json.run]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.run, ran.json.run);
  assert.equal(r.json.accepted.by, 'owner');
  assert.equal(r.json.accepted.run, ran.json.run);
  assert.match(r.json.accepted.at, /^\d{4}-\d\d-\d\dT/);
  // It did not run again: no new result, and the baseline is exactly that run.
  assert.deepEqual(w.store().list('eval/results/'), before);
  const stored = JSON.parse(w.store().read(`eval/results/${ran.json.run}.json`) ?? 'null');
  const baseline = readBaseline(w.store(), stored);
  assert.equal(baseline?.id, ran.json.run);
  assert.deepEqual(baseline?.accepted, r.json.accepted);
  assert.equal(stored.accepted, undefined);
  // A second time: already the baseline.
  const again = await w.hitld(['eval', 'accept', '--result', ran.json.run]);
  assert.equal(again.code, 1);
  assert.equal(again.json.error, 'not-accepted');
  assert.match(again.json.message, /already the baseline/);
});

test('eval accept: refuses a partial run, a failing run, a run that failed the gate, and a run that is not stored', async () => {
  const w = workspace({ a: GOOD, b: GOOD });
  const partial = await w.offline(['--scenarios', 't/a']);
  const refusedPartial = await w.hitld(['eval', 'accept', '--result', partial.json.run]);
  assert.equal(refusedPartial.json.error, 'not-accepted');
  assert.match(refusedPartial.json.message, /only some scenarios/);

  const full = await w.offline();
  assert.equal((await w.hitld(['eval', 'accept', '--result', full.json.run])).code, 0);
  // A scenario that was in the baseline is gone: nothing fails, but the gate does.
  rmSync(join(w.dir, 'b.scenario.json'));
  const gated = await w.offline();
  assert.equal(gated.json.gate.ok, false);
  const refusedGate = await w.hitld(['eval', 'accept', '--result', gated.json.run]);
  assert.equal(refusedGate.json.error, 'not-accepted');
  assert.match(refusedGate.json.message, /regression gate/);

  const w2 = workspace({ a: BAD });
  const failing = await w2.offline();
  const refusedFail = await w2.hitld(['eval', 'accept', '--result', failing.json.run]);
  assert.equal(refusedFail.json.error, 'not-accepted');
  assert.match(refusedFail.json.message, /failing scenarios/);
  assert.equal(w2.store().list('eval/baselines/').length, 0);

  for (const bad of ['EV-20000101T000000Z-000000', '../../etc/passwd']) {
    assert.equal((await w.hitld(['eval', 'accept', '--result', bad])).json.error, 'no-eval-run');
  }
});

test('acceptRefusal: a live run is refused, an offline passing run with a passing gate is not', () => {
  const base = {
    id: 'EV-20261114T031500Z-abcdef',
    mode: 'offline',
    settings: { scenario_filter: null },
    summary: { failed: 0, errors: 0 },
    gate: { ok: true },
  };
  assert.equal(acceptRefusal(base, null), null);
  assert.match(acceptRefusal({ ...base, mode: 'live' }, null) ?? '', /live/);
  assert.match(acceptRefusal({ ...base, gate: undefined }, null) ?? '', /no gate verdict/);
});

test('eval accept: executors are refused, by HITLD_ROLE and by HITLD_DISPATCH, and so is --accept-baseline', async () => {
  const w = workspace();
  const ran = await w.offline();
  /** @type {Record<string, string>[]} */
  const executors = [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-4' }];
  for (const env of executors) {
    const accept = await w.hitld(['eval', 'accept', '--result', ran.json.run], env);
    assert.equal(accept.code, 1);
    assert.equal(accept.json.error, 'not-permitted');
    const flag = await w.offline(['--accept-baseline'], env);
    assert.equal(flag.json.error, 'not-permitted');
  }
  assert.equal(w.store().list('eval/baselines/').length, 0);
});

test('eval accept is not an MCP tool, and the --accept-baseline owner path still works and records the acceptance', async () => {
  const cmd = COMMANDS.find((c) => c.name === 'eval accept');
  assert.equal(cmd?.mcp, false);
  const w = workspace();
  const r = await w.offline(['--accept-baseline']);
  assert.equal(r.code, 0);
  const stored = JSON.parse(w.store().read(`eval/results/${r.json.run}.json`) ?? 'null');
  assert.equal(readBaseline(w.store(), stored)?.accepted?.run, r.json.run);
});

test('the results page shows hitld eval accept --result <id> under the same conditions', async () => {
  const w = workspace();
  const ran = await w.offline();
  const page = async () => readFileSync((await w.hitld(['eval', 'report'])).json.html, 'utf8');
  let html = await page();
  assert.match(
    html,
    new RegExp(`<pre tabindex="0">hitld eval accept --result ${ran.json.run}</pre>`),
  );
  assert.doesNotMatch(html, /--accept-baseline/);
  await w.hitld(['eval', 'accept', '--result', ran.json.run]);
  html = await page();
  assert.match(html, /already the baseline/);
  assert.doesNotMatch(html, /hitld eval accept --run/);
});

test('graders store path, expected and actual', () => {
  const state = {
    steps: { s: { n: 3, list: [1, 2], text: 'abc' } },
    sandbox: tmp(),
    adapterCalls: [],
  };
  const eq = GRADERS.equals.run({ path: 'steps.s.n', value: 4 }, state);
  assert.deepEqual([eq.path, eq.expected, eq.actual], ['steps.s.n', 4, 3]);
  const m = GRADERS.matches.run({ path: 'steps.s.text', pattern: '^z' }, state);
  assert.deepEqual([m.path, m.actual], ['steps.s.text', 'abc']);
  assert.match(String(m.expected), /\^z/);
  const c = GRADERS.contains.run({ path: 'steps.s.list', value: 9 }, state);
  assert.deepEqual([c.path, c.expected, c.actual], ['steps.s.list', 9, [1, 2]]);
  const n = GRADERS.count.run({ path: 'steps.s.list', min: 5 }, state);
  assert.deepEqual([n.path, n.expected, n.actual], ['steps.s.list', { min: 5 }, 2]);
  const f = GRADERS.file_exists.run({ path: 'nope.txt' }, state);
  assert.deepEqual([f.path, f.expected, f.actual], ['nope.txt', 'present', 'absent']);
  const a = GRADERS.adapter_calls.run({ method: 'x', equals: 1 }, state);
  assert.deepEqual([a.expected, a.actual], [{ method: 'x', equals: 1 }, 0]);
  const missing = GRADERS.equals.run({ path: 'steps.nope', value: 1 }, state);
  assert.equal(missing.path, 'steps.nope');
});

test('stored expected and actual are capped and marked truncated; short ones are kept whole', async () => {
  assert.deepEqual(boundVerdict({ passed: false, message: 'm', expected: 1, actual: 'a' }), {
    passed: false,
    message: 'm',
    expected: 1,
    actual: 'a',
  });
  const cut = boundVerdict({ passed: false, message: 'm', expected: 'x'.repeat(5000), actual: 1 });
  assert.equal(String(cut.expected).length, DETAIL_LIMIT);
  assert.equal(/** @type {any} */ (cut).expected_truncated, true);
  assert.equal(/** @type {any} */ (cut).actual_truncated, undefined);
  // End to end: the run file stays small, is valid, and the page marks the cut.
  const w = workspace({
    big: { grader: 'equals', with: { path: 'steps.v.valid', value: 'y'.repeat(50000) } },
  });
  const ran = await w.offline();
  const text = w.store().read(`eval/results/${ran.json.run}.json`) ?? '';
  assert.ok(text.length < 20000, `${text.length}`);
  const doc = JSON.parse(text);
  assert.deepEqual(schemas().validateEntity('eval-result', doc), []);
  const g = doc.scenarios.find((/** @type {any} */ s) => s.id === 't/big' && s.graders.length)
    .graders[0];
  assert.equal(g.path, 'steps.v.valid');
  assert.equal(g.actual, true);
  assert.equal(g.expected.length, DETAIL_LIMIT);
  assert.equal(g.expected_truncated, true);
  const html = renderEvalReport(doc, null);
  assert.match(html, /too long to keep whole/);
});

test('the page renders grader detail escaped', () => {
  const doc = JSON.parse(JSON.stringify(sampleRun()));
  doc.scenarios[0].graders[0] = {
    id: 'g',
    grader: 'equals',
    passed: false,
    message: 'm',
    path: 'steps.<b>',
    expected: '<script>1</script>',
    actual: { a: '"&' },
  };
  const html = renderEvalReport(doc, null);
  assert.match(html, /steps\.&lt;b&gt;/);
  assert.match(html, /&lt;script&gt;1&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>1/);
});

/** A version 1 run, as stored before grader detail existed. */
function sampleRun() {
  return {
    schema_version: 1,
    id: 'EV-20261101T000000Z-abcdef',
    at: '2026-11-01T00:00:00.000Z',
    mode: 'offline',
    plugin: { name: 'human-in-the-lead', version: '0.0.0', commit: null },
    schema_versions: {},
    harness: { adapter: 'fake', profiles: ['none'] },
    policy_hash: null,
    policy_source: 'defaults',
    settings: { seed: 1, profiles: ['none'], scenario_filter: null, settings_hash: 'abcdef012345' },
    scenario_set: { version: '0123456789ab', count: 1 },
    scenarios: [
      {
        id: 't/a',
        suite: 't',
        category: 'schema',
        profile: 'none',
        result: 'fail',
        score: 0,
        graders: [{ id: 'equals-1', grader: 'equals', passed: false, message: 'was 1' }],
        wall_ms: 1,
        tokens: null,
        transcript: null,
      },
    ],
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      errors: 0,
      not_applicable: 0,
      tokens: 0,
      wall_ms: 1,
      categories: { schema: { score: 0, scenarios: 1 } },
    },
  };
}

test('older stored runs and baselines (version 1, no detail, no accepted record) still load and render', async () => {
  const doc = sampleRun();
  assert.deepEqual(schemas().validateEntity('eval-result', fromLegacyResult(doc)), []);
  assert.match(renderEvalReport(doc, null), /was 1/);
  const w = workspace();
  w.store().write(`eval/results/${doc.id}.json`, JSON.stringify(doc));
  w.store().write(`eval/baselines/offline-abcdef012345.json`, JSON.stringify(doc));
  assert.equal(readBaseline(w.store(), doc)?.id, doc.id);
  const r = await w.hitld(['eval', 'report', '--result', doc.id]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.ok(existsSync(r.json.html));
  // And a run from a newer release is still refused.
  assert.ok(schemas().validateEntity('eval-result', { ...doc, schema_version: 4 }).length > 0);
});

test('acceptRefusal: a run judged against another baseline, or older than the current one, is refused', () => {
  const run = {
    id: 'EV-20261114T031500Z-abcdef',
    at: '2026-11-14T03:15:00.000Z',
    mode: 'offline',
    settings: { scenario_filter: null },
    summary: { failed: 0, errors: 0 },
    gate: { ok: true, baseline: 'EV-OLD' },
  };
  const current = { id: 'EV-NEW', at: '2026-11-14T03:10:00.000Z' };
  assert.match(
    acceptRefusal(/** @type {any} */ (run), /** @type {any} */ (current)) ?? '',
    /different baseline/,
  );
  assert.match(
    acceptRefusal(
      /** @type {any} */ ({ ...run, gate: { ok: true, baseline: null } }),
      /** @type {any} */ (current),
    ) ?? '',
    /different baseline/,
  );
  const judged = { ...run, gate: { ok: true, baseline: 'EV-NEW' } };
  assert.equal(acceptRefusal(/** @type {any} */ (judged), /** @type {any} */ (current)), null);
  assert.match(
    acceptRefusal(
      /** @type {any} */ (judged),
      /** @type {any} */ ({ ...current, at: '2026-11-14T04:00:00.000Z' }),
    ) ?? '',
    /older/,
  );
});
