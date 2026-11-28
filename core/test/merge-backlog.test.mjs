// The merge backlog as a limit on starting work (HITLD-1046): finished branches split by what each
// waits on, with the oldest of each; with the owner's queue full, work that does not route to the
// owner is offered first in its tier; with one full batch waiting on the merge queue, starts hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backlogHoldText,
  backlogJson,
  mergeBacklog,
  ownerQueueOrder,
  touchesRouteToOwner,
} from '../lib/dispatch/backlog.mjs';
import { BACKLOG_REASON, planDispatch } from '../lib/dispatch/plan.mjs';
import { CAPABILITIES } from '../harness/claude-code/capabilities.mjs';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-28T12:00:00Z');
const ago = (/** @type {number} */ h) => new Date(NOW - h * HOUR).toISOString();

/** Owner mode holding everything but the tracker, as a project's policy might. */
const OWNER = {
  merge: { mode: 'owner', owner_paths: ['core/**'], owner_areas: [], batch_max: 4 },
  dispatch: { owner_queue_max: 2 },
};

/** @param {string} item @param {number} hours @param {Record<string, unknown>} [extra] */
const entry = (item, hours, extra = {}) => ({
  item,
  branch: `b/${item}`,
  since: ago(hours),
  ...extra,
});

/** What each branch changes, by item. @type {Record<string, string[]>} */
const CHANGED = {
  'W-1': ['core/a.mjs'],
  'W-2': ['docs/a.md'],
  'W-3': ['docs/b.md'],
  'W-4': ['core/b.mjs'],
  'W-5': ['docs/c.md'],
  'W-6': ['docs/d.md'],
};
const changed = (/** @type {{ item: string }} */ a) => CHANGED[a.item] ?? null;

test('the backlog splits finished branches by what they wait on, with the oldest of each and its age', () => {
  /** @type {any} */
  const pulls = {
    schema_version: 1,
    branches: {
      // An owner branch the owner approved: it waits on the merge queue now.
      'b/W-4': {
        item: 'W-4',
        number: 4,
        url: 'u',
        head: 'h',
        since: ago(9),
        updates: [],
        approval: { head: 'h' },
      },
      // A pull request open, not presented: its checks have not let it merge yet.
      'b/W-2': { item: 'W-2', number: 2, url: 'u', head: 'h', since: ago(3), updates: [] },
      'b/W-1': { item: 'W-1', number: 1, url: 'u', head: 'h', since: ago(5), updates: [] },
    },
    presented: {
      at: ago(1),
      branches: [{ item: 'W-1', branch: 'b/W-1', changed: ['core/a.mjs'] }],
    },
  };
  const awaiting = [
    entry('W-1', 5), // presented to the owner
    entry('W-2', 3), // checks
    entry('W-3', 2), // no pull request yet, routed past the owner: merge queue
    entry('W-4', 9), // approved: merge queue
    entry('W-5', 7, { sent_back: true }), // sent back: checks
    entry('W-7', 4), // git cannot tell what it changes: waits on the owner
  ];
  const b = mergeBacklog(awaiting, { policy: OWNER, pulls, changed, now: NOW });
  assert.equal(b.total, 6);
  assert.deepEqual(b.owner.items, ['W-1', 'W-7']);
  assert.deepEqual(b.checks.items, ['W-2', 'W-5']);
  assert.deepEqual(b.merge_queue.items, ['W-3', 'W-4']);
  // The oldest of each, from each item's since.
  assert.equal(b.owner.oldest, 'W-1');
  assert.equal(b.owner.oldest_waited_ms, 5 * HOUR);
  assert.equal(b.checks.oldest, 'W-5');
  assert.equal(b.checks.oldest_waited_ms, 7 * HOUR);
  assert.equal(b.merge_queue.oldest, 'W-4');
  assert.equal(b.merge_queue.oldest_since, ago(9));
  const shown = backlogJson(b);
  assert.equal(shown.merge_queue.oldest_waited, '9 h');
  assert.equal(shown.owner.oldest_waited, '5 h');
  // Two on the owner meets dispatch.owner_queue_max 2.
  assert.equal(b.owner_queue_full, true);

  // Outside owner mode nothing waits on the owner.
  const queueMode = mergeBacklog(awaiting, {
    policy: { merge: { mode: 'queue', batch_max: 4 } },
    changed,
    now: NOW,
  });
  assert.equal(queueMode.owner.count, 0);
  assert.equal(queueMode.checks.count, 1, 'only the branch sent back');
  assert.equal(queueMode.merge_queue.count, 5);

  // Nothing waiting: empty parts, no age.
  const none = mergeBacklog([], { policy: OWNER, now: NOW });
  assert.equal(none.owner.oldest_waited_ms, null);
  assert.equal(backlogJson(none).owner.oldest_waited, null);
  assert.equal(none.owner_queue_full, false);
});

