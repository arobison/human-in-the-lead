import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { COMMANDS } from '../lib/cli/table.mjs';
import { inputSchema } from '../lib/cli/args.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { acceptCommand, changesAgainst, renderEvalReport } from '../lib/eval/report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'hitld-eval-report-test-'));

/** @param {Record<string, any>} o */
const scenario = (o) => ({
  piece: 't',
  category: 'schema',
  profile: 'none',
  status: 'pass',
  score: 1,
  graders: [{ id: 'equals-1', grader: 'equals', passed: true, message: 'ok' }],
  wall_ms: 3,
  tokens: null,
  transcript: null,
  ...o,
});

/**
 * A valid stored run.
 * @param {Record<string, any>[]} scenarios @param {Record<string, any>} [over]
 */
function run(scenarios, over = {}) {
  const count = (/** @type {string} */ s) => scenarios.filter((x) => x.status === s).length;
  /** @type {Record<string, { sum: number, n: number }>} */
  const cats = {};
  for (const s of scenarios) {
    if (s.status === 'not_applicable') continue;
    (cats[s.category] ??= { sum: 0, n: 0 }).sum += s.score;
    cats[s.category].n++;
  }
  const doc = {
    schema_version: 1,
    id: 'EV-20261114T031500Z-abcdef',
    at: '2026-11-14T03:15:00.000Z',
    mode: 'offline',
    plugin: { name: 'human-in-the-lead', version: '0.0.0', commit: 'a'.repeat(40) },
    schema_versions: {},
    harness: { adapter: 'fake', profiles: ['none'] },
    policy_hash: null,
    policy_source: 'defaults',
    settings: { seed: 7, profiles: ['none'], scenario_filter: null, settings_hash: 'abcdef012345' },
    scenario_set: { version: '0123456789ab', count: scenarios.length },
    scenarios,
    summary: {
      total: scenarios.length,
      passed: count('pass'),
      failed: count('fail'),
      errors: count('error'),
      not_applicable: count('not_applicable'),
      tokens: 0,
      wall_ms: 0,
      categories: Object.fromEntries(
        Object.entries(cats).map(([k, v]) => [k, { score: v.sum / v.n, scenarios: v.n }]),
      ),
    },
    ...over,
  };
  return doc;
}

const noBaselineGate = { ok: true, baseline: null, failures: [], notes: [] };

test('the fixture runs used here are valid eval results', () => {
  const doc = run([scenario({ id: 't/a' })], { gate: noBaselineGate });
  assert.deepEqual(schemas().validateEntity('eval-result', doc), []);
});

