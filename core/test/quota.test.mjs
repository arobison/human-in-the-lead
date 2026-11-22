import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
import { FIVE_HOUR_LIMIT, evaluateQuotas, shownLimits } from '../lib/quota/quota.mjs';
import { dispatchGate } from '../lib/quota/gate.mjs';
import { buildReport, renderDigest, renderHtml } from '../lib/quota/report.mjs';
import { tempDir } from './helpers/tmp.mjs';
import { makeConsumer } from './orchestrator-fixture.mjs';

const tmp = realpathSync.native(tempDir('hitld-quota-'));

/**
 * Whether this machine lets the tests make a symbolic link to a file. Windows refuses one without
 * Developer Mode or elevation (a directory link is made as a junction there, which needs neither).
 */
const canLinkFiles = (() => {
  const target = join(tmp, 'link-probe-target');
  writeFileSync(target, '');
  try {
    symlinkSync(target, join(tmp, 'link-probe'));
    rmSync(join(tmp, 'link-probe'));
    return true;
  } catch {
    return false;
  }
})();
after(() => rmSync(tmp, { recursive: true, force: true }));

const T0 = Date.parse('2026-11-14T12:00:00Z');
const HOUR = 3_600_000;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/**
 * The reserve these tests' arithmetic is written against: a quarter, so the bands sit apart. The
 * package default (0.10, HITLD-799) is checked in policy.test.mjs and by the commands below,
 * whose policy sets no reserve.
 */
const RESERVE = 0.25;

/** @param {Record<string, any>} [quota] */
const policyWith = (quota = {}) => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'quota-test', key: 'W' },
    quota: { reserve: RESERVE, ...quota },
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
  const [weekly] = policyWith().quota.limits;
  const five = readingFor(snap(T0, 42), FIVE_HOUR_LIMIT);
  assert.equal(five?.used, 42);
  assert.equal(five?.resetsAt, T0 + 3 * HOUR);
  assert.equal(readingFor(snap(T0, 42, 77), weekly)?.used, 77);
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

/** The five-hour limit's state among evaluated quotas. @param {any[]} states */
const fiveOf = (states) => {
  const s = states.find((q) => q.id === 'claude-five-hour');
  assert.ok(s, 'the five-hour limit is evaluated');
  return s;
};

test('headroom and forecast from snapshots: burn, band, and reserve time', () => {
  // 20% -> 40% over the last hour of a five-hour window that began 2 h ago at 0%: recent 20%/h,
  // window average 40% over 2 h = 20%/h. Add a slower start so the two disagree.
  const snaps = [snap(T0 - 2 * HOUR, 0), snap(T0 - HOUR, 36), snap(T0, 40)];
  const five = fiveOf(evaluateQuotas({ policy: policyWith(), snapshots: snaps, now: T0 }));
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
  // The data contract names it reserve_before_reset (HITLD-691); the digest and the page still say it.
  const report = buildReport({ policy: policyWith(), snapshots: snaps, now: T0 });
  const inReport = fiveOf(report.quotas).forecast;
  assert.equal(inReport.reserve_before_reset, true);
  assert.equal('before_reset' in inReport, false);
  assert.match(renderDigest(report), /claude-five-hour: burning .*, before the window resets/);
  assert.match(renderHtml(report), /<small>before the window resets/);
});

test('the forecast band spans the recent rate and the window average', () => {
  const snaps = [snap(T0 - 2 * HOUR, 5), snap(T0, 40)];
  const five = fiveOf(
    evaluateQuotas({
      policy: policyWith({ forecast_hours: 1 }),
      snapshots: [snap(T0 - 0.5 * HOUR, 10), snap(T0, 40)],
      now: T0,
    }),
  );
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
  // A declared five-hour limit keeps its stale reading out.
  const policy = policyWith({ limits: [FIVE_HOUR_LIMIT] });
  const [five] = evaluateQuotas({ policy, snapshots: [old], now: T0 });
  assert.equal(five.used, null);
  assert.equal(five.headroom, null);
  assert.ok(five.notes.some((n) => n.includes('since reset')));
  // By default the window has reset, so the account no longer shows it and nothing is added.
  assert.deepEqual(
    evaluateQuotas({ policy: policyWith(), snapshots: [old], now: T0 }).map((q) => q.id),
    ['claude-weekly'],
  );
});

