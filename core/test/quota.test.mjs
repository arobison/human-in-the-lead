import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { main } from '../lib/cli/main.mjs';
import { COMMANDS } from '../lib/cli/table.mjs';
import { inputSchema } from '../lib/cli/args.mjs';
import { windowBounds, windowLengthMs, resetsAtMs } from '../lib/quota/window.mjs';
import {
  effectiveEntries,
  parseSnapshots,
  readingFor,
  ledgerUsage,
  readLedgerEntries,
} from '../lib/quota/usage.mjs';
import { evaluateQuotas } from '../lib/quota/quota.mjs';
import { dispatchGate } from '../lib/quota/gate.mjs';
import { buildReport, renderDigest, renderHtml } from '../lib/quota/report.mjs';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-quota-')));
after(() => rmSync(tmp, { recursive: true, force: true }));

const T0 = Date.parse('2026-11-14T12:00:00Z');
const HOUR = 3_600_000;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** @param {Record<string, any>} [quota] */
const policyWith = (quota = {}) => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'quota-test', key: 'W' },
    quota,
  });
  assert.deepEqual(errors, []);
  return /** @type {Record<string, any>} */ (policy);
};

/** A status-line snapshot: percentages and when each window resets. */
const snap = (
  /** @type {number} */ at,
  /** @type {number} */ five,
  /** @type {number} */ week = 10,
) => ({
  schema_version: 1,
  at: iso(at),
  source: 'claude-code-statusline',
  rate_limits: {
    five_hour: { used_percentage: five, resets_at: Math.floor((T0 + 3 * HOUR) / 1000) },
    seven_day: { used_percentage: week, resets_at: Math.floor((T0 + 3 * 24 * HOUR) / 1000) },
  },
});

const tokenLimit = (/** @type {Record<string, any>} */ over = {}) => ({
  id: 'tok',
  unit: 'tokens',
  window: 'monthly_utc',
  limit: 1000,
  source: 'declared',
  hard: false,
  ...over,
});

/** A ledger entry. */
const entry = (
  /** @type {string} */ id,
  /** @type {number} */ at,
  /** @type {number | null} */ tokens,
  extra = {},
) => ({
  schema_version: 1,
  id,
  event: 'reported',
  at: iso(at),
  tokens,
  ...extra,
});

test('the snapshot schema accepts the status-line form and readings, and refuses the rest', () => {
  const r = schemas();
  assert.deepEqual(r.validateEntity('usage-snapshot', snap(T0, 40)), []);
  assert.deepEqual(
    r.validateEntity('usage-snapshot', {
      schema_version: 1,
      at: iso(T0),
      source: 'copilot-daily',
      readings: [{ limit: 'copilot-credits', used: 1200, resets_at: '2026-12-01T00:00:00Z' }],
    }),
    [],
  );
  assert.ok(r.validateEntity('usage-snapshot', { ...snap(T0, 40), extra: 1 }).length);
  assert.ok(
    r.validateEntity('usage-snapshot', {
      ...snap(T0, 40),
      rate_limits: { five_hour: { used_percentage: 140 } },
    }).length,
  );
});

test('the quota policy: a limit may state a confidence, and forecast_hours has a default', () => {
  const p = policyWith({ limits: [tokenLimit({ confidence: 'low', reserve: 0.2 })] });
  assert.equal(p.quota.forecast_hours, 2);
  assert.equal(p.quota.limits[0].confidence, 'low');
  assert.ok(
    resolvePolicy({
      schema_version: 1,
      project: { id: 'p', key: 'W' },
      quota: { limits: [tokenLimit({ confidence: 'sure' })] },
    }).errors.length,
  );
});

