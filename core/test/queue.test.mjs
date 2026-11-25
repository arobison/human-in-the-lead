// The ready queue's order (design part 2.4, HITLD-995): the nearest release first, paths weighed
// in estimate tokens, work that feeds open decisions first inside a tier, and no priority label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orderQueue,
  rankQueue,
  releaseChain,
  releaseSummary,
  unblockCounts,
  weightsOf,
} from '../lib/dispatch/queue.mjs';
import { sizingWeight } from '../lib/tracker/files/views.mjs';

/**
 * A planned work item. @param {string} id @param {Record<string, any>} [more]
 * @returns {Record<string, any>}
 */
const work = (id, more = {}) => ({ id, kind: 'work', state: 'planned', title: id, ...more });
/** A release item. @param {string} id @param {string[]} needs @param {Record<string, any>} [more] */
const release = (id, needs, more = {}) => work(id, { release: `1.0.${id}`, needs, ...more });
/** A milestone whose constraints name `ids`. @param {string} id @param {string[]} ids */
const milestone = (id, ids) => ({
  id,
  kind: 'milestone',
  state: 'planned',
  title: id,
  constraints: ids.map((x) => ({ id: x, clause: null })),
});

/**
 * Rank `items` with each item weighing `weights[id]` (default 1), the ready set derived: planned
 * work whose needs are all done.
 * @param {Record<string, any>[]} items @param {Record<string, number>} [weights]
 */
function rank(items, weights = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ready = items.filter(
    (i) =>
      i.kind === 'work' &&
      i.state === 'planned' &&
      (i.needs ?? []).every((/** @type {string} */ n) => byId.get(n)?.state === 'done'),
  );
  const weight = (/** @type {string} */ id) => weights[id] ?? 1;
  const sizes = new Map(
    ready.map((i) => [i.id, /** @type {any} */ ({ estimate_tokens: weight(i.id) })]),
  );
  const r = rankQueue({
    items: /** @type {any[]} */ (items),
    ready: /** @type {any[]} */ (ready),
    sizes,
    weight,
  });
  return { ...r, ready, ids: r.queue.map((i) => String(i.id)) };
}

test('a stray priority key orders nothing: the same items without it rank the same', () => {
  const items = [
    work('W-1', { priority: 'low' }),
    work('W-2', { priority: 'urgent' }),
    work('W-3', { priority: 'high' }),
    work('W-4', { needs: ['W-1'] }),
    release('W-9', ['W-3']),
  ];
  const bare = items.map(({ priority: _, ...rest }) => rest);
  assert.deepEqual(rank(items).ids, rank(bare).ids);
  assert.deepEqual(rank(items).ids, ['W-3', 'W-1', 'W-2']);
  // The order with no release reads no priority either.
  const sizes = new Map(items.map((i) => [i.id, /** @type {any} */ ({ estimate_tokens: 1 })]));
  const plain = orderQueue(
    /** @type {any[]} */ (items.slice(0, 3)),
    sizes,
    unblockCounts(/** @type {any[]} */ (items)),
  );
  assert.deepEqual(
    plain.map((i) => i.id),
    ['W-1', 'W-3', 'W-2'],
  );
});

test("the nearest release's single gate outranks the work three parallel releases share", () => {
  // W-11, W-12 and W-13 all need X (W-1) and more besides; W-10 needs only Y (W-2). Counting
  // what each unblocks, X would come first (three releases wait on it); by the release chain,
  // W-10 is nearest (the fewest tokens left), so its one gate goes first.
  const items = [
    work('W-1'),
    work('W-2'),
    work('W-3'),
    work('W-4'),
    work('W-5'),
    release('W-10', ['W-2']),
    release('W-11', ['W-1', 'W-3']),
    release('W-12', ['W-1', 'W-4']),
    release('W-13', ['W-1', 'W-5']),
  ];
  const r = rank(items, { 'W-3': 10, 'W-4': 10, 'W-5': 10 });
  assert.equal(r.releases[0].id, 'W-10');
  assert.equal(r.ids[0], 'W-2');
  assert.deepEqual(r.keys.get('W-2'), {
    release: 'W-10',
    release_version: '1.0.W-10',
    release_tier: 0,
    feeds_decisions: 0,
    longest_path_tokens: 2,
    unblocks_in_tier: 1,
    releases_behind: 1,
    estimate_tokens: 1,
  });
  assert.equal(r.keys.get('W-1')?.releases_behind, 3);
  assert.ok(r.ids.indexOf('W-2') < r.ids.indexOf('W-1'));
  // Counting what each unblocks alone, as before the release chain, put X first.
  const sizes = new Map(
    r.ready.map((i) => [String(i.id), /** @type {any} */ ({ estimate_tokens: 1 })]),
  );
  assert.equal(
    String(orderQueue(r.ready, sizes, unblockCounts(/** @type {any[]} */ (items)))[0].id),
    'W-1',
  );
});

