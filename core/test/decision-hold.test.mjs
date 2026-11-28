// A ready item whose touches overlap an open decision's in the same tier is held for a later plan,
// softly: with nothing else to offer, it is offered with a note (HITLD-1047).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionOverlaps, rankQueue } from '../lib/dispatch/queue.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { globsOverlap } from '../lib/dispatch/item.mjs';
import { deriveTouches } from '../lib/dispatch/touches.mjs';
import { FAKE_PROFILES } from '../harness/fake/fake.mjs';

/** @param {string} id @param {Record<string, any>} [more] @returns {Record<string, any>} */
const work = (id, more = {}) => ({
  id,
  kind: 'work',
  state: 'planned',
  classification: 'public',
  title: id,
  ...more,
});
/** @param {string} id @param {Record<string, any>} [more] @returns {Record<string, any>} */
const decision = (id, more = {}) => ({
  id,
  kind: 'decision',
  state: 'planned',
  decider: 'owner',
  title: id,
  ...more,
});
const always = () => ({ mode: 'normal', allow: true, reason: 'ok' });

/** The repository the touches are derived against. */
const FILES = ['core/lib/dispatch/plan.mjs', 'core/lib/dispatch/queue.mjs', 'docs/design.md'];

/**
 * Rank the ready work in `items`, find its decision overlaps with touches derived from the text,
 * and plan it at `cap`.
 * @param {Record<string, any>[]} items @param {{ cap?: number, only?: string }} [o]
 */
function planOf(items, o = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ready = /** @type {any[]} */ (
    items.filter(
      (i) =>
        i.kind === 'work' &&
        i.state === 'planned' &&
        (i.needs ?? []).every((/** @type {string} */ n) => byId.get(n)?.state === 'done'),
    )
  );
  const sizes = new Map(
    ready.map((i) => [
      i.id,
      /** @type {any} */ ({ tier: 1, estimate_tokens: 1000, model: 'm', effort: 'low' }),
    ]),
  );
  const ranking = rankQueue({ items: /** @type {any[]} */ (items), ready, sizes, weight: () => 1 });
  const touches = (/** @type {any} */ i) => i.touches ?? deriveTouches(i, FILES);
  const overlaps = decisionOverlaps({
    items: /** @type {any[]} */ (items),
    ready,
    ranking,
    touches,
    overlap: globsOverlap,
  });
  const queue = o.only ? ranking.queue.filter((i) => i.id === o.only) : ranking.queue;
  const plan = planDispatch({
    queue,
    sizes,
    running: [],
    cap: o.cap ?? 2,
    capabilities: FAKE_PROFILES.full,
    gate: always,
    touches: (i) => ({ touches: touches(i), source: 'derived' }),
    decisions: (i) => overlaps.get(String(i.id)) ?? [],
    ...(o.only
      ? {
          decisionFallback: !ranking.queue.some(
            (i) => i.id !== o.only && !overlaps.has(String(i.id)),
          ),
        }
      : {}),
  });
  return { overlaps, plan, start: plan.start.map((s) => s.item) };
}

test('an item whose derived touches overlap an open decision in its tier is held, and one whose do not starts', () => {
  const items = [
    decision('D-1', { body: 'Should core/lib/dispatch/plan.mjs hold work for decisions?' }),
    work('W-2', { body: 'Change core/lib/dispatch/plan.mjs to print the hold.' }),
    work('W-3', { body: 'Reword docs/design.md part 2.' }),
  ];
  const { overlaps, plan, start } = planOf(items);
  assert.deepEqual(overlaps.get('W-2'), [
    { decision: 'D-1', title: 'D-1', paths: ['core/lib/dispatch/plan.mjs'] },
  ]);
  assert.equal(overlaps.has('W-3'), false, 'no shared file: no overlap');
  assert.deepEqual(start, ['W-3']);
  assert.deepEqual(plan.held, [
    {
      item: 'W-2',
      reason: 'decision',
      why: 'its touches overlap an open decision in its tier, D-1 (core/lib/dispatch/plan.mjs): it waits for a later plan, as work started before the decision is settled often changes with the answer',
    },
  ]);
});

test('the hold is soft: with nothing else ready the item is offered with a note', () => {
  const items = [
    decision('D-1', { body: 'Should core/lib/dispatch/plan.mjs hold work for decisions?' }),
    work('W-2', { body: 'Change core/lib/dispatch/plan.mjs to print the hold.' }),
  ];
  const { plan, start } = planOf(items);
  assert.deepEqual(start, ['W-2']);
  assert.deepEqual(plan.held, []);
  assert.deepEqual(plan.start[0].notes, [
    'nothing else is ready, so it is offered though its touches overlap an open decision in its tier, D-1 (core/lib/dispatch/plan.mjs): read the decision before starting, and expect to revisit the work once it is answered',
  ]);
});

test('planned alone, the held item starts only when no other ready item is free of a decision', () => {
  const items = [
    decision('D-1', { body: 'Should core/lib/dispatch/plan.mjs hold work for decisions?' }),
    work('W-2', { body: 'Change core/lib/dispatch/plan.mjs to print the hold.' }),
    work('W-3', { body: 'Reword docs/design.md part 2.' }),
  ];
  // W-3 is free, so dispatch start of W-2 alone is refused with the hold's reason.
  const alone = planOf(items, { only: 'W-2' });
  assert.deepEqual(alone.start, []);
  assert.equal(alone.plan.held[0]?.reason, 'decision');
  // Without W-3, W-2 is the only ready work and starts with the note.
  const only = planOf(items.slice(0, 2), { only: 'W-2' });
  assert.deepEqual(only.start, ['W-2']);
});

test('a decision in another tier, a decision the item feeds and a closed decision hold nothing', () => {
  const body = 'Change core/lib/dispatch/plan.mjs.';
  const items = [
    // R-1's tier holds W-2; D-9 sits in R-8's tier only.
    work('R-1', { release: '1.0.1', needs: ['W-2'], state: 'planned' }),
    work('R-8', { release: '2.0.0', needs: ['R-1', 'D-9'], state: 'planned' }),
    decision('D-9', { body }),
    // D-4 needs W-2: W-2 informs it.
    decision('D-4', { body, needs: ['W-2'] }),
    decision('D-5', { body, state: 'done' }),
    work('W-2', { body }),
  ];
  const { overlaps, start } = planOf(items);
  assert.equal(overlaps.has('W-2'), false);
  assert.deepEqual(start, ['W-2']);
  // In the same tier, D-9 holds it: put D-9 in R-1's closure.
  const same = planOf(items.map((i) => (i.id === 'R-1' ? { ...i, needs: ['W-2', 'D-9'] } : i)));
  assert.deepEqual(
    same.overlaps.get('W-2')?.map((o) => o.decision),
    ['D-9'],
  );
  // Outside every release, the decision W-2 feeds and the closed one still hold nothing.
  const outside = planOf(items.filter((i) => !['R-1', 'R-8', 'D-9'].includes(i.id)));
  assert.equal(outside.overlaps.has('W-2'), false);
  // An open decision outside every release that W-2 does not feed is in its tier.
  const unfed = planOf([decision('D-6', { body }), work('W-2', { body })]);
  assert.deepEqual(
    unfed.overlaps.get('W-2')?.map((o) => o.decision),
    ['D-6'],
  );
});