test('windows: fixed lengths, custom periods, the calendar month, and a known reset', () => {
  assert.equal(windowLengthMs('rolling_5h'), 5 * HOUR);
  assert.equal(windowLengthMs('weekly'), 168 * HOUR);
  assert.equal(windowLengthMs('P14D'), 14 * 24 * HOUR);
  assert.equal(windowLengthMs('PT12H'), 12 * HOUR);
  assert.equal(windowLengthMs('monthly_utc'), null);
  assert.deepEqual(windowBounds('monthly_utc', T0), {
    start: Date.parse('2026-11-01T00:00:00Z'),
    end: Date.parse('2026-12-01T00:00:00Z'),
  });
  assert.deepEqual(windowBounds('rolling_5h', T0, { resetsAt: T0 + 2 * HOUR }), {
    start: T0 - 3 * HOUR,
    end: T0 + 2 * HOUR,
  });
  assert.deepEqual(windowBounds('rolling_5h', T0), { start: T0 - 5 * HOUR, end: null });
  assert.equal(resetsAtMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(resetsAtMs('2026-12-01T00:00:00Z'), Date.parse('2026-12-01T00:00:00Z'));
  assert.equal(resetsAtMs('soon'), null);
});

test('snapshot lines: valid ones are read in time order, others are counted and skipped', () => {
  const text = [
    JSON.stringify(snap(T0, 50)),
    'not json',
    JSON.stringify({ schema_version: 1, at: 'later', source: 'x' }),
    JSON.stringify(snap(T0 - HOUR, 30)),
    '',
  ].join('\n');
  const { snapshots, skipped } = parseSnapshots(text);
  assert.equal(skipped, 2);
  assert.deepEqual(
    snapshots.map((s) => s.rate_limits.five_hour.used_percentage),
    [30, 50],
  );
  assert.deepEqual(parseSnapshots(null), { snapshots: [], skipped: 0 });
});

test('a reading comes from a named limit, or from the status-line window that matches', () => {
  const limits = policyWith().quota.limits;
  const five = readingFor(snap(T0, 42), limits[0]);
  assert.equal(five?.used, 42);
  assert.equal(five?.resetsAt, T0 + 3 * HOUR);
  assert.equal(readingFor(snap(T0, 42, 77), limits[1])?.used, 77);
  assert.equal(readingFor(snap(T0, 42), tokenLimit()), null);
  assert.equal(
    readingFor({ ...snap(T0, 1), readings: [{ limit: 'tok', used: 300 }] }, tokenLimit())?.used,
    300,
  );
});

test('the ledger estimates tokens in the window, scoped to models, with corrections replacing', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const entries = [
    entry('E-1', T0 - 2 * HOUR, 100, { model: 'large' }),
    entry('E-2', T0 - HOUR, 50, { model: 'small' }),
    entry('E-3', T0 - HOUR, 80, { model: 'large', item: 'W-3' }),
    entry('E-4', T0 - 30 * 60_000, 60, { model: 'large', item: 'W-3', corrects: 'E-3' }),
    entry('E-5', start - HOUR, 999),
    entry('E-6', T0 - HOUR, null),
    entry('E-7', T0 + HOUR, 5),
  ];
  assert.equal(ledgerUsage(entries, tokenLimit(), { start, now: T0 })?.used, 210);
  assert.equal(
    ledgerUsage(entries, tokenLimit({ scope: { models: ['large'] } }), { start, now: T0 })?.used,
    160,
  );
  assert.equal(ledgerUsage(entries, { unit: 'usd' }, { start, now: T0 }), null);
  const dispatches = [{ ...entry('E-8', T0 - HOUR, null), event: 'dispatched' }];
  assert.equal(ledgerUsage(dispatches, { unit: 'requests' }, { start, now: T0 })?.used, 1);
});

test('the ledger reader is piece (b)\u2019s: valid events only', () => {
  const good = {
    schema_version: 1,
    id: 'E-1',
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    at: iso(T0),
  };
  const store = { read: () => `${JSON.stringify(good)}\n{torn\n[1]\n{"id":"x"}\n` };
  assert.deepEqual(
    readLedgerEntries(store).map((e) => e.id),
    ['E-1'],
  );
});

test('only a finite, non-negative number counts as tokens', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const entries = [
    entry('E-1', T0 - HOUR, 100),
    entry('E-2', T0 - HOUR, -500),
    entry('E-3', T0 - HOUR, Number.POSITIVE_INFINITY),
    entry('E-4', T0 - HOUR, /** @type {any} */ ('999')),
    entry('E-5', T0 - HOUR, Number.NaN),
  ];
  assert.equal(ledgerUsage(entries, tokenLimit(), { start, now: T0 })?.used, 100);
  assert.equal(buildReport({ policy: policyWith(), ledger: entries, now: T0 }).ledger.tokens, 100);
});