test('no baseline: the page says there is nothing to compare with, and gives the accept command', () => {
  const html = renderEvalReport(run([scenario({ id: 't/a' })], { gate: noBaselineGate }), null);
  assert.match(html, /Gate passed/);
  assert.match(html, /No baseline yet/);
  assert.match(html, /Nothing to compare with/);
  assert.match(html, /<pre tabindex="0">hitld eval accept --run EV-20261114T031500Z-abcdef<\/pre>/);
  assert.doesNotMatch(html, /--accept-baseline|run the suite again/i);
  assert.doesNotMatch(html, /<script|https?:\/\//i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /name="viewport"/);
});

test('a failed gate names the baseline and its failures, and no accept command is given for a failing run', () => {
  const base = run([scenario({ id: 't/a' }), scenario({ id: 't/b' })], {
    id: 'EV-20261101T000000Z-abcdef',
  });
  const cur = run(
    [
      scenario({ id: 't/a' }),
      scenario({
        id: 't/b',
        status: 'fail',
        score: 0,
        graders: [
          { id: 'equals-1', grader: 'equals', passed: false, message: 'steps.v.valid was false' },
        ],
      }),
    ],
    {
      gate: {
        ok: false,
        baseline: base.id,
        failures: [
          { kind: 'scenario-regressed', subject: 't/b@none', message: 't/b@none now fails' },
        ],
        notes: [],
      },
    },
  );
  const html = renderEvalReport(cur, base);
  assert.match(html, /Gate failed/);
  assert.match(html, new RegExp(`Compared with baseline ${base.id}`));
  assert.match(html, /scenario-regressed/);
  assert.match(html, /No accept command for this run/);
  assert.doesNotMatch(html, /--accept-baseline/);
});

test('changes against the baseline: new failures, fixed, removed, new, not applicable and score changes', () => {
  const base = run([
    scenario({ id: 't/regress' }),
    scenario({ id: 't/fixed', status: 'fail', score: 0 }),
    scenario({ id: 't/gone' }),
    scenario({ id: 't/same' }),
    scenario({ id: 't/na' }),
  ]);
  const cur = run([
    scenario({ id: 't/regress', status: 'error', score: 0 }),
    scenario({ id: 't/fixed' }),
    scenario({ id: 't/same' }),
    scenario({ id: 't/new' }),
    scenario({ id: 't/newbad', status: 'fail', score: 0 }),
    scenario({ id: 't/na', status: 'not_applicable', score: null }),
  ]);
  const c = /** @type {NonNullable<ReturnType<typeof changesAgainst>>} */ (
    changesAgainst(cur, base)
  );
  assert.deepEqual(c.newFailures.map((x) => x.id).sort(), ['t/newbad', 't/regress']);
  assert.deepEqual(
    c.fixed.map((x) => x.id),
    ['t/fixed'],
  );
  assert.deepEqual(
    c.removed.map((x) => x.id),
    ['t/gone'],
  );
  assert.deepEqual(
    c.added.map((x) => x.id),
    ['t/new'],
  );
  assert.deepEqual(
    c.notApplicable.map((x) => x.id),
    ['t/na'],
  );
  assert.equal(c.scores.length, 1);
  assert.equal(changesAgainst(cur, null), null);
  // A partial run says the missing scenarios were not run, not that they were removed.
  const partial = run([scenario({ id: 't/same' })], {
    settings: {
      seed: 7,
      profiles: ['none'],
      scenario_filter: 't/same',
      settings_hash: 'abcdef012345',
    },
  });
  const pc = /** @type {any} */ (changesAgainst(partial, base));
  assert.ok(pc.removed.every((/** @type {any} */ x) => /not run/.test(x.note)));
  assert.match(renderEvalReport(cur, base), /Removed scenarios <span class="count">1<\/span>/);
});

test('failures come first, and not applicable is shown as not applicable, never as a pass', () => {
  const html = renderEvalReport(
    run([
      scenario({ id: 't/a-pass' }),
      scenario({
        id: 't/b-na',
        status: 'not_applicable',
        score: null,
        graders: [],
        reason: 'needs a model',
      }),
      scenario({ id: 't/c-fail', status: 'fail', score: 0 }),
      scenario({ id: 't/d-error', status: 'error', score: 0, reason: 'the runner failed: boom' }),
    ]),
    null,
  );
  const at = (/** @type {string} */ id) => html.indexOf(`<span class="sid">${id}</span>`);
  assert.ok(at('t/d-error') < at('t/c-fail'));
  assert.ok(at('t/c-fail') < at('t/a-pass'));
  assert.ok(at('t/a-pass') < at('t/b-na'));
  const na = html.slice(at('t/b-na'), html.indexOf('</details>', at('t/b-na')));
  assert.match(na, /Not applicable/);
  assert.match(na, /needs a model/);
  assert.doesNotMatch(na, /badge pass/);
  // Failing rows start open; passing and not applicable ones start closed.
  assert.match(html, /<details class="scenario fail" open>/);
  assert.match(html, /<details class="scenario pass">/);
  assert.match(html, /<details class="scenario not_applicable">/);
  // Counts show not applicable separately.
  assert.match(html, /<b>1<\/b><span>Not applicable<\/span>/);
  assert.match(html, /<b>1<\/b><span>Pass<\/span>/);
});

test('every value from the run is escaped: nothing becomes markup, a URL or script', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const doc = run(
    [
      scenario({
        id: `t/${evil}`,
        category: evil,
        profile: evil,
        status: 'fail',
        score: 0,
        reason: evil,
        transcript: evil,
        graders: [
          {
            id: evil,
            grader: evil,
            passed: false,
            message: evil,
            path: evil,
            expected: evil,
            actual: { a: evil },
          },
        ],
      }),
    ],
    {
      id: 'EV-20261114T031500Z-abcdef',
      plugin: { name: evil, version: evil, commit: evil },
      harness: { adapter: 'fake', profiles: [evil] },
      policy_hash: evil,
      gate: {
        ok: false,
        baseline: evil,
        failures: [{ kind: 'scenario-regressed', subject: evil, message: evil }],
        notes: [evil],
      },
    },
  );
  const html = renderEvalReport(doc, null);
  // Outside the style block, every tag and attribute is one the renderer wrote itself.
  const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
  const tags = new Set([
    'html',
    'head',
    'meta',
    'title',
    'body',
    'main',
    'h1',
    'h2',
    'h3',
    'h4',
    'div',
    'span',
    'section',
    'strong',
    'small',
    'code',
    'pre',
    'p',
    'ul',
    'li',
    'dl',
    'dt',
    'dd',
    'b',
    'i',
    'br',
    'details',
    'summary',
  ]);
  for (const m of body.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
    if (m[2] === '!doctype' || m[1]) continue;
    assert.ok(tags.has(m[2].toLowerCase()), `unexpected tag ${m[2]}`);
    for (const a of m[3].replace(/"[^"]*"/g, '""').matchAll(/\s([a-z-]+)=/gi)) {
      assert.ok(
        [
          'class',
          'lang',
          'charset',
          'name',
          'content',
          'id',
          'role',
          'aria-label',
          'aria-labelledby',
          'style',
          'tabindex',
          'open',
        ].includes(a[1]),
        `unexpected attribute ${a[1]}`,
      );
    }
  }
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  for (const m of html.matchAll(/style="([^"]*)"/g)) assert.match(m[1], /^width:[0-9.]+%$/);
});

