// HITLD-450: a start estimate recorded on a dispatch is read capped at the planner's maximum
// multiple of the tier's default, says where it came from, and can be corrected by a recorded
// command. The poisoned figure is the one found in a real ledger: 1,882,231, from one bad
// completion record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryStore } from './helpers/memory-store.mjs';
import {
  DEFAULT_ESTIMATES,
  LedgerError,
  appendEvent,
  estimateCap,
  readLedger,
  startEstimate,
  startEstimateOf,
} from '../lib/ledger/ledger.mjs';
import { inflight } from '../lib/ledger/inflight.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { ledgerUsage } from '../lib/quota/usage.mjs';
import { farAboveEstimate, reportedEvent } from '../lib/run/protocol.mjs';
import { watchDispatches } from '../lib/dispatch/watch.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { openStore } from '../lib/store/store.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { STATUS_INPUT, item, makeConsumer, report } from './orchestrator-fixture.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';

const POISONED = 1_882_231;
const D = { default_estimates: { 1: 60_000, 2: 150_000, 3: 400_000 } };
const T = 1_800_000_000_000;
const at = (/** @type {number} */ s) => new Date(T + s * 1000).toISOString();

/**
 * A dispatched event.
 * @param {number} n @param {Record<string, any>} [over]
 */
const dispatched = (n, over = {}) => ({
  id: `dispatched-D-${n}`,
  event: 'dispatched',
  dispatch: `D-${n}`,
  item: 'W-1',
  tier: 3,
  role: 'executor',
  at: at(n * 10),
  ...over,
});

/** A completion. @param {number} n @param {Record<string, any>} [over] */
const reported = (n, over = {}) => ({
  id: `reported-D-${n}`,
  event: 'reported',
  dispatch: `D-${n}`,
  item: 'W-1',
  role: 'executor',
  result: 'done',
  at: at(n * 10 + 5),
  ...over,
});

/** A correction of a dispatch's estimate, as hitld ledger correct-estimate writes it. */
const correction = (
  /** @type {Record<string, any>} */ of,
  /** @type {number} */ tokens,
  s = 900,
) => ({
  ...of,
  id: `E-fix-${of.id}`,
  at: at(s),
  estimate_tokens: tokens,
  estimate_source: 'typed',
  estimate_samples: 0,
  corrects: of.id,
});

test('a poisoned start estimate is read capped at the maximum multiple of the tier default', () => {
  const events = [dispatched(29, { estimate_tokens: POISONED })];
  assert.equal(estimateCap(3, D), 1_200_000, '3 times the tier 3 default of 400,000');
  assert.equal(startEstimate(events, 'D-29', 'W-1', D), 1_200_000);
  assert.deepEqual(startEstimateOf(events, 'D-29', 'W-1', D), {
    tokens: 1_200_000,
    recorded: POISONED,
    cap: 1_200_000,
    capped: true,
    source: 'unknown',
    samples: null,
    event: 'dispatched-D-29',
    dispatch: 'D-29',
    corrected_by: null,
  });
  // The multiple is the planner's setting, dispatch.estimate_max_multiple.
  assert.equal(startEstimate(events, 'D-29', 'W-1', { ...D, estimate_max_multiple: 2 }), 800_000);
  // The bound is the dispatch's own tier's.
  const tier1 = [dispatched(29, { tier: 1, estimate_tokens: POISONED })];
  assert.equal(startEstimate(tier1, 'D-29', 'W-1', D), 180_000);
  // Without a policy, the schema's defaults: the same bound.
  assert.equal(startEstimate(events, 'D-29', 'W-1'), 1_200_000);
  // A figure under the bound is read as recorded.
  const fine = [dispatched(29, { estimate_tokens: 400_000, estimate_source: 'default' })];
  assert.equal(startEstimateOf(fine, 'D-29', 'W-1', D)?.capped, false);
  assert.equal(startEstimate(fine, 'D-29', 'W-1', D), 400_000);
});