test('a correction counts only when it names an earlier entry of the same item or dispatch', () => {
  const a = entry('E-1', T0 - 3 * HOUR, 100, { item: 'W-1', dispatch: 'D-1' });
  const kept = [
    a,
    entry('E-2', T0 - 2 * HOUR, 1, { item: 'W-2', dispatch: 'D-2', corrects: 'E-1' }), // another item
    entry('E-3', T0 - HOUR, 1, { corrects: 'E-1' }), // names neither
    entry('E-4', T0 - HOUR, 1, { item: 'W-9', corrects: 'E-404' }), // names nothing
  ];
  const start = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(ledgerUsage(kept, tokenLimit(), { start, now: T0 })?.used, 103);
  // A correction that comes before its target does not count either.
  const early = [
    entry('E-5', T0 - 2 * HOUR, 7, { item: 'W-1', corrects: 'E-6' }),
    entry('E-6', T0 - HOUR, 50, { item: 'W-1' }),
  ];
  assert.equal(ledgerUsage(early, tokenLimit(), { start, now: T0 })?.used, 57);
  // A real one, by the same dispatch, replaces.
  const ok = [a, entry('E-7', T0 - HOUR, 40, { dispatch: 'D-1', corrects: 'E-1' })];
  assert.equal(ledgerUsage(ok, tokenLimit(), { start, now: T0 })?.used, 40);
});

test('headroom and forecast from snapshots: burn, band, and reserve time', () => {
  // 20% -> 40% over the last hour of a five-hour window that began 2 h ago at 0%: recent 20%/h,
  // window average 40% over 2 h = 20%/h. Add a slower start so the two disagree.
  const snaps = [snap(T0 - 2 * HOUR, 0), snap(T0 - HOUR, 36), snap(T0, 40)];
  const [five] = evaluateQuotas({ policy: policyWith(), snapshots: snaps, now: T0 });
  assert.equal(five.used, 40);
  assert.equal(five.used_from, 'snapshot');
  assert.equal(five.confidence, 'high');
  // 100 - 40 - 25 = 35 above the reserve, of a limit of 100.
  assert.ok(Math.abs((five.headroom ?? 0) - 0.35) < 1e-9);
  const f = five.forecast;
  assert.equal(f.burn_basis, 'recent');
  // Over the smoothing span (2 h) the readings run 0 to 40 over 2 h: 20/h; average since the
  // window began (3 h before reset, 5 h long, so 2 h ago): also 20/h.
  assert.ok(Math.abs((f.burn_per_hour ?? 0) - 20) < 1e-6);
  assert.equal(f.reserve_at, iso(T0 + 1.75 * HOUR));
  assert.equal(f.before_reset, true);
  assert.equal(five.resets_at, iso(T0 + 3 * HOUR));
});

test('the forecast band spans the recent rate and the window average', () => {
  const snaps = [snap(T0 - 2 * HOUR, 5), snap(T0, 40)];
  const [five] = evaluateQuotas({
    policy: policyWith({ forecast_hours: 1 }),
    snapshots: [snap(T0 - 0.5 * HOUR, 10), snap(T0, 40)],
    now: T0,
  });
  assert.equal(five.forecast.burn_basis, 'recent');
  assert.equal(five.forecast.burn_per_hour, 60);
  const [lo, hi] = /** @type {[number, number]} */ (five.forecast.burn_band);
  assert.ok(lo < hi);
  assert.ok(
    Date.parse(/** @type {string} */ (five.forecast.reserve_band?.[0])) <
      Date.parse(/** @type {string} */ (five.forecast.reserve_band?.[1])),
  );
  void snaps;
});

test('a snapshot from a window that has reset is not used, and says so', () => {
  const old = {
    ...snap(T0 - 6 * HOUR, 90),
    rate_limits: { five_hour: { used_percentage: 90, resets_at: Math.floor((T0 - HOUR) / 1000) } },
  };
  const [five] = evaluateQuotas({ policy: policyWith(), snapshots: [old], now: T0 });
  assert.equal(five.used, null);
  assert.equal(five.headroom, null);
  assert.ok(five.notes.some((n) => n.includes('since reset')));
});

test('confidence falls with a reading’s age, and a stated confidence is a ceiling', () => {
  const at = (/** @type {number} */ ageMs) =>
    evaluateQuotas({ policy: policyWith(), snapshots: [snap(T0 - ageMs, 10)], now: T0 })[0];
  assert.equal(at(10 * 60_000).confidence, 'high');
  assert.equal(at(2 * HOUR).confidence, 'medium');
  assert.equal(at(2.9 * HOUR).confidence, 'medium');
  const capped = evaluateQuotas({
    policy: policyWith({
      limits: [
        {
          id: 'c',
          unit: 'plan_percent',
          window: 'rolling_5h',
          limit: 100,
          source: 'measured',
          hard: false,
          confidence: 'low',
        },
      ],
    }),
    snapshots: [snap(T0, 10)],
    now: T0,
  })[0];
  assert.equal(capped.confidence, 'low');
});

