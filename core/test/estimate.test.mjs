// HITLD-436: one completion's token figure, however wrong, cannot set the typical cost. The
// estimator needs a minimum sample and takes the median; the gate's burn reads a corrected figure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import {
  ESTIMATE_MIN_SAMPLES,
  estimateTokens,
  historyFromLedger,
} from '../lib/dispatch/sizing.mjs';
import { dispatchGate } from '../lib/quota/gate.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { startEstimate } from '../lib/ledger/ledger.mjs';

const D = { default_estimates: { 1: 60000, 2: 150000, 3: 400000 } };
const ITEM = { id: 'W-9', kind: 'work', touches: ['core/a.mjs'] };
/** @param {number | null} tokens */
const done = (tokens) => ({ area: 'core', kind: 'work', tier: 3, tokens, firstPass: true });

test('the estimate is the median of enough similar completions: one outlier among several normal ones does not move it', () => {
  const history = [done(380_000), done(420_000), done(1_882_231), done(400_000), done(390_000)];
  const e = estimateTokens(ITEM, 3, ['core'], history, D);
  assert.deepEqual(e, { tokens: 400_000, source: 'history', samples: 5 });
  // At the minimum sample, one outlier still cannot carry the median.
  const three = estimateTokens(ITEM, 3, ['core'], history.slice(0, 3), D);
  assert.equal(ESTIMATE_MIN_SAMPLES, 3);
  assert.deepEqual(three, { tokens: 420_000, source: 'history', samples: 3 });
});

test('below the minimum sample the estimate is the tier default, and says the sample is too small', () => {
  const one = estimateTokens(ITEM, 3, ['core'], [done(1_882_231)], D);
  assert.equal(one.tokens, 400_000);
  assert.equal(one.source, 'default');
  assert.equal(one.samples, 1);
  assert.match(
    String(one.note),
    /tier 3 default: 1 similar past completion is too few to set it \(3 needed\)/,
  );
  // No similar completion at all: the default, and nothing to say.
  const none = estimateTokens(ITEM, 3, ['core'], [], D);
  assert.deepEqual(none, { tokens: 400_000, source: 'default', samples: 0 });
  // A completion with no token count is not a sample.
  assert.equal(estimateTokens(ITEM, 3, ['core'], [done(null), done(null), done(9)], D).samples, 1);
});

/** A ledger of executor dispatches at tier 3, each with its completion. */
function ledger(/** @type {number[]} */ tokens) {
  /** @type {Record<string, any>[]} */
  const events = [];
  let at = Date.parse('2026-11-14T08:00:00Z');
  tokens.forEach((t, i) => {
    const d = `D-${i + 1}`;
    const item = `W-${i + 1}`;
    const stamp = () => new Date((at += 60_000)).toISOString();
    events.push(
      {
        id: `dispatched-${d}`,
        event: 'dispatched',
        dispatch: d,
        item,
        tier: 3,
        role: 'executor',
        estimate_tokens: 400_000,
        at: stamp(),
      },
      { id: `reported-${d}`, event: 'reported', dispatch: d, item, tokens: t, at: stamp() },
    );
  });
  return events;
}

test('the history reads a corrected completion with its corrected figure, as the summary does', () => {
  const events = ledger([1_882_231, 400_000, 380_000]);
  const item = () => ({ id: 'x', area: 'core', kind: 'work' });
  assert.deepEqual(
    historyFromLedger(events, item).map((h) => h.tokens),
    [1_882_231, 400_000, 380_000],
  );
  const corrected = [
    ...events,
    { ...events[1], id: 'E-9', tokens: 8065, corrects: 'reported-D-1', at: '2026-11-14T09:00:00Z' },
  ];
  assert.deepEqual(
    historyFromLedger(corrected, item).map((h) => h.tokens),
    [400_000, 380_000, 8065],
  );
  assert.equal(
    summarize(corrected).estimate_vs_actual.by_dispatch.find((r) => r.dispatch === 'D-1')?.tokens,
    8065,
  );
  // A follow-up carries no estimate of its own: the item's last one is the one it started with.
  const followUp = {
    id: 'dispatched-D-9',
    event: 'dispatched',
    dispatch: 'D-9',
    item: 'W-1',
    tier: 3,
    role: 'executor',
    at: '2026-11-14T10:00:00Z',
  };
  assert.equal(startEstimate([...events, followUp], 'D-9'), 400_000);
  assert.equal(startEstimate(events, 'D-404', 'W-404'), undefined);
});

test("the gate's burn reads completions only as they stand after corrections: a corrected outlier does not hold dispatch", () => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'estimate-test', key: 'W' },
    quota: {
      limits: [
        {
          id: 'tok',
          unit: 'tokens',
          window: 'monthly_utc',
          limit: 10_000_000,
          source: 'declared',
          hard: false,
        },
      ],
    },
  });
  assert.deepEqual(errors, []);
  const now = Date.parse('2026-11-14T12:00:00Z');
  const normal = ledger([400_000, 380_000, 420_000]);
  const base = dispatchGate(
    /** @type {any} */ (policy),
    [],
    { estimate_tokens: 400_000 },
    { now, ledger: normal },
  );
  assert.equal(base.mode, 'normal', base.reason);

  // The ledger fallback does read a completion's figure: an outlier counts as spend...
  const outlier = ledger([400_000, 380_000, 420_000, 7_000_000]);
  const held = dispatchGate(
    /** @type {any} */ (policy),
    [],
    { estimate_tokens: 400_000 },
    { now, ledger: outlier },
  );
  assert.notEqual(
    held.mode,
    'normal',
    'an uncorrected figure is spend as far as the reserve knows',
  );
  // ...and its correction stands in for it, so the burn is back where it was.
  const fixed = [
    ...outlier,
    {
      ...outlier[7],
      id: 'E-99',
      tokens: 8065,
      corrects: 'reported-D-4',
      at: '2026-11-14T11:00:00Z',
    },
  ];
  const back = dispatchGate(
    /** @type {any} */ (policy),
    [],
    { estimate_tokens: 400_000 },
    { now, ledger: fixed },
  );
  assert.equal(back.mode, 'normal', back.reason);
});