test("an estimate the item set itself is read as recorded, as the planner keeps it; a follow-up reads the item's capped one", () => {
  const own = [
    dispatched(29, { estimate_tokens: 2_000_000, estimate_source: 'item', estimate_samples: 0 }),
  ];
  assert.equal(startEstimate(own, 'D-29', 'W-1', D), 2_000_000);
  // A follow-up carries none of its own: the item's earlier one stands, capped.
  const events = [
    dispatched(29, { estimate_tokens: POISONED }),
    reported(29),
    dispatched(30, { notes: 'follow-up of D-29' }),
  ];
  assert.equal(startEstimate(events, 'D-30', 'W-1', D), 1_200_000);
  assert.equal(startEstimateOf(events, 'D-30', 'W-1', D)?.dispatch, 'D-29');
  // Tier 0 is inline work: no bound, and no estimate to bound.
  assert.equal(estimateCap(0, D), null);
});

test('the refusal threshold and a completion rest on the capped figure', () => {
  const events = [dispatched(29, { estimate_tokens: POISONED })];
  const estimate = startEstimate(events, 'D-29', 'W-1', D);
  // Read raw, 4M tokens would pass under the threshold of about 5.6M; capped, it is refused.
  assert.equal(farAboveEstimate(4_000_000, POISONED), false);
  assert.equal(farAboveEstimate(4_000_000, estimate), true);
  const e = reportedEvent(
    { dispatch: 'D-29', item: 'W-1', role: 'executor' },
    {
      report: 'item: W-1\nresult: done',
      usage: { tokens: 400_000, toolCalls: null, durationMs: null },
    },
    events,
    D,
  );
  assert.equal(e.estimate_tokens, 1_200_000, 'the completion carries the capped figure');
});

test('estimate against actual reads the capped figure, says where the estimate came from, and keeps what the ledger holds', () => {
  const events = [
    dispatched(29, { estimate_tokens: POISONED }),
    // A completion recorded before HITLD-450 carries the same poisoned copy.
    reported(29, { tokens: 400_000, tokens_source: 'typed', estimate_tokens: POISONED }),
    dispatched(31, { estimate_tokens: 400_000, estimate_source: 'default', estimate_samples: 1 }),
    reported(31, { tokens: 400_000, tokens_source: 'session-record' }),
  ];
  const s = summarize(events, D).estimate_vs_actual;
  const row = (/** @type {string} */ d) =>
    /** @type {Record<string, any>} */ (
      s.by_dispatch.find((/** @type {any} */ r) => r.dispatch === d)
    );
  assert.equal(row('D-29').estimate_tokens, 1_200_000);
  assert.equal(row('D-29').estimate_recorded, POISONED);
  assert.equal(row('D-29').estimate_source, 'unknown', 'written before the ledger said');
  assert.equal(row('D-29').estimate_samples, undefined);
  assert.equal(row('D-29').ratio, 0.33, 'not 0.21, which the poisoned figure gave');
  assert.equal(row('D-31').estimate_source, 'default');
  assert.equal(row('D-31').estimate_samples, 1, 'an estimate that rested on one record shows it');
  assert.equal(row('D-31').estimate_recorded, undefined, 'not capped');
  assert.deepEqual(s.estimate_sources, { item: 0, history: 0, default: 1, typed: 0, unknown: 1 });
  // A completion with no dispatched event to read: its own copy, under the highest tier's bound.
  const orphan = summarize([reported(40, { tokens: 400_000, estimate_tokens: POISONED })], D)
    .estimate_vs_actual.by_dispatch[0];
  assert.deepEqual(
    [orphan.estimate_tokens, orphan.estimate_recorded, orphan.estimate_source],
    [1_200_000, POISONED, 'unknown'],
  );
});