test('a declared limit is estimated from the ledger, and a per-limit reserve overrides the policy', () => {
  const policy = policyWith({ owner_reserve: 0.25, limits: [tokenLimit({ reserve: 0.2 })] });
  const ledger = [entry('E-1', T0 - 3 * HOUR, 300), entry('E-2', T0 - HOUR, 100)];
  const [q] = evaluateQuotas({ policy, ledger, now: T0 });
  assert.equal(q.used_from, 'ledger');
  assert.equal(q.used, 400);
  assert.equal(q.reserve, 200);
  assert.equal(q.reserve_share, 0.2);
  assert.ok(Math.abs((q.headroom ?? 0) - 0.4) < 1e-9);
  assert.equal(q.confidence, 'low');
});

test('the gate: normal, economize, critical path only, stop, each with its reason', () => {
  const policy = policyWith({ limits: [tokenLimit()] });
  const run = (/** @type {number} */ used, item = {}) =>
    dispatchGate(policy, [], item, { now: T0, ledger: [entry('E-1', T0 - HOUR, used)] });
  // Headroom = 0.75 - used/1000.
  const normal = run(200);
  assert.equal(normal.mode, 'normal');
  assert.equal(normal.allow, true);
  assert.equal(normal.binding, null);
  const eco = run(400);
  assert.equal(eco.mode, 'economize');
  assert.equal(eco.allow, true);
  assert.deepEqual(eco.economize, { prefer_cheaper_models: true, reduce_concurrency: true });
  assert.match(eco.reason, /^economize: tok: 35% of its limit above the 25% reserve/);
  assert.match(eco.reason, /economize threshold of 40%/);
  assert.equal(eco.binding, 'tok');
  assert.match(String(eco.forecast), /^tok: burning .*reserve reached about/);
  const crit = run(650, { id: 'W-5', critical_path: false });
  assert.equal(crit.mode, 'critical_path_only');
  assert.equal(crit.allow, false);
  assert.match(crit.reason, /W-5 is not on the critical path, so it waits/);
  assert.equal(run(650, { id: 'W-6', critical_path: true }).allow, true);
  assert.equal(run(650).allow, false, 'an item that does not say it is critical is not critical');
  const stop = run(750, { id: 'W-7', critical_path: true });
  assert.equal(stop.mode, 'stop');
  assert.equal(stop.allow, false);
  assert.equal(stop.notify_owner, true);
  assert.equal(stop.ask_owner, false);
  assert.match(
    stop.reason,
    /at the reserve.*in-flight executors finish or checkpoint.*owner is told/,
  );
  assert.match(run(900).reason, /past the reserve/);
});

test('an item whose estimate would cross the reserve is stopped before it starts', () => {
  const policy = policyWith({ limits: [tokenLimit()] });
  const gate = dispatchGate(
    policy,
    [],
    { id: 'W-1', estimate_tokens: 200 },
    {
      now: T0,
      ledger: [entry('E-1', T0 - HOUR, 600)],
    },
  );
  assert.equal(gate.mode, 'stop');
  assert.match(gate.reason, /estimate of 200 tokens would cross the reserve/);
});