test('a hotfix and a feature release at the same layer: the one with fewer tokens left goes first', () => {
  const items = [
    work('W-1'),
    work('W-2'),
    work('W-3'),
    release('W-20', ['W-2', 'W-3']), // the feature: two heavy items
    release('W-21', ['W-1']), // the hotfix: one light item
  ];
  const r = rank(items, { 'W-1': 5000, 'W-2': 90000, 'W-3': 90000 });
  assert.deepEqual(
    r.releases.map((x) => [x.id, x.chain, x.remaining_tokens]),
    [
      ['W-21', 1, 5001],
      ['W-20', 1, 180001],
    ],
  );
  assert.equal(r.ids[0], 'W-1');
});

test('an item serving two releases takes the nearer tier and counts both releases once', () => {
  // W-31 needs W-30 and S, and W-30 needs S too: S is reached twice from W-31.
  const items = [
    work('W-1'), // S
    work('W-2'),
    release('W-30', ['W-1']),
    release('W-31', ['W-30', 'W-1', 'W-2']),
  ];
  const r = rank(items);
  assert.deepEqual(
    r.releases.map((x) => [x.id, x.chain]),
    [
      ['W-30', 1],
      ['W-31', 2],
    ],
  );
  const s = r.keys.get('W-1');
  assert.equal(s?.release, 'W-30');
  assert.equal(s?.release_tier, 0);
  assert.equal(s?.releases_behind, 2);
  // W-31's closure counts S's tokens once.
  assert.equal(r.releases[1].remaining_tokens, 1 + 1 + 1 + 1);
  assert.equal(r.keys.get('W-2')?.release_tier, 1);
  assert.deepEqual(r.ids, ['W-1', 'W-2']);
});

test("a milestone's constraints carry an item into the release that needs the milestone", () => {
  // The release needs milestone W-40; W-2 is its constraint through constraint_of. Counted by
  // item needs alone, W-2 would get no credit from the release.
  const items = [
    work('W-1'),
    work('W-2'),
    work('W-3', { needs: ['W-1'] }),
    milestone('W-40', ['W-2']),
    release('W-41', ['W-40']),
  ];
  const r = rank(items);
  assert.equal(r.keys.get('W-2')?.release, 'W-41');
  assert.equal(r.keys.get('W-1')?.release, null, 'W-1 serves no release');
  assert.deepEqual(r.ids, ['W-2', 'W-1']);
});

test('a cycle in the graph terminates', () => {
  const items = [
    work('W-1'),
    work('W-2', { needs: ['W-1', 'W-3'] }),
    work('W-3', { needs: ['W-2'] }),
    milestone('W-4', ['W-2', 'W-5']),
    { ...milestone('W-5', ['W-4']) },
    release('W-6', ['W-4', 'W-6']),
  ];
  const r = rank(items);
  assert.deepEqual(r.ids, ['W-1']);
  assert.equal(r.keys.get('W-1')?.release, 'W-6');
  assert.equal(r.releases[0].chain, 1);
});

