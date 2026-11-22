// HITLD-436: one completion's token figure, however wrong, cannot set the typical cost. The
// estimator needs a minimum sample and takes the median; the gate's burn reads a corrected figure.
// HITLD-439: wherever a cost is stated, it says where the figure came from and how many
// completions it rests on; the minimum sample and the multiple of the default are policy settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { estimateTokens, historyFromLedger, sizeItem } from '../lib/dispatch/sizing.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { renderBrief } from '../lib/dispatch/brief.mjs';
import { dispatchGate } from '../lib/quota/gate.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { startEstimate } from '../lib/ledger/ledger.mjs';

const D = { default_estimates: { 1: 60000, 2: 150000, 3: 400000 } };
const ITEM = { id: 'W-9', kind: 'work', touches: ['core/a.mjs'] };
/** @param {number | null} tokens */
const done = (tokens) => ({ area: 'core', kind: 'work', tier: 3, tokens, firstPass: true });

/** @param {Record<string, any>} e */
const figure = (e) => ({ tokens: e.tokens, source: e.source, samples: e.samples });

test('the estimate is the median of enough similar completions: one outlier among several normal ones does not move it', () => {
  const history = [done(380_000), done(420_000), done(1_882_231), done(400_000), done(390_000)];
  const e = estimateTokens(ITEM, 3, ['core'], history, D);
  assert.deepEqual(figure(e), { tokens: 400_000, source: 'history', samples: 5 });
  assert.equal(e.basis, 'the median of 5 similar past completions at tier 3');
  assert.equal(e.note, undefined);
  // At the minimum sample (3 by default), one outlier still cannot carry the median.
  const three = estimateTokens(ITEM, 3, ['core'], history.slice(0, 3), D);
  assert.deepEqual(figure(three), { tokens: 420_000, source: 'history', samples: 3 });
});

test('a default: no similar completion, and the estimate says it is the tier default', () => {
  const none = estimateTokens(ITEM, 3, ['core'], [], D);
  assert.deepEqual(figure(none), { tokens: 400_000, source: 'default', samples: 0 });
  assert.equal(
    none.basis,
    'the tier 3 default (dispatch.default_estimates): no similar past completion yet',
  );
  assert.equal(none.note, undefined, 'nothing to warn about');
  // The breadth scale is named when it applies.
  const wide = estimateTokens({ ...ITEM, touches: ['a', 'b'] }, 3, ['core'], [], D);
  assert.equal(wide.tokens, 500_000);
  assert.match(wide.basis, /scaled by 1\.25 for 2 touches globs/);
});

test("an item's own estimate is kept and says so; one far above the default is kept with a note", () => {
  const own = estimateTokens({ ...ITEM, estimate_tokens: 250_000 }, 3, ['core'], [done(9)], D);
  assert.deepEqual(figure(own), { tokens: 250_000, source: 'item', samples: 0 });
  assert.equal(own.basis, "the item's own estimate_tokens (no completions behind it)");
  assert.equal(own.note, undefined);
  const big = estimateTokens({ ...ITEM, estimate_tokens: 2_000_000 }, 3, ['core'], [], D);
  assert.equal(big.tokens, 2_000_000, 'the item sets it: the owner or planner chose it');
  assert.match(
    String(big.note),
    /more than 3 times the tier 3 default of 400,000 \(dispatch\.estimate_max_multiple\): kept/,
  );
});