test('acceptCommand: only a full, passing, offline run that is not already the baseline', () => {
  const ok = run([scenario({ id: 't/a' })], { gate: noBaselineGate });
  assert.equal(acceptCommand(ok, null).command, `hitld eval accept --run ${ok.id}`);
  assert.match(acceptCommand(run([scenario({ id: 't/a' })]), null).reason ?? '', /no gate verdict/);
  assert.match(
    acceptCommand(run([scenario({ id: 't/a' })], { gate: { ...noBaselineGate, ok: false } }), null)
      .reason ?? '',
    /failed the regression gate/,
  );
  assert.match(acceptCommand(ok, ok).reason ?? '', /already the baseline/);
  assert.match(
    acceptCommand(
      run([scenario({ id: 't/a' })], {
        settings: {
          seed: 7,
          profiles: ['none'],
          scenario_filter: 't/',
          settings_hash: 'abcdef012345',
        },
      }),
      null,
    ).reason ?? '',
    /only some scenarios/,
  );
  assert.match(
    acceptCommand(run([scenario({ id: 't/a', status: 'error', score: 0 })]), null).reason ?? '',
    /failing/,
  );
  assert.match(
    acceptCommand(run([scenario({ id: 't/a' })], { mode: 'live' }), null).reason ?? '',
    /live/,
  );
});

// The command line.

/** A directory with one scenario and its own private store. */
function workspace() {
  const cwd = tmp();
  const dir = join(cwd, 'evals', 'scenarios', 't');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'a.scenario.json'),
    JSON.stringify({
      schema_version: 1,
      id: 't/a',
      piece: 't',
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
      graders: [{ grader: 'equals', with: { path: 'steps.v.valid', value: true } }],
    }),
  );
  const env = { XDG_DATA_HOME: tmp() };
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    /** @type {string[]} */
    const out = [];
    const code = await main(argv, { out: (t) => out.push(t), err: () => {}, cwd, env });
    return { code, json: JSON.parse(out.join('') || 'null') };
  };
  return { cwd, env, hitld };
}