test('a hard limit that stops dispatch asks the owner; a soft one does not', () => {
  const ledger = [entry('E-1', T0 - HOUR, 800)];
  const hard = dispatchGate(
    policyWith({ limits: [tokenLimit({ hard: true })] }),
    [],
    {},
    { now: T0, ledger },
  );
  assert.equal(hard.mode, 'stop');
  assert.equal(hard.ask_owner, true);
  assert.match(hard.reason, /hard.*owner's yes/);
  assert.equal(
    dispatchGate(policyWith({ limits: [tokenLimit()] }), [], {}, { now: T0, ledger }).ask_owner,
    false,
  );
});

test('the worst limit binds, and a limit that cannot be read stops dispatch', () => {
  const policy = policyWith(); // the two Claude windows
  const g = dispatchGate(policy, [snap(T0 - 60_000, 20, 72)], { critical_path: true }, { now: T0 });
  // Weekly: 100 - 72 - 25 = 3% headroom: critical path only; five-hour: 55%: normal.
  assert.equal(g.mode, 'critical_path_only');
  assert.equal(g.binding, 'claude-weekly');
  assert.equal(g.allow, true);
  const none = dispatchGate(policy, [], { critical_path: true }, { now: T0 });
  assert.equal(none.mode, 'stop');
  assert.equal(none.allow, false);
  assert.match(none.reason, /unknown or not a number.*dispatch stops until it can be read/);
});

test('the gate follows the owner’s thresholds and reserve', () => {
  const policy = policyWith({
    owner_reserve: 0.1,
    economize_at: 0.2,
    critical_at: 0.05,
    limits: [tokenLimit()],
  });
  const at = (/** @type {number} */ used) =>
    dispatchGate(policy, [], {}, { now: T0, ledger: [entry('E-1', T0 - HOUR, used)] }).mode;
  assert.equal(at(650), 'normal'); // 0.9 - 0.65 = 0.25
  assert.equal(at(750), 'economize'); // 0.15
  assert.equal(at(860), 'critical_path_only'); // 0.04
  assert.equal(at(900), 'stop');
});

test('the report: the digest and page state the gate, forecast and ledger, and the page is self-contained', () => {
  const policy = policyWith({ limits: [tokenLimit()] });
  const ledger = [
    entry('E-1', T0 - 2 * HOUR, 200, { model: 'large', tier: 3, item: 'W-1' }),
    { ...entry('E-2', T0 - HOUR, 200, { model: 'small', tier: 1, item: 'W-1' }), event: 'merged' },
  ];
  const report = buildReport({ policy, ledger, now: T0 });
  assert.equal(report.gate.mode, 'economize');
  assert.equal(report.gate.allow_ordinary, true);
  assert.equal(report.ledger.tokens, 400);
  assert.equal(report.ledger.items_merged, 1);
  assert.equal(report.ledger.tokens_per_merged_item, 400);
  assert.deepEqual(report.thresholds, []);
  const digest = renderDigest(report);
  assert.match(digest, /Dispatch: Economize\./);
  assert.match(digest, /reserve reached about/);
  assert.ok(digest.split('\n').length < 25, 'a phone screen');
  const html = renderHtml(report, policy);
  assert.match(html, /<!doctype html>/);
  assert.doesNotMatch(html, /<script|https?:\/\/|@import|url\(/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /Forecast that triggered it/);
  assert.match(html, /<svg [^>]*aria-label=/);
});

test('threshold lines name the highest notify_at share a quota has passed', () => {
  const policy = policyWith({ limits: [tokenLimit()] });
  const report = buildReport({ policy, ledger: [entry('E-1', T0 - HOUR, 800)], now: T0 });
  assert.deepEqual(report.thresholds, ['tok is past 75% used']);
  assert.match(renderDigest(report), /Threshold: tok is past 75% used\./);
});

// The commands, end to end in a temporary repository with its own private store.

/** A repository with a policy and a private store the test controls. */
function project() {
  const repo = join(tmp, `repo-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(repo, '.human-in-the-lead'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(
    join(repo, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: 'quota-cli', key: 'W' } }),
    { mode: 0o600 },
  );
  const xdg = join(tmp, `xdg-${Math.random().toString(36).slice(2)}`);
  const env = { XDG_DATA_HOME: xdg, XDG_CONFIG_HOME: xdg };
  const store = openStore(privateStorePath('quota-cli', { env }));
  return { repo, env, store };
}

/** @param {string[]} argv @param {{ repo: string, env: Record<string, string> }} p */
async function hitld(argv, p) {
  /** @type {string[]} */
  const out = [];
  const code = await main(argv, {
    out: (t) => out.push(t),
    err: () => {},
    cwd: p.repo,
    env: { ...process.env, ...p.env },
  });
  return { code, json: JSON.parse(out.join('')) };
}

test('hitld quota status reads the store; a snapshot near the reserve limits dispatch', async () => {
  const p = project();
  p.store.append('usage/snapshots.jsonl', `${JSON.stringify(snap(T0 - 60_000, 70))}\nbroken\n`);
  const status = await hitld(['quota', 'status', '--now', iso(T0)], p);
  assert.equal(status.code, 0);
  assert.equal(status.json.skipped_snapshots, 1);
  // 100 - 70 - 25 = 5% above the reserve: below the critical threshold.
  assert.equal(status.json.mode, 'critical_path_only');
  assert.equal(status.json.allow, false);
  assert.equal(status.json.binding, 'claude-five-hour');
  const critical = await hitld(['quota', 'status', '--critical', '--now', iso(T0)], p);
  assert.equal(critical.json.allow, true);
  const bad = await hitld(['quota', 'status', '--now', 'tomorrow-ish'], p);
  assert.equal(bad.json.error, 'usage');
});

test('hitld report writes report.html and digest.txt, and --json gives the data', async () => {
  const p = project();
  p.store.append('usage/snapshots.jsonl', `${JSON.stringify(snap(T0 - 60_000, 80))}\n`);
  const out = join(p.repo, 'out');
  const r = await hitld(['report', '--out', 'out', '--json', '--now', iso(T0)], p);
  assert.equal(r.code, 0);
  assert.equal(r.json.mode, 'stop');
  assert.equal(r.json.report.metrics_schema_version, 1);
  assert.ok(existsSync(join(out, 'report.html')));
  assert.match(readFileSync(join(out, 'digest.txt'), 'utf8'), /Dispatch: Stopped at the reserve\./);
  // Without --out the report goes under the private store, not the repository.
  const d = await hitld(['report', '--now', iso(T0)], p);
  assert.equal(d.json.html, join(p.store.root, 'reports', 'report.html'));
  assert.ok(existsSync(d.json.html));
  assert.equal(d.json.report, undefined);
  assert.equal(dirname(d.json.html).startsWith(p.repo), false);
});

test('the gate fails closed on a quota whose figures are not finite numbers', () => {
  // Unknown limit, so no headroom can be computed.
  const noLimit = dispatchGate(
    policyWith({ limits: [tokenLimit({ limit: null })] }),
    [],
    { critical_path: true },
    { now: T0, ledger: [entry('E-1', T0 - HOUR, 1)] },
  );
  assert.equal(noLimit.mode, 'stop');
  assert.match(noLimit.reason, /tok: its use, limit or headroom is unknown/);
});

test('hitld report --out stays inside the repository or the private store, and never overwrites others\u2019 files', async () => {
  const p = project();
  const args = (/** @type {string} */ out) => ['report', '--out', out, '--now', iso(T0)];
  const outside = join(tmp, `outside-${Math.random().toString(36).slice(2)}`);
  const refused = await hitld(args(outside), p);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'output_path');
  assert.equal(existsSync(outside), false);
  assert.equal((await hitld(args('../escape'), p)).json.error, 'output_path');
  // A symlink out of the repository does not smuggle the write out.
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(p.repo, 'link'));
  assert.equal((await hitld(args('link/sub'), p)).json.error, 'output_path');
  assert.equal(existsSync(join(outside, 'sub')), false);
  // Inside the repository is fine, repeatedly (the report made its own files).
  assert.equal((await hitld(args('out'), p)).code, 0);
  assert.equal((await hitld(args('out'), p)).code, 0);
  // A file the report did not create is not overwritten.
  mkdirSync(join(p.repo, 'docs'));
  writeFileSync(join(p.repo, 'docs', 'report.html'), 'mine');
  const clash = await hitld(args('docs'), p);
  assert.equal(clash.json.error, 'output_path');
  assert.equal(readFileSync(join(p.repo, 'docs', 'report.html'), 'utf8'), 'mine');
  // Nor one reached through a symlink.
  mkdirSync(join(p.repo, 'tricky'));
  writeFileSync(join(outside, 'target'), 'keep');
  symlinkSync(join(outside, 'target'), join(p.repo, 'tricky', 'report.html'));
  assert.equal((await hitld(args('tricky'), p)).json.error, 'output_path');
  assert.equal(readFileSync(join(outside, 'target'), 'utf8'), 'keep');
  // The private store is allowed.
  assert.equal((await hitld(args(join(p.store.root, 'mine')), p)).code, 0);
});

test('--out is a command-line option only: the MCP input schema leaves it out', () => {
  const cmd = COMMANDS.find((c) => c.name === 'report');
  const schema = inputSchema(cmd?.args ?? []);
  assert.equal('out' in schema.properties, false);
  assert.ok('json' in schema.properties);
});

test('a duplicate entry ID is dropped and can neither hide nor be hidden in place of another', () => {
  const entries = [
    { id: 'E-1', item: 'W-1', event: 'reported', tokens: 100 },
    { id: 'E-1', item: 'W-2', event: 'reported', tokens: 5 },
    { id: 'E-2', item: 'W-2', event: 'reported', tokens: 7, corrects: 'E-1' },
  ];
  const kept = effectiveEntries(entries);
  // E-2 is about W-2, the first E-1 about W-1: no valid correction; the duplicate E-1 is dropped.
  assert.deepEqual(
    kept.map((e) => [e.id, e.item]),
    [
      ['E-1', 'W-1'],
      ['E-2', 'W-2'],
    ],
  );
});