test('starts hold at one full batch waiting on the merge queue; an owner-held branch does not count', () => {
  const at = (/** @type {number} */ n, /** @type {number} */ owner) => {
    const awaiting = [
      ...['W-2', 'W-3', 'W-5', 'W-6'].slice(0, n).map((id, k) => entry(id, k + 1)),
      ...['W-1', 'W-4'].slice(0, owner).map((id) => entry(id, 1)),
    ];
    if (n > 4) awaiting.push(entry('W-8', 1));
    return mergeBacklog(awaiting, {
      policy: OWNER,
      changed: (a) => CHANGED[a.item] ?? ['docs/x.md'],
      now: NOW,
    });
  };
  const below = at(3, 2);
  assert.equal(below.queue_held, 3);
  assert.equal(below.owner.count, 2);
  assert.equal(below.hold, false, 'three below a batch of four, with two owner-held not counted');
  const exactly = at(4, 0);
  assert.equal(exactly.queue_held, 4);
  assert.equal(exactly.hold, true);
  const above = at(5, 2);
  assert.equal(above.queue_held, 5);
  assert.equal(above.hold, true);
  assert.match(
    backlogHoldText(exactly),
    /4 finished branches wait on the merge queue .*merge\.batch_max 4, one full batch/,
  );
  assert.match(backlogHoldText(above), /2 waiting on the owner do not count/);

  // The plan holds every dispatched start, names the hold and the count, and lets a merge fix by.
  /** @param {string} id @param {0 | 1} tier */
  const sizing = (id, tier) => ({
    item: id,
    tier,
    reasons: [],
    runs_as: /** @type {const} */ ('background'),
    model: 'small',
    effort: 'medium',
    estimate_tokens: 1000,
    estimate_source: /** @type {const} */ ('default'),
    areas: [],
    owner_review: null,
  });
  const sizes = new Map([
    ['W-10', sizing('W-10', 1)],
    ['W-11', sizing('W-11', 1)],
    ['W-12', sizing('W-12', 0)],
  ]);
  const queue = [
    { id: 'W-10', classification: 'public' },
    { id: 'W-11', classification: 'public' },
    { id: 'W-12', classification: 'public' },
  ];
  const base = {
    queue,
    sizes,
    running: [],
    cap: 4,
    capabilities: CAPABILITIES,
    gate: () => ({ mode: 'normal', allow: true, reason: 'ok' }),
  };
  const why = backlogHoldText(exactly);
  const held = planDispatch({ ...base, backlog: { hold: true, why } });
  assert.deepEqual(held.start, []);
  assert.deepEqual(
    held.held.map((h) => [h.item, h.reason]),
    [
      ['W-10', BACKLOG_REASON],
      ['W-11', BACKLOG_REASON],
    ],
  );
  assert.equal(held.held[0].why, why);
  assert.deepEqual(
    held.inline.map((s) => s.item),
    ['W-12'],
    'tier-0 work is not a start',
  );
  assert.ok(held.notes.some((n) => n === `starts hold for the merge backlog: ${why}`));
  const free = planDispatch({ ...base, backlog: { hold: false, why: backlogHoldText(below) } });
  assert.deepEqual(
    free.start.map((s) => s.item),
    ['W-10', 'W-11'],
  );
  const fix = planDispatch({
    ...base,
    queue: [queue[0]],
    mergeFix: true,
    backlog: { hold: true, why },
  });
  assert.deepEqual(
    fix.start.map((s) => s.item),
    ['W-10'],
    'the item that fixes a stuck merge still starts',
  );
});

test('with the owner queue full, work that does not route to the owner goes first in its tier', () => {
  const ready = [
    { id: 'W-20', touches: ['core/x.mjs'], path: 'work/items/W-20.md' },
    { id: 'W-21', touches: ['docs/**'], path: 'work/items/W-21.md' },
    { id: 'W-22', touches: ['core/lib/**'], path: 'work/items/W-22.md' },
    { id: 'W-23', touches: ['docs/y.md'], path: 'work/items/W-23.md' },
    { id: 'W-24', touches: [], path: 'work/items/W-24.md' },
  ];
  /** @type {Record<string, number | null>} two tiers, then one outside every release */
  const tier = { 'W-20': 0, 'W-21': 0, 'W-22': 1, 'W-23': 1, 'W-24': null };
  const toOwner = (/** @type {any} */ i) => touchesRouteToOwner(i.touches, i.path, OWNER);
  assert.equal(toOwner(ready[0]), true);
  assert.equal(toOwner(ready[1]), false);
  assert.equal(toOwner(ready[4]), true, 'no touches: what it changes is not known');
  assert.equal(touchesRouteToOwner(['core/x.mjs'], undefined, { merge: { mode: 'queue' } }), false);

  const full = mergeBacklog([entry('W-1', 2), entry('W-4', 1)], {
    policy: OWNER,
    changed,
    now: NOW,
  });
  assert.equal(full.owner_queue_full, true);
  const reordered = ownerQueueOrder(ready, full, (id) => tier[id] ?? null, toOwner);
  assert.deepEqual(
    reordered.queue.map((i) => i.id),
    ['W-21', 'W-20', 'W-23', 'W-22', 'W-24'],
    'each tier keeps its place; only inside a tier does owner work move back',
  );
  assert.deepEqual(reordered.deferred, ['W-20', 'W-22']);
  assert.match(
    String(reordered.note),
    /^2 finished branches wait on the owner \(dispatch\.owner_queue_max 2\): in each tier, work that does not route to the owner is offered first, so W-20, W-22 go after it/,
  );

  // An empty owner queue changes nothing and says nothing.
  const empty = mergeBacklog([], { policy: OWNER, now: NOW });
  const same = ownerQueueOrder(ready, empty, (id) => tier[id] ?? null, toOwner);
  assert.deepEqual(
    same.queue.map((i) => i.id),
    ready.map((i) => i.id),
  );
  assert.deepEqual(same.deferred, []);
  assert.equal(same.note, null);
});