test('with no open release item the order is the one before the release chain, minus priority', () => {
  const items = [
    work('W-1'),
    work('W-2', { priority: 'urgent' }),
    work('W-3'),
    work('W-4', { needs: ['W-1'] }),
    work('W-5', { needs: ['W-4'] }),
    work('W-6', { needs: ['W-3'] }),
    release('W-7', ['W-1'], { state: 'done' }),
  ];
  const r = rank(items, { 'W-2': 5, 'W-3': 9 });
  assert.deepEqual(r.releases, []);
  const sizes = new Map(
    r.ready.map((i) => [
      String(i.id),
      /** @type {any} */ ({ estimate_tokens: { 'W-2': 5, 'W-3': 9 }[String(i.id)] ?? 1 }),
    ]),
  );
  const before = orderQueue(r.ready, sizes, unblockCounts(/** @type {any[]} */ (items)));
  assert.deepEqual(
    r.ids,
    before.map((i) => String(i.id)),
  );
  assert.deepEqual(r.ids, ['W-1', 'W-3', 'W-2']);
  assert.deepEqual(
    [...r.critical],
    ['W-1'],
    'the critical path is the one before: the most unblocked',
  );
});

test('paths weigh estimated tokens: a heavy two-item chain outranks a light three-item chain', () => {
  const items = [
    work('W-1'),
    work('W-2', { needs: ['W-1'] }),
    work('W-3'),
    work('W-4', { needs: ['W-3'] }),
    work('W-5', { needs: ['W-4'] }),
    release('W-9', ['W-2', 'W-5']),
  ];
  const r = rank(items, { 'W-1': 100, 'W-2': 200000, 'W-3': 100, 'W-4': 1000, 'W-5': 1000 });
  assert.equal(r.keys.get('W-1')?.longest_path_tokens, 100 + 200000 + 1);
  assert.equal(r.keys.get('W-3')?.longest_path_tokens, 100 + 1000 + 1000 + 1);
  assert.ok(
    (r.keys.get('W-3')?.unblocks_in_tier ?? 0) > (r.keys.get('W-1')?.unblocks_in_tier ?? 0),
    'the light chain unblocks more items',
  );
  assert.deepEqual(r.ids, ['W-1', 'W-3']);
  assert.deepEqual([...r.critical], ['W-1'], 'the first tier’s longest path');
});

test('work that feeds two open owner decisions outranks work that feeds none', () => {
  const items = [
    work('W-1'),
    work('W-2'),
    { id: 'W-3', kind: 'decision', state: 'planned', decider: 'owner', needs: ['W-1'] },
    // W-4 needs W-3, so W-1 informs it too.
    { id: 'W-4', kind: 'decision', state: 'planned', decider: 'owner', needs: ['W-3'] },
    { id: 'W-5', kind: 'decision', state: 'done', decider: 'owner', needs: ['W-1'] },
    work('W-6', { needs: ['W-2'] }),
    release('W-9', ['W-1', 'W-6']),
  ];
  // W-2's chain is the longer one, so without the decisions it would go first.
  const r = rank(items, { 'W-2': 50000, 'W-6': 50000 });
  assert.equal(r.keys.get('W-1')?.feeds_decisions, 4, 'two owner decisions, each counting double');
  assert.equal(r.keys.get('W-2')?.feeds_decisions, 0);
  assert.ok(
    (r.keys.get('W-2')?.longest_path_tokens ?? 0) > (r.keys.get('W-1')?.longest_path_tokens ?? 0),
  );
  assert.deepEqual(r.ids, ['W-1', 'W-2']);
});