test('the five-hour limit is added only while the account shows that window', () => {
  const declared = policyWith().quota.limits;
  const ids = (/** @type {Record<string, any>[]} */ snaps, limits = declared) =>
    shownLimits(limits, snaps, T0).map((l) => l.id);
  // A plan with a five-hour window: the latest status-line snapshot reports one that has not reset.
  assert.deepEqual(ids([snap(T0 - 60_000, 30)]), ['claude-weekly', 'claude-five-hour']);
  // A plan with only a weekly window: nothing is added.
  const weeklyOnly = (/** @type {number} */ at) => {
    const s = snap(at, 0, 30);
    return { ...s, rate_limits: { seven_day: s.rate_limits.seven_day } };
  };
  assert.deepEqual(ids([weeklyOnly(T0 - 60_000)]), ['claude-weekly']);
  // Only the latest status-line snapshot counts: Claude Code drops a window once it resets.
  assert.deepEqual(ids([snap(T0 - HOUR, 30), weeklyOnly(T0 - 60_000)]), ['claude-weekly']);
  assert.deepEqual(ids([weeklyOnly(T0 - HOUR), snap(T0 - 60_000, 30)]), [
    'claude-weekly',
    'claude-five-hour',
  ]);
  // A snapshot from the future, another account's, or one with readings only does not count.
  assert.deepEqual(ids([snap(T0 + HOUR, 30)]), ['claude-weekly']);
  assert.deepEqual(ids([{ ...snap(T0 - 60_000, 30), account: 'work' }]), ['claude-weekly']);
  assert.deepEqual(
    ids([
      snap(T0 - HOUR, 30),
      { schema_version: 1, at: iso(T0), source: 'copilot-daily', readings: [] },
    ]),
    ['claude-weekly', 'claude-five-hour'],
  );
  // No snapshot at all: nothing is added.
  assert.deepEqual(ids([]), ['claude-weekly']);
  // A declared limit on the rolling_5h window wins, under any id.
  const own = { ...FIVE_HOUR_LIMIT, id: 'my-session', limit: 80 };
  assert.deepEqual(ids([snap(T0 - 60_000, 30)], [...declared, own]), [
    'claude-weekly',
    'my-session',
  ]);
  // The added limit says why it is there.
  const states = evaluateQuotas({
    policy: policyWith(),
    snapshots: [snap(T0 - 60_000, 30)],
    now: T0,
  });
  assert.ok(
    fiveOf(states).notes.some((/** @type {string} */ n) =>
      n.includes('reports a five-hour window'),
    ),
  );
});

test('a subscription with only a weekly window gates dispatch on it', () => {
  const weekly = (/** @type {number} */ used) => {
    const s = snap(T0 - 60_000, 0, used);
    return { ...s, rate_limits: { seven_day: s.rate_limits.seven_day } };
  };
  const ok = dispatchGate(policyWith(), [weekly(30)], {}, { now: T0 });
  assert.equal(ok.mode, 'normal');
  assert.deepEqual(ok.unread, []);
  assert.deepEqual(
    ok.quotas.map((q) => q.id),
    ['claude-weekly'],
  );
  const stop = dispatchGate(policyWith(), [weekly(80)], {}, { now: T0 });
  assert.equal(stop.mode, 'stop');
  assert.equal(stop.binding, 'claude-weekly');
  assert.equal(stop.resets_at, iso(T0 + 3 * 24 * HOUR));
  // With no reading at all the weekly limit stops dispatch, and no five-hour limit is asked for.
  const none = dispatchGate(policyWith(), [], {}, { now: T0 });
  assert.equal(none.mode, 'stop');
  assert.deepEqual(
    none.quotas.map((q) => q.id),
    ['claude-weekly'],
  );
});