test('hitld eval report renders the latest stored run into reports/ in the private store', async () => {
  const w = workspace();
  assert.equal((await w.hitld(['eval', 'report'])).json.error, 'no_run');
  const ran = await w.hitld(['eval', '--offline', '--evals-dir', 'evals']);
  assert.equal(ran.code, 0);
  const r = await w.hitld(['eval', 'report']);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.run, ran.json.run);
  assert.equal(
    r.json.html,
    join(
      realpathSync(w.env.XDG_DATA_HOME),
      'human-in-the-lead',
      'hitld-evals',
      'reports',
      `eval-${ran.json.run}.html`,
    ),
  );
  assert.equal(r.json.text.trim(), r.json.html);
  const html = readFileSync(r.json.html, 'utf8');
  assert.match(html, new RegExp(`Eval run ${ran.json.run}`));
  assert.match(html, /t\/a/);
  // It can name the run, and refuses one that is not stored or is not an ID.
  assert.equal((await w.hitld(['eval', 'report', '--run', ran.json.run])).code, 0);
  assert.equal(
    (await w.hitld(['eval', 'report', '--run', 'EV-20000101T000000Z-000000'])).json.error,
    'no_run',
  );
  assert.equal(
    (await w.hitld(['eval', 'report', '--run', '../../etc/passwd'])).json.error,
    'no_run',
  );
});

test('hitld eval report shows the baseline once one is accepted, and the run is then the baseline', async () => {
  const w = workspace();
  await w.hitld(['eval', '--offline', '--evals-dir', 'evals', '--accept-baseline']);
  const r = await w.hitld(['eval', 'report']);
  const html = readFileSync(r.json.html, 'utf8');
  assert.match(html, /already the baseline/);
  assert.match(html, /Compared with baseline|No baseline yet/);
});

test('hitld eval report --out stays inside the repository or the private store, and never overwrites others’ files', async () => {
  const w = workspace();
  const ran = await w.hitld(['eval', '--offline', '--evals-dir', 'evals']);
  const file = `eval-${ran.json.run}.html`;
  const args = (/** @type {string} */ out) => ['eval', 'report', '--out', out];
  const outside = join(tmp(), 'outside');
  const refused = await w.hitld(args(outside));
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'output_path');
  assert.equal(existsSync(outside), false);
  assert.equal((await w.hitld(args('../escape'))).json.error, 'output_path');
  // A symlink out of the repository does not smuggle the write out.
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(w.cwd, 'link'));
  assert.equal((await w.hitld(args('link/sub'))).json.error, 'output_path');
  assert.equal(existsSync(join(outside, 'sub')), false);
  // Inside the repository is fine, repeatedly.
  assert.equal((await w.hitld(args('out'))).code, 0);
  assert.equal((await w.hitld(args('out'))).code, 0);
  assert.ok(existsSync(join(w.cwd, 'out', file)));
  // A file it did not create is not overwritten.
  mkdirSync(join(w.cwd, 'docs'));
  writeFileSync(join(w.cwd, 'docs', file), 'mine');
  assert.equal((await w.hitld(args('docs'))).json.error, 'output_path');
  assert.equal(readFileSync(join(w.cwd, 'docs', file), 'utf8'), 'mine');
  // Nor one reached through a symlink.
  mkdirSync(join(w.cwd, 'tricky'));
  writeFileSync(join(outside, 'target'), 'keep');
  symlinkSync(join(outside, 'target'), join(w.cwd, 'tricky', file));
  assert.equal((await w.hitld(args('tricky'))).json.error, 'output_path');
  assert.equal(readFileSync(join(outside, 'target'), 'utf8'), 'keep');
  // The private store is allowed, and so is sharing reports/ with `hitld report`.
  assert.equal(
    (await w.hitld(args(join(w.env.XDG_DATA_HOME, 'human-in-the-lead', 'hitld-evals', 'mine'))))
      .code,
    0,
  );
});

test('eval report is a command with --run, and --out is a command-line option only', () => {
  const cmd = COMMANDS.find((c) => c.name === 'eval report');
  assert.ok(cmd?.run);
  const schema = inputSchema(cmd.args ?? []);
  assert.ok('run' in schema.properties);
  assert.equal('out' in schema.properties, false);
  // The plain eval command is unchanged.
  assert.ok(COMMANDS.find((c) => c.name === 'eval'));
});