test('the release summary: the next release and its counts, a tier with nothing ready, and work outside every release', () => {
  const items = [
    work('W-1', { needs: ['W-2'] }), // blocked, in the nearest release
    work('W-2', { state: 'in-progress' }),
    work('W-3'), // awaiting merge, in the nearest release
    work('W-4'), // in the next release
    work('W-5', { created: '2026-11-01' }), // outside every release
    release('W-10', ['W-1', 'W-3']),
    release('W-11', ['W-10', 'W-4']),
  ];
  const ready = [items[3], items[4]];
  const weight = () => 1;
  const sizes = new Map(ready.map((i) => [i.id, /** @type {any} */ ({ estimate_tokens: 1 })]));
  const r = rankQueue({
    items: /** @type {any[]} */ (items),
    ready: /** @type {any[]} */ (ready),
    sizes,
    weight,
  });
  const s = releaseSummary(r, /** @type {any[]} */ (items), {
    ready: /** @type {any[]} */ (ready),
    awaiting: ['W-3'],
    now: Date.parse('2026-11-25T12:00:00Z'),
  });
  assert.deepEqual(s.next_release, {
    id: 'W-10',
    release: '1.0.W-10',
    title: 'W-10',
    chain: 1,
    remaining_tokens: 4,
    ready: 0,
    blocked: 2,
    awaiting_merge: 1,
    in_flight: 1,
  });
  assert.equal(
    s.note,
    'the next release W-10 (1.0.W-10) has nothing ready: 2 blocked, 1 awaiting merge, 1 in flight; the plan offers the next tier, W-11 (1.0.W-11)',
  );
  assert.deepEqual(s.outside_releases, [
    { id: 'W-5', title: 'W-5', created: '2026-11-01', waited_days: 24 },
  ]);
  assert.deepEqual(
    r.queue.map((i) => i.id),
    ['W-4', 'W-5'],
    'the next tier is offered, and work outside every release comes last',
  );
  assert.deepEqual([...r.critical], ['W-4'], 'the first tier with ready work');
  // With ready work in the nearest release, no note.
  const fine = releaseSummary(
    rankQueue({
      items: /** @type {any[]} */ (items),
      ready: /** @type {any[]} */ ([items[2]]),
      sizes,
      weight,
    }),
    /** @type {any[]} */ (items),
    { ready: /** @type {any[]} */ ([items[2]]) },
  );
  assert.equal(fine.note, undefined);
  assert.equal(fine.next_release?.ready, 1);
});

test('every open item weighs its sizing estimate: its own, else the tier default; a decision its own or 1', () => {
  const policy = { dispatch: { default_estimates: { 1: 50000, 2: 150000, 3: 400000 } } };
  const items = [
    work('W-1', { estimate_tokens: 1234 }),
    work('W-2'),
    { id: 'W-3', kind: 'decision', state: 'planned' },
    milestone('W-4', ['W-2']),
    work('W-5', { state: 'done' }),
  ];
  const w = weightsOf(/** @type {any[]} */ (items), policy);
  assert.deepEqual(['W-1', 'W-2', 'W-3', 'W-4', 'W-5'].map(w), [1234, 400000, 1, 0, 0]);
  const all = [...items, release('W-9', ['W-1', 'W-4'])];
  const chain = releaseChain(
    /** @type {any[]} */ (all),
    weightsOf(/** @type {any[]} */ (all), policy),
  );
  // W-1's own estimate, W-2 through the milestone, and the release item itself, each unplanned
  // item at the tier-3 default.
  assert.equal(chain[0].remaining_tokens, 1234 + 400000 + 400000);
});

test('critical path only falls back to the most unblocked when no open release holds a ready item', () => {
  // The release waits on W-3, which is in progress; W-1 and W-2 serve no release.
  const items = [
    work('W-1'),
    work('W-2'),
    work('W-3', { state: 'in-progress' }),
    work('W-4', { needs: ['W-2'] }),
    release('W-9', ['W-3']),
  ];
  const r = rank(items);
  assert.equal(r.releases.length, 1);
  assert.deepEqual(r.ids, ['W-2', 'W-1']);
  assert.deepEqual([...r.critical], ['W-2'], 'the rule with no release, not an empty set');
});

test('the views size an item as the queue does: a stored estimate, else the default for its tier, a text tier_override read as a number', () => {
  const policy = { dispatch: { default_estimates: { 1: 50000, 2: 150000, 3: 400000 } } };
  const weight = sizingWeight(policy);
  const node = (/** @type {Record<string, unknown>} */ data) =>
    /** @type {any} */ ({ data: { kind: 'work', state: 'planned', ...data }, body: '\nBody.\n' });
  // Front matter reads numbers as text.
  assert.equal(weight(node({ id: 'W-1', estimate_tokens: '1234' })), 1234);
  assert.equal(weight(node({ id: 'W-2' })), 400000, 'no plan: tier 3');
  assert.equal(weight(node({ id: 'W-3', tier_override: '1' })), 50000);
  assert.equal(weight(node({ id: 'W-4', kind: 'decision' })), 1);
});