test('a correction is read in place of the estimate it corrects, everywhere the start estimate is read', () => {
  const d29 = dispatched(29, { estimate_tokens: POISONED });
  const events = [
    d29,
    reported(29, { tokens: 400_000, estimate_tokens: POISONED }),
    dispatched(30, { notes: 'follow-up of D-29' }),
    reported(30, { tokens: 100_000, estimate_tokens: POISONED }),
    correction(d29, 400_000),
  ];
  assert.equal(startEstimate(events, 'D-29', 'W-1', D), 400_000);
  assert.equal(startEstimateOf(events, 'D-29', 'W-1', D)?.corrected_by, 'E-fix-dispatched-D-29');
  assert.equal(startEstimateOf(events, 'D-29', 'W-1', D)?.source, 'typed');
  assert.equal(startEstimate(events, 'D-30', 'W-1', D), 400_000, 'the follow-up reads it too');
  const s = summarize(events, D).estimate_vs_actual;
  assert.deepEqual(
    s.by_dispatch.map((/** @type {any} */ r) => [r.dispatch, r.estimate_tokens, r.ratio]),
    [
      ['D-29', 400_000, 1],
      ['D-30', 400_000, 0.25],
    ],
  );
  assert.equal(s.estimate_sources.typed, 2);
  // A correction of the correction stands in its place.
  const again = [...events, correction(events[4], 300_000, 950)];
  assert.equal(startEstimate(again, 'D-29', 'W-1', D), 300_000);
  // A correction typed far above the bound is still read under it.
  assert.equal(startEstimate([d29, correction(d29, 9_000_000)], 'D-29', 'W-1', D), 1_200_000);
});

test("a late correction of an older dispatch does not become a newer dispatch's start estimate", () => {
  const d29 = dispatched(29, { estimate_tokens: POISONED });
  const events = [
    d29,
    reported(29),
    dispatched(31, { estimate_tokens: 500_000, estimate_source: 'history', estimate_samples: 4 }),
    reported(31),
    dispatched(32, { notes: 'follow-up of D-31' }),
    correction(d29, 400_000),
  ];
  assert.equal(startEstimate(events, 'D-32', 'W-1', D), 500_000, "D-31's, the item's last");
  assert.equal(startEstimate(events, 'D-29', 'W-1', D), 400_000);
});

test("the watchdog's stall limits rest on the capped estimate", () => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'test', key: 'W' },
    dispatch: { estimate_max_multiple: 2 },
  });
  if (!policy) throw new Error(JSON.stringify(errors));
  const entry = {
    dispatch: 'D-1',
    item: 'W-1',
    tier: 1,
    harness: 'claude-code',
    harness_ref: 'agent-1',
    host: 'h',
    worktree: null,
    branch: 'hitld/W-1-x',
    serial_resources: [],
    started_at: at(0),
  };
  /** @param {number} estimate */
  const limit = (estimate) =>
    watchDispatches({
      inFlight: [entry],
      events: [dispatched(1, { tier: 1, estimate_tokens: estimate, at: at(0) })],
      signals: () => [],
      policy,
      now: T + 60_000,
    })[0].stall_after_seconds;
  // 1,882,231 read raw would scale the limits by stall_estimate_max (3); capped at 2 times the
  // tier 1 default, they scale by 2.
  assert.equal(limit(POISONED), 3600);
  assert.equal(limit(60_000), 1800);
});

test('a correction neither starts nor reopens a dispatch, nor counts as a request', () => {
  const store = memoryStore();
  const d1 = appendEvent(store, dispatched(1, { estimate_tokens: POISONED })).event;
  appendEvent(store, reported(1, { tokens: 400_000 }));
  // A second dispatched event for the same dispatch is refused; a correction of it is not.
  assert.throws(
    () => appendEvent(store, { ...dispatched(1), id: 'other', estimate_tokens: 1 }),
    LedgerError,
  );
  const { events } = appendEvent(store, {
    ...correction(d1, 400_000),
    id: undefined,
    at: undefined,
  });
  assert.deepEqual(inflight(events), [], 'the ended dispatch stays ended');
  const usage = ledgerUsage(events, { unit: 'requests' }, { start: 0, now: T + 10_000_000 });
  assert.equal(usage?.used, 1, 'one dispatch, one request');
  // The fields belong to dispatched only.
  assert.throws(
    () => appendEvent(store, { ...reported(2), dispatch: 'D-2', estimate_source: 'typed' }),
    /estimate_source is only for dispatched/,
  );
});

test("the tier defaults the bound falls back to are the policy schema's", () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../schemas/policy/dispatch.schema.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(DEFAULT_ESTIMATES)),
    Object.fromEntries(
      Object.entries(schema.properties.default_estimates.default).map(([k, v]) => [k, v]),
    ),
  );
});

// --- The commands -------------------------------------------------------------------------------

/** A consumer with one tier 3 item dispatched as an interactive session. */
async function started() {
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 4 } } },
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/redesign.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'session-1']);
  const root = join(c.data, 'human-in-the-lead/orch-fixture');
  const ledger = () => readLedger(openStore(root)).events;
  return { c, start, root, ledger };
}