test('a small sample: below the minimum the estimate is the tier default, and says the sample is too small', () => {
  const one = estimateTokens(ITEM, 3, ['core'], [done(1_882_231)], D);
  assert.deepEqual(figure(one), { tokens: 400_000, source: 'default', samples: 1 });
  assert.match(
    String(one.note),
    /tier 3 default: 1 similar past completion is too few to set it \(3 needed, dispatch\.estimate_min_samples\)/,
  );
  assert.equal(
    one.basis,
    'the tier 3 default (dispatch.default_estimates): 1 similar past completion is fewer than the 3 needed (dispatch.estimate_min_samples)',
  );
  // A completion with no token count is not a sample.
  assert.equal(estimateTokens(ITEM, 3, ['core'], [done(null), done(null), done(9)], D).samples, 1);
  // The minimum is a policy setting: at 1, one completion sets the estimate.
  const loose = estimateTokens(ITEM, 3, ['core'], [done(500_000)], {
    ...D,
    estimate_min_samples: 1,
  });
  assert.deepEqual(figure(loose), { tokens: 500_000, source: 'history', samples: 1 });
  assert.equal(loose.basis, 'the median of 1 similar past completion at tier 3');
  // At 5, three are too few.
  const strict = estimateTokens(ITEM, 3, ['core'], [done(1), done(2), done(3)], {
    ...D,
    estimate_min_samples: 5,
  });
  assert.equal(strict.source, 'default');
  assert.match(String(strict.note), /3 similar past completions are too few to set it \(5 needed/);
});

test('a figure far above the default: a median past the multiple is not used, and the estimate says why', () => {
  // Three poisoned records, as when one bad figure was copied into the next dispatches.
  const poisoned = [done(1_882_231), done(1_882_231), done(1_882_231)];
  const e = estimateTokens(ITEM, 3, ['core'], poisoned, D);
  assert.deepEqual(figure(e), { tokens: 400_000, source: 'default', samples: 3 });
  assert.match(
    String(e.note),
    /the median of 3 similar past completions, 1,882,231, is more than 3 times the default of 400,000, so it is not used \(dispatch\.estimate_max_multiple\)/,
  );
  assert.match(e.basis, /^the tier 3 default \(dispatch\.default_estimates\): the median of 3/);
  // Exactly at the multiple is still used; the multiple is a policy setting.
  const at = estimateTokens(
    ITEM,
    3,
    ['core'],
    [done(1_200_000), done(1_200_000), done(1_200_000)],
    D,
  );
  assert.equal(at.source, 'history');
  const wider = estimateTokens(ITEM, 3, ['core'], poisoned, { ...D, estimate_max_multiple: 5 });
  assert.deepEqual(figure(wider), { tokens: 1_882_231, source: 'history', samples: 3 });
});

test('the policy carries both settings with their defaults, and rejects a multiple below 1', () => {
  const base = { schema_version: 1, project: { id: 'estimate-test', key: 'W' } };
  const { policy, errors } = resolvePolicy(base);
  assert.deepEqual(errors, []);
  assert.equal(policy?.dispatch.estimate_min_samples, 3);
  assert.equal(policy?.dispatch.estimate_max_multiple, 3);
  const bad = resolvePolicy({ ...base, dispatch: { estimate_max_multiple: 0.5 } });
  assert.notDeepEqual(bad.errors, []);
});

test('the plan, the brief and the gate say where a cost came from and how many completions it rests on', () => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'estimate-test', key: 'W' },
  });
  assert.deepEqual(errors, []);
  const item = {
    id: 'W-9',
    kind: 'work',
    area: 'core',
    title: 'x',
    touches: ['core/a.mjs'],
    plan: 'design 5',
    tier_override: 3,
  };
  const sizing = sizeItem(item, /** @type {any} */ (policy), [done(1_882_231)]);
  assert.equal(sizing.estimate_source, 'default');
  assert.equal(sizing.estimate_samples, 1);
  assert.match(String(sizing.estimate_note), /too few to set it/);
  assert.ok(sizing.reasons.includes(String(sizing.estimate_note)));

  const caps = {
    parallel_subagents: true,
    persistent_sessions: true,
    hooks: 'full',
    max_classification: 'secret',
  };
  /** @type {any} */
  let gateItem = null;
  const planned = planDispatch({
    queue: [/** @type {any} */ (item)],
    sizes: new Map([['W-9', sizing]]),
    running: [],
    cap: 2,
    capabilities: /** @type {any} */ (caps),
    gate: (i) => {
      gateItem = i;
      return { mode: 'normal', allow: true, reason: 'ample' };
    },
  });
  assert.equal(planned.start.length, 1);
  assert.ok(gateItem);
  // The plan says so: the fallback is in the started item's notes.
  assert.ok(planned.start[0].notes.includes(String(sizing.estimate_note)));

  const brief = renderBrief({
    item: /** @type {any} */ (item),
    sizing,
    dispatch: 'D-1',
    branch: 'b',
    policy: /** @type {any} */ (policy),
    isolation: 'worktree',
  });
  assert.match(
    brief,
    new RegExp(
      `Budget: ~${Math.round(sizing.estimate_tokens / 1000)}k tokens \\(estimate from the tier ${sizing.tier} default \\(dispatch\\.default_estimates\\): 1 similar past completion is fewer than the 3 needed \\(dispatch\\.estimate_min_samples\\)\\); report at`,
    ),
  );

  // The gate's "would cross the reserve" says where the figure came from.
  const tight = resolvePolicy({
    schema_version: 1,
    project: { id: 'estimate-test', key: 'W' },
    quota: {
      limits: [
        {
          id: 'tok',
          unit: 'tokens',
          window: 'monthly_utc',
          limit: 1_000_000,
          source: 'declared',
          hard: false,
        },
      ],
    },
  });
  const now = Date.parse('2026-11-14T12:00:00Z');
  const crossing = dispatchGate(
    /** @type {any} */ (tight.policy),
    [],
    { estimate_tokens: 950_000, estimate_basis: sizing.estimate_basis },
    { now, ledger: [] },
  );
  assert.match(
    crossing.reason,
    /estimate of 950000 tokens \(from the tier \d default \(dispatch\.default_estimates\): 1 similar past completion is fewer than the 3 needed \(dispatch\.estimate_min_samples\)\) would cross the reserve/,
  );
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

test("a dispatch's own start estimate does not feed the next estimate: only completions do", () => {
  // As in a real ledger: one bad completion figure, and later dispatches that started with it.
  const events = ledger([1_882_231, 400_000]).map((e) =>
    e.event === 'dispatched' ? { ...e, estimate_tokens: 1_882_231 } : e,
  );
  const history = historyFromLedger(events, () => ({ id: 'x', area: 'core', kind: 'work' }));
  const e = estimateTokens(ITEM, 3, ['core'], history, D);
  assert.deepEqual(figure(e), { tokens: 400_000, source: 'default', samples: 2 });
  assert.match(e.basis, /2 similar past completions are fewer than the 3 needed/);
});