test('confidence falls with a reading’s age, and a stated confidence is a ceiling', () => {
  const at = (/** @type {number} */ ageMs) =>
    fiveOf(evaluateQuotas({ policy: policyWith(), snapshots: [snap(T0 - ageMs, 10)], now: T0 }));
  assert.equal(at(10 * 60_000).confidence, 'high');
  assert.equal(at(2 * HOUR).confidence, 'medium');
  assert.equal(at(2.9 * HOUR).confidence, 'medium');
  const capped = evaluateQuotas({
    policy: policyWith({
      limits: [
        {
          id: 'c',
          unit: 'plan-percent',
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
  const policy = policyWith({ reserve: 0.25, limits: [tokenLimit({ reserve: 0.2 })] });
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
    reserve: 0.1,
    economize_below: 0.2,
    critical_below: 0.05,
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
  const html = renderHtml(report);
  assert.match(html, /<!doctype html>/);
  assert.doesNotMatch(html, /<script|https?:\/\/|@import|url\(/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /Forecast that triggered it/);
  assert.match(html, /<svg [^>]*aria-label=/);
});

test('threshold lines name the highest notify_used share a quota has passed', () => {
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
  p.store.append('usage/snapshots.jsonl', `${JSON.stringify(snap(T0 - 60_000, 80))}\nbroken\n`);
  const status = await hitld(['quota', 'status', '--now', iso(T0)], p);
  assert.equal(status.code, 0);
  assert.equal(status.json.skipped_snapshots, 1);
  // The policy sets no reserve, so the package default applies (0.10, HITLD-799):
  // 100 - 80 - 10 = 10% above the reserve: below the critical threshold.
  assert.equal(status.json.mode, 'critical_path_only');
  assert.equal(status.json.allow, false);
  assert.equal(status.json.binding, 'claude-five-hour');
  const critical = await hitld(['quota', 'status', '--critical-path', '--now', iso(T0)], p);
  assert.equal(critical.json.allow, true);
  const bad = await hitld(['quota', 'status', '--now', 'tomorrow-ish'], p);
  assert.equal(bad.json.error, 'usage');
});

test('hitld dashboard writes dashboard.html and digest.txt, and --json gives the data', async () => {
  const p = project();
  // 92% used is past the default reserve of 10% (HITLD-799).
  p.store.append('usage/snapshots.jsonl', `${JSON.stringify(snap(T0 - 60_000, 92))}\n`);
  const out = join(p.repo, 'out');
  const r = await hitld(['dashboard', '--out', 'out', '--json', '--now', iso(T0)], p);
  assert.equal(r.code, 0);
  assert.equal(r.json.mode, 'stop');
  assert.equal(r.json.report.api_version, 2);
  assert.equal(r.json.report.metrics_schema_version, 2);
  assert.deepEqual(schemas().validate('dashboard-data', r.json.report), []);
  assert.ok(existsSync(join(out, 'dashboard.html')));
  assert.match(readFileSync(join(out, 'digest.txt'), 'utf8'), /Dispatch: Stopped at the reserve\./);
  // Without --out the report goes under the private store, not the repository.
  const d = await hitld(['dashboard', '--now', iso(T0)], p);
  assert.equal(d.json.html, join(p.store.root, 'reports', 'dashboard.html'));
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

test('hitld dashboard --out stays inside the repository or the private store, and never overwrites others\u2019 files', async () => {
  const p = project();
  const args = (/** @type {string} */ out) => ['dashboard', '--out', out, '--now', iso(T0)];
  const outside = join(tmp, `outside-${Math.random().toString(36).slice(2)}`);
  const refused = await hitld(args(outside), p);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'output-path');
  assert.equal(existsSync(outside), false);
  assert.equal((await hitld(args('../escape'), p)).json.error, 'output-path');
  // A symlink out of the repository does not smuggle the write out.
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(p.repo, 'link'), 'junction'); // a plain directory link off Windows
  assert.equal((await hitld(args('link/sub'), p)).json.error, 'output-path');
  assert.equal(existsSync(join(outside, 'sub')), false);
  // Inside the repository is fine, repeatedly (the report made its own files).
  assert.equal((await hitld(args('out'), p)).code, 0);
  assert.equal((await hitld(args('out'), p)).code, 0);
  // A file the report did not create is not overwritten.
  mkdirSync(join(p.repo, 'docs'));
  writeFileSync(join(p.repo, 'docs', 'dashboard.html'), 'mine');
  const clash = await hitld(args('docs'), p);
  assert.equal(clash.json.error, 'output-path');
  assert.equal(readFileSync(join(p.repo, 'docs', 'dashboard.html'), 'utf8'), 'mine');
  // Nor one reached through a symlink (where this machine lets the test make a file link).
  if (canLinkFiles) {
    mkdirSync(join(p.repo, 'tricky'));
    writeFileSync(join(outside, 'target'), 'keep');
    symlinkSync(join(outside, 'target'), join(p.repo, 'tricky', 'dashboard.html'));
    assert.equal((await hitld(args('tricky'), p)).json.error, 'output-path');
    assert.equal(readFileSync(join(outside, 'target'), 'utf8'), 'keep');
  }
  // The private store is allowed.
  assert.equal((await hitld(args(join(p.store.root, 'mine')), p)).code, 0);
});

test('a directory written under report.html is accepted, and the old page is replaced by dashboard.html', async () => {
  const p = project();
  const dir = join(p.repo, 'old');
  mkdirSync(dir);
  writeFileSync(join(dir, 'report.html'), 'the page before the rename');
  writeFileSync(join(dir, 'digest.txt'), 'the digest before the rename');
  writeFileSync(
    join(dir, '.hitld-report.json'),
    `${JSON.stringify({ files: ['report.html', 'digest.txt'] })}\n`,
  );
  const r = await hitld(['dashboard', '--out', 'old', '--now', iso(T0)], p);
  assert.equal(r.code, 0);
  assert.equal(r.json.html, join(realpathSync.native(dir), 'dashboard.html'));
  assert.ok(existsSync(join(dir, 'dashboard.html')));
  assert.match(readFileSync(join(dir, 'digest.txt'), 'utf8'), /Dispatch: Stopped at the reserve\./);
  // The old page is removed, and the marker lists the new names only.
  assert.equal(existsSync(join(dir, 'report.html')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.hitld-report.json'), 'utf8')).files, [
    'digest.txt',
    'dashboard.html',
  ]);
  // A report.html the marker does not list is someone else's and stays.
  const other = join(p.repo, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'report.html'), 'mine');
  assert.equal((await hitld(['dashboard', '--out', 'other', '--now', iso(T0)], p)).code, 0);
  assert.equal(readFileSync(join(other, 'report.html'), 'utf8'), 'mine');
});

test('--out is a command-line option only: the MCP input schema leaves it out', () => {
  const cmd = COMMANDS.find((c) => c.name === 'dashboard');
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

test('hitld dashboard --no-write returns the data contract and writes no files', async () => {
  const p = project();
  p.store.append('usage/snapshots.jsonl', `${JSON.stringify(snap(T0 - 60_000, 80))}\n`);
  const out = join(p.repo, 'nowrite');
  const r = await hitld(['dashboard', '--out', 'nowrite', '--no-write', '--now', iso(T0)], p);
  assert.equal(r.code, 0);
  assert.equal(r.json.report.api_version, 2);
  assert.deepEqual(schemas().validate('dashboard-data', r.json.report), []);
  assert.equal(existsSync(out), false);
  assert.equal(r.json.html, undefined);
  assert.equal(existsSync(join(p.store.root, 'reports', 'dashboard.html')), false);
});

// A usage figure the owner declares (HITLD-149, HITLD-164, HITLD-170).

/** A figure the owner declared for claude-weekly, whose window resets at T0 + 4 days. */
const RESET = T0 + 4 * 24 * HOUR;
const declared = (/** @type {number} */ at, /** @type {number} */ used) => ({
  schema_version: 1,
  at: iso(at),
  source: 'owner-declared',
  readings: [{ limit: 'claude-weekly', used, resets_at: iso(RESET) }],
});
const weekly = (/** @type {Record<string, any>[]} */ snapshots, /** @type {number} */ now) =>
  dispatchGate(policyWith(), snapshots, {}, { now });

test('a declared figure opens the gate as a reading of low confidence', () => {
  assert.equal(weekly([], T0).mode, 'stop');
  const gate = weekly([declared(T0, 30)], T0);
  assert.equal(gate.mode, 'normal');
  assert.equal(gate.allow, true);
  const s = gate.quotas[0];
  assert.equal(s.used_from, 'declared');
  assert.equal(s.used, 30);
  assert.equal(s.confidence, 'low');
  assert.equal(s.declared?.used, 30);
  assert.equal(s.resets_at, iso(RESET));
  assert.deepEqual(gate.refresh, []);
});

test('a declared figure ages toward the reserve with the burn recorded up to it', () => {
  // 30% three days into the window: a window average of 30/72 = 0.42% an hour.
  const snaps = [declared(T0, 30)];
  const later = weekly(snaps, T0 + 48 * HOUR);
  const s = later.quotas[0];
  assert.ok(Math.abs(/** @type {number} */ (s.used) - 50) < 0.01, `used ${s.used}`);
  assert.equal(s.as_of, iso(T0));
  assert.equal(s.forecast.burn_basis, 'window average');
  // 100 - 50 - 25 = 25% above the reserve: economize, and the owner is asked for a fresh figure.
  assert.equal(later.mode, 'economize');
  assert.equal(later.refresh.length, 1);
  assert.match(later.refresh[0].why, /near it/);
  assert.match(later.reason, /ask the owner for a fresh usage figure for claude-weekly/);
  // At the reserve dispatch waits, still asking: 45% three days in is 0.625% an hour, so 75%
  // two days later.
  const stopped = weekly([declared(T0, 45)], T0 + 48 * HOUR);
  assert.equal(stopped.mode, 'stop');
  assert.equal(stopped.allow, false);
  assert.equal(stopped.refresh.length, 1);
  // A recent rate, from an earlier reading, wins over the window average.
  const recent = weekly(
    [{ ...declared(T0 - HOUR, 28), source: 'claude-code-statusline' }, declared(T0, 30)],
    T0 + 10 * HOUR,
  ).quotas[0];
  assert.equal(recent.forecast.burn_basis, 'recent');
  assert.ok(Math.abs(/** @type {number} */ (recent.used) - 50) < 0.01, `used ${recent.used}`);
});

test('a stale declared figure asks for a refresh without slowing dispatch', () => {
  // 10% three days in: 0.14% an hour, so 13 hours on the estimate is far from the reserve.
  const gate = weekly([declared(T0, 10)], T0 + 13 * HOUR);
  assert.equal(gate.mode, 'normal');
  assert.equal(gate.allow, true);
  assert.equal(gate.refresh.length, 1);
  assert.match(
    gate.refresh[0].why,
    /13 hours old, older than quota\.declared_refresh_hours \(12\)/,
  );
  const fresh = weekly([declared(T0, 10)], T0 + 11 * HOUR);
  assert.deepEqual(fresh.refresh, []);
  const sooner = dispatchGate(
    policyWith({ declared_refresh_hours: 2 }),
    [declared(T0, 10)],
    {},
    { now: T0 + 3 * HOUR },
  );
  assert.equal(sooner.refresh.length, 1);
  const report = buildReport({
    policy: policyWith(),
    snapshots: [declared(T0, 10)],
    now: T0 + 13 * HOUR,
  });
  assert.equal(report.gate.refresh.length, 1);
  assert.match(
    renderDigest(report),
    /Asked: a fresh usage figure for claude-weekly, as your account shows it .*hitld quota declare\./,
  );
});

test('a fresh measured reading is kept over a figure declared after it', () => {
  const measured = snap(T0 - 10 * 60_000, 5, 20);
  const snaps = [measured, declared(T0 - 60_000, 60)];
  const now = weekly(snaps, T0).quotas.find((q) => q.id === 'claude-weekly');
  assert.equal(now?.used_from, 'snapshot');
  assert.equal(now?.used, 20);
  assert.equal(now?.confidence, 'high');
  // Once the measured reading is no longer fresh, the later declared figure is the fallback.
  const stale = weekly(snaps, T0 + 40 * 60_000).quotas.find((q) => q.id === 'claude-weekly');
  assert.equal(stale?.used_from, 'declared');
  assert.ok(/** @type {number} */ (stale?.used) >= 60);
  // A stale measured reading after the declared figure is the later word, and is used.
  const after = weekly([declared(T0 - 2 * HOUR, 60), snap(T0 - HOUR, 5, 20)], T0).quotas.find(
    (q) => q.id === 'claude-weekly',
  );
  assert.equal(after?.used_from, 'snapshot');
  assert.equal(after?.used, 20);
  // A declared figure from a window that has reset is not used.
  const reset = weekly([declared(T0, 30)], RESET + HOUR).quotas[0];
  assert.equal(reset.used, null);
});

test('hitld quota declare records an owner-declared snapshot, and refuses an executor', async () => {
  const p = project();
  const args = ['quota', 'declare', '--used', '17.5%', '--resets-at', iso(RESET)];
  const r = await hitld([...args, '--now', iso(T0)], p);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.recorded.source, 'owner-declared');
  assert.deepEqual(r.json.recorded.readings, [
    { limit: 'claude-weekly', used: 17.5, resets_at: iso(RESET) },
  ]);
  assert.equal(r.json.used_from, 'declared');
  assert.equal(r.json.mode, 'normal');
  const lines = /** @type {string} */ (p.store.read('usage/snapshots.jsonl')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(schemas().validateEntity('usage-snapshot', JSON.parse(lines[0])), []);
  const status = await hitld(['quota', 'status', '--now', iso(T0 + HOUR)], p);
  assert.equal(status.json.mode, 'normal');
  assert.equal(status.json.quotas[0].used_from, 'declared');

  // Wrong input is refused, and nothing is written.
  for (const [bad, msg] of /** @type {[string[], RegExp][]} */ ([
    [['--used', 'lots', '--resets-at', iso(RESET)], /--used/],
    [['--used', '120', '--resets-at', iso(RESET)], /more than the limit/],
    [['--used', '10', '--resets-at', iso(T0 - HOUR)], /not in the future/],
    [['--used', '10', '--resets-at', iso(RESET), '--limit', 'nope'], /no quota limit nope/],
  ])) {
    const out = await hitld(['quota', 'declare', ...bad, '--now', iso(T0)], p);
    assert.equal(out.json.ok, false);
    assert.match(out.json.message, msg);
  }

  // An executor's process is refused, and so is a caller that is not the human command line.
  const executor = await hitld([...args, '--now', iso(T0)], {
    ...p,
    env: { ...p.env, HITLD_ROLE: 'executor' },
  });
  assert.equal(executor.json.error, 'not-permitted');
  const dispatched = await hitld([...args, '--now', iso(T0)], {
    ...p,
    env: { ...p.env, HITLD_DISPATCH: 'D-7' },
  });
  assert.equal(dispatched.json.error, 'not-permitted');
  const command = COMMANDS.find((c) => c.name === 'quota declare');
  const mcp = await command?.run?.(
    { used: '10', 'resets-at': iso(RESET), now: iso(T0) },
    { cwd: p.repo, env: { ...process.env, ...p.env } },
  );
  assert.equal(mcp?.error, 'not-permitted');
  assert.equal(
    /** @type {string} */ (p.store.read('usage/snapshots.jsonl')).trim().split('\n').length,
    1,
  );
});

test('run status and the digest ask the owner for a fresh figure once it grows old', async () => {
  const c = makeConsumer();
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const now = Date.now();
  const resets = iso(now + 2 * 24 * HOUR);
  const old = await c.hitld([
    'quota',
    'declare',
    '--used',
    '20',
    '--resets-at',
    resets,
    '--now',
    iso(now - 13 * HOUR),
  ]);
  assert.equal(old.exit, 0, JSON.stringify(old.result));
  const status = await c.hitld(['run', 'status']);
  assert.equal(status.exit, 0, JSON.stringify(status.result));
  assert.equal(status.result.ask_figure?.[0]?.limit, 'claude-weekly');
  assert.match(status.result.next, /ask the owner for a fresh usage figure for claude-weekly/);
  const digest = await c.hitld(['rights', 'digest', '--full']);
  assert.equal(digest.exit, 0, JSON.stringify(digest.result));
  assert.match(digest.result.text, /a fresh usage figure for claude-weekly/);
  assert.deepEqual(digest.result.quota.refresh, ['claude-weekly']);
  // A fresh figure ends the ask.
  assert.equal(
    (await c.hitld(['quota', 'declare', '--used', '22', '--resets-at', resets])).exit,
    0,
  );
  const calm = await c.hitld(['run', 'status']);
  assert.equal(calm.result.ask_figure, undefined);
  assert.doesNotMatch(calm.result.next, /fresh usage figure/);
});