test('dispatch start records where the estimate came from and how many completions it rests on', async () => {
  const { ledger } = await started();
  const d = ledger().find((e) => e.event === 'dispatched');
  assert.deepEqual(
    [d?.estimate_tokens, d?.estimate_source, d?.estimate_samples],
    [400_000, 'default', 0],
  );
});

test('ledger correct-estimate records a correction that is read in place of the original, with the refusal threshold before and after', async () => {
  const { c, start, root, ledger } = await started();
  // The estimate is corrected to the poisoned figure, as a stand-in for one recorded before: even
  // a typed figure is read under the bound.
  const poison = await c.hitld([
    'ledger',
    'correct-estimate',
    'dispatched-D-1',
    '--tokens',
    String(POISONED),
    '--why',
    'a test: the figure found in a real ledger',
  ]);
  assert.equal(poison.exit, 0, JSON.stringify(poison.result));
  assert.equal(poison.result.event.corrects, 'dispatched-D-1');
  assert.equal(poison.result.event.estimate_source, 'typed');
  assert.equal(poison.result.event.brief_hash, ledger()[1].brief_hash, 'every other field stands');
  assert.deepEqual(poison.result.estimate, {
    before: { recorded: 400_000, reads_as: 400_000, source: 'default', refused_above: 1_200_000 },
    after: {
      recorded: POISONED,
      reads_as: 1_200_000,
      source: 'typed',
      capped_at: 1_200_000,
      refused_above: 3_600_000,
    },
  });
  // Still one dispatch in flight, not two, and not reopened.
  const inFlight = await c.hitld(['ledger', 'in-flight']);
  assert.deepEqual(
    inFlight.result.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-1'],
  );
  assert.deepEqual(
    loadState(openStore(root)).state?.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-1'],
  );

  // The original is corrected once; the correction is what a second correction names.
  const twice = await c.hitld([
    'ledger',
    'correct-estimate',
    'dispatched-D-1',
    '--tokens',
    '400000',
    '--why',
    'again',
  ]);
  assert.equal(twice.result.error, 'already-corrected');
  assert.equal(twice.result.corrected_by, poison.result.event.id);

  // The completion's typed 4M is refused against the capped 1.2M (it would pass against 1.88M).
  const note = join(c.base, 'report.txt');
  writeFileSync(note, report({ item: 'W-4', sha: 'abc1234', branch: start.result.branch }));
  const complete = (/** @type {string} */ tokens) =>
    c.hitld([
      'dispatch',
      'complete',
      '--dispatch',
      'D-1',
      '--report-file',
      note,
      '--tokens',
      tokens,
    ]);
  const refused = await complete('4000000');
  assert.notEqual(refused.exit, 0);
  assert.equal(refused.result.error, 'tokens-over-estimate');
  assert.match(refused.result.message, /its estimate of 1200000/);

  // Corrected back to the tier default, the same correction command names the standing one.
  const fix = await c.hitld([
    'ledger',
    'correct-estimate',
    poison.result.event.id,
    '--tokens',
    '400000',
    '--why',
    'the tier default: the figure came from one bad completion record',
  ]);
  assert.equal(fix.exit, 0, JSON.stringify(fix.result));
  assert.deepEqual(fix.result.estimate.after, {
    recorded: 400_000,
    reads_as: 400_000,
    source: 'typed',
    refused_above: 1_200_000,
  });
  assert.match(fix.result.event.notes, /estimate corrected from 1882231 to 400000 by test-session/);

  const done = await complete('400000');
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  const sum = await c.hitld(['ledger', 'summary']);
  const row = sum.result.estimate_vs_actual.by_dispatch[0];
  assert.deepEqual(
    [row.estimate_tokens, row.estimate_source, row.estimate_samples, row.ratio],
    [400_000, 'typed', 0, 1],
  );
  // A completion is not a dispatch: its tokens are corrected with correct-tokens.
  const wrong = await c.hitld([
    'ledger',
    'correct-estimate',
    'reported-D-1',
    '--tokens',
    '1',
    '--why',
    'no',
  ]);
  assert.equal(wrong.result.error, 'forbidden-correction');
});
