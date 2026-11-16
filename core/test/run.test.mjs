import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Killed, Killer, memoryStore } from './helpers/memory-store.mjs';
import { openStore } from '../lib/store/store.mjs';
import { createFakeAdapter, FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { inflight } from '../lib/ledger/inflight.mjs';
import { summary } from '../lib/ledger/summary.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { foldLedger, hashState } from '../lib/run/state.mjs';
import { STATE_KEY, listCheckpoints, loadState } from '../lib/run/checkpoint.mjs';
import { LeaseError } from '../lib/run/lease.mjs';
import { Run, rebuildRun, resumeRun, startRun, takeLease } from '../lib/run/run.mjs';
import { dispatchExecutor, recordCompletion, reportResult } from '../lib/run/protocol.mjs';
import { gitReality, gitSnapshot, worktreeSignal } from '../lib/run/reality.mjs';

const BASE = Date.parse('2026-11-14T03:00:00Z');
/** A clock that moves one second per reading, from an offset in seconds. @param {number} [offset] */
const clock = (offset = 0) => {
  let n = 0;
  return () => new Date(BASE + (offset + n++) * 1000);
};
const EXPIRY = 1800;
const A = { session: 's-1', host: 'example-laptop' };
const B = { session: 's-2', host: 'example-laptop' };

/** @param {Record<string, unknown>} [extra] */
const request = (extra = {}) => ({
  item: 'W-1',
  brief: 'Do W-1.',
  tier: /** @type {const} */ (2),
  role: 'executor',
  isolation: /** @type {const} */ ('worktree'),
  classification: /** @type {const} */ ('public'),
  ...extra,
});

/** The state as the ledger alone would give it, without what only a checkpoint knows. */
/** @param {Record<string, any>} state */
const derivable = (state) => {
  const { checkpoint: _c, lease: _l, controllers: _k, quotas: _q, ...rest } = state;
  return rest;
};

test('start: run-started goes to the ledger, then the first checkpoint, and the starter holds the lease', () => {
  const store = memoryStore();
  const run = startRun(store, {
    ...A,
    now: clock(),
    scope: { items: ['W-1'], max_executors: 3 },
    policyHash: 'a'.repeat(64),
  });
  const { events } = readLedger(store);
  assert.deepEqual(
    events.map((e) => e.event),
    ['run-started'],
  );
  assert.equal(run.state.run.id, '2026-11-14-1');
  assert.equal(run.state.run.policy_hash, 'a'.repeat(64));
  assert.equal(run.state.ledger_position, events[0].id);
  assert.deepEqual(run.state.lease.session, 's-1');
  assert.deepEqual(schemas().validateEntity('run-state', loadState(store).state), []);
  assert.equal(run.state.checkpoint.number, 1);
});

test('start refuses while the last run is active, unless replaced', () => {
  const store = memoryStore();
  startRun(store, { ...A, now: clock() });
  assert.throws(() => startRun(store, { ...B, now: clock(5) }), /still active/);
  const run = startRun(store, { ...B, now: clock(5), replace: true });
  assert.equal(run.state.run.id, '2026-11-14-2');
  // an expired lease with nothing in flight is not active
  assert.doesNotThrow(() => startRun(store, { ...A, now: clock(EXPIRY + 100) }));
});

test('every record appends to the ledger first, then writes a checkpoint', () => {
  const files = new Map();
  /** @type {string[]} */
  const order = [];
  const store = memoryStore(files);
  const spied = {
    ...store,
    append: (/** @type {string} */ k, /** @type {string} */ t) => (
      order.push(`append ${k}`),
      store.append(k, t)
    ),
    write: (/** @type {string} */ k, /** @type {string} */ t) => (
      order.push(`write ${k}`),
      store.write(k, t)
    ),
  };
  const run = startRun(spied, { ...A, now: clock() });
  order.length = 0;
  run.record({ event: 'dispatched', dispatch: 'D-1', item: 'W-1', role: 'executor', tier: 2 });
  assert.deepEqual(order, [
    'append ledger.jsonl',
    'write run/checkpoints/slot-2.json',
    'write run-state.json',
  ]);
  assert.equal(run.state.in_flight.length, 1);
  assert.equal(run.state.checkpoint.number, 2);
});

test('checkpoints chain by hash, and only the last `kept` are kept', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock(), kept: 3 });
  for (let i = 1; i <= 6; i++) run.record({ event: 'asked', decision: `W-${100 + i}` });
  const kept = listCheckpoints(store);
  assert.deepEqual(
    kept.map((c) => c.state.checkpoint.number),
    [7, 6, 5],
  );
  assert.equal(kept[0].state.checkpoint.prev_hash, hashState(kept[1].state));
  assert.equal(kept[1].state.checkpoint.prev_hash, hashState(kept[2].state));
  assert.equal(loadState(store).state?.checkpoint.number, 7);
});

test('the state is always the ledger folded to its position: rebuild gives the same state', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock(), scope: { items: ['W-1', 'W-2'] } });
  run.record({
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    role: 'executor',
    tier: 2,
    branch: 'hitld/W-1-a',
    host: 'example-laptop',
  });
  run.record({
    event: 'dispatched',
    dispatch: 'D-2',
    item: 'W-2',
    role: 'executor',
    tier: 1,
    serial_resources: ['gpu'],
  });
  run.record({
    event: 'started',
    dispatch: 'D-1',
    item: 'W-1',
    harness: 'fake',
    harness_ref: 'fake-1',
    host: 'example-laptop',
  });
  run.record({ event: 'asked', decision: 'W-50', dispatch: 'D-2' });
  run.record({ event: 'asked', decision: 'W-51' });
  run.record({ event: 'answered', decision: 'W-50' });
  run.record({ event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 10 });
  run.record({ event: 'verified', item: 'W-1', result: 'pass', branch: 'hitld/W-1-a' });
  run.record({ event: 'abandoned', dispatch: 'D-2', item: 'W-2' });
  const live = /** @type {Record<string, any>} */ (loadState(store).state);
  const rebuilt = foldLedger(readLedger(store).events);
  assert.deepEqual(derivable(rebuilt), derivable(live));
  assert.deepEqual(rebuilt.in_flight, inflight(store));
  assert.deepEqual(live.merge_queue.waiting, [{ item: 'W-1', branch: 'hitld/W-1-a' }]);
  assert.deepEqual(
    live.decisions_open.map((/** @type {any} */ q) => q.decision),
    ['W-51'],
  );
  assert.equal(live.decisions_answered.length, 1);
});

test('a lease that has not expired is not taken; an expired one is, and that is a ledger event', () => {
  const store = memoryStore();
  startRun(store, { ...A, now: clock() });
  assert.throws(
    () => takeLease(store, { ...B, now: clock(60), expirySeconds: EXPIRY }),
    (e) => e instanceof LeaseError && e.code === 'held' && e.holder?.session === 's-1',
  );
  assert.equal(readLedger(store).events.length, 1, 'a refused takeover writes nothing');

  const { run, tookOver } = takeLease(store, {
    ...B,
    now: clock(EXPIRY + 60),
    expirySeconds: EXPIRY,
  });
  assert.deepEqual(tookOver, {
    from: { session: 's-1', host: 'example-laptop' },
    reason: 'expired',
  });
  const events = readLedger(store).events;
  assert.deepEqual(
    events.map((e) => e.event),
    ['run-started', 'lease-taken'],
  );
  assert.equal(events[1].session, 's-2');
  assert.equal(run.state.lease.session, 's-2');
  assert.equal(run.state.ledger_position, events[1].id);
});

test('a takeover killed between its ledger event and its checkpoint is not repeated on retry', () => {
  const files = new Map();
  startRun(memoryStore(files), { ...A, now: clock() });
  const killer = new Killer(2); // effect 1 is the ledger append, effect 2 the checkpoint
  assert.throws(
    () =>
      takeLease(memoryStore(files, killer), {
        ...B,
        now: clock(EXPIRY + 60),
        expirySeconds: EXPIRY,
      }),
    Killed,
  );
  assert.deepEqual(
    readLedger(memoryStore(files)).events.map((e) => e.event),
    ['run-started', 'lease-taken'],
  );
  // the state still names the first session, but the retry sees its own takeover in the ledger
  assert.equal(loadState(memoryStore(files)).state?.lease.session, 's-1');
  const { run, tookOver } = takeLease(memoryStore(files), {
    ...B,
    now: clock(EXPIRY + 120),
    expirySeconds: EXPIRY,
  });
  assert.equal(tookOver, null);
  assert.equal(readLedger(memoryStore(files)).events.length, 2);
  assert.equal(run.state.lease.session, 's-2');
});

test('the owner can take the lease before it expires; a session that lost it cannot write', () => {
  const store = memoryStore();
  const first = startRun(store, { ...A, now: clock() });
  const { run: second, tookOver } = takeLease(store, {
    ...B,
    now: clock(10),
    expirySeconds: EXPIRY,
    force: true,
  });
  assert.equal(tookOver?.reason, 'owner');
  const before = readLedger(store).events.length;
  assert.throws(
    () => first.record({ event: 'asked', decision: 'W-1' }),
    (e) => e instanceof LeaseError && e.code === 'lost',
  );
  assert.throws(() => first.checkpoint(), LeaseError);
  assert.equal(readLedger(store).events.length, before, 'the stale session wrote nothing');
  assert.doesNotThrow(() => second.record({ event: 'asked', decision: 'W-1' }));
});

test('taking the lease again as the same session just renews it', () => {
  const store = memoryStore();
  startRun(store, { ...A, now: clock() });
  const { run, tookOver } = takeLease(store, { ...A, now: clock(100), expirySeconds: EXPIRY });
  assert.equal(tookOver, null);
  assert.equal(readLedger(store).events.length, 1);
  assert.equal(run.state.lease.renewed_at, new Date(BASE + 100 * 1000).toISOString());
});

test('a damaged run-state.json falls back to the newest checkpoint; a lost one is rebuilt', () => {
  const files = new Map();
  const store = memoryStore(files);
  const run = startRun(store, { ...A, now: clock() });
  run.record({ event: 'dispatched', dispatch: 'D-1', item: 'W-1', role: 'executor', tier: 2 });
  run.record({ event: 'asked', decision: 'W-7' });

  files.set(STATE_KEY, '{ not json');
  const loaded = loadState(store);
  assert.equal(loaded.source?.startsWith('run/checkpoints/'), true);
  assert.equal(loaded.state?.checkpoint.number, 3);
  // resuming works from the checkpoint
  assert.doesNotThrow(() => takeLease(store, { ...A, now: clock(5) }));

  for (const k of [...files.keys()]) if (k !== 'ledger.jsonl') files.delete(k);
  assert.equal(loadState(store).state, null);
  assert.throws(() => takeLease(store, { ...A, now: clock(5) }), /hitld run rebuild/);
  const rebuilt = rebuildRun(store, { now: clock(5) });
  assert.deepEqual(
    rebuilt.state.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-1'],
  );
  assert.deepEqual(
    rebuilt.state.decisions_open.map((/** @type {any} */ q) => q.decision),
    ['W-7'],
  );
  assert.equal(rebuilt.state.lease.session, 's-1', 'the lease comes from the ledger');
  assert.doesNotThrow(() => takeLease(store, { ...A, now: clock(5) }));
});

test('rebuild keeps what only the state knew (controllers, quotas) and says what changed', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  run.record({ event: 'asked', decision: 'W-7' });
  const state = structuredClone(/** @type {Record<string, any>} */ (loadState(store).state));
  state.controllers = { sizing: { step: 1 } };
  state.in_flight = [];
  state.decisions_open = []; // an edit the ledger disagrees with
  store.write(STATE_KEY, JSON.stringify(state));
  const r = rebuildRun(store);
  assert.deepEqual(r.state.controllers, { sizing: { step: 1 } });
  assert.deepEqual(r.previous.changed, ['decisions_open']);
});

test('rebuild cross-checks claim branches', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  run.record({
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    role: 'executor',
    tier: 2,
    branch: 'hitld/W-1-a',
  });
  const r = rebuildRun(store, { reality: { branches: () => ['main', 'hitld/W-9-stray'] } });
  assert.deepEqual(r.branches, { missing: ['D-1'], unrecorded: ['hitld/W-9-stray'] });
});

test('the report status line is read, and absent when there is none', () => {
  assert.equal(reportResult('item: W-1\nresult: partial\ncommit: abc1234'), 'partial');
  assert.equal(reportResult('Status: Done'), 'done');
  assert.equal(reportResult('all good!'), undefined);
});

// ---- kill and resume (design part 13.1, the eval) ------------------------------------------

const ITEMS = ['W-1', 'W-2', 'W-3'];

/**
 * The world outside the orchestrator: the disk, the harness and the executors, all of which
 * survive the orchestrator being killed.
 * @param {{ autoFinish: boolean }} options
 */
function makeWorld({ autoFinish }) {
  const files = new Map();
  const harness = createFakeAdapter({ capabilities: FAKE_PROFILES.full });
  /** @type {Map<string, import('../harness/interface.mjs').Completion>} */
  const mailbox = new Map();
  /** Every dispatch that reached the harness, in order. @type {{ dispatch: string, item: string }[]} */
  const started = [];
  const finish = (/** @type {string} */ dispatch) => {
    if (harness.inFlight().includes(dispatch)) {
      harness.complete(dispatch, {
        report: `item: ${dispatch}\nresult: done\ncommit: abc1234`,
        commit: 'abc1234',
        usage: { tokens: 100, toolCalls: 3, durationMs: 1000 },
      });
    }
  };
  /** The orchestrator's view of the harness, with a kill point before each real dispatch. @param {Killer} killer */
  const adapterFor = (killer) => ({
    ...harness,
    async dispatch(/** @type {any} */ request) {
      killer.tick();
      const handle = await harness.dispatch(request);
      started.push({ dispatch: request.dispatch, item: request.item });
      harness.onComplete(handle).then((c) => mailbox.set(request.dispatch, c));
      if (autoFinish) finish(request.dispatch);
      return handle;
    },
  });
  /** What a resuming orchestrator can ask the harness. */
  const reality = {
    harness: 'fake',
    live: () =>
      harness.inFlight().map((dispatch) => ({ dispatch, harness: 'fake', ref: `ref-${dispatch}` })),
    completed: () => [...mailbox.values()],
  };
  return { files, harness, mailbox, started, finish, adapterFor, reality };
}

/**
 * A small orchestrator: take each item through dispatch, completion, verification and merge, one
 * clean point at a time, deciding what to do next from the ledger alone.
 * @param {Run} run @param {any} adapter @param {ReturnType<typeof makeWorld>} world
 */
async function orchestrate(run, adapter, world) {
  for (let pass = 0; pass < 20; pass++) {
    let pending = 0;
    for (const item of ITEMS) {
      const events = readLedger(run.store).events.filter((e) => e.item === item);
      const last = events.findLast((e) =>
        [
          'merged',
          'verified',
          'reported',
          'abandoned',
          'unclaimed',
          'dispatched',
          'started',
        ].includes(e.event),
      );
      if (last?.event === 'merged') continue;
      pending++;
      if (!last || last.event === 'abandoned' || last.event === 'unclaimed') {
        await dispatchExecutor(run, adapter, request({ item, branch: `hitld/${item}-x` }), {
          worktree: `/wt/${item}`,
        });
      } else if (last.event === 'dispatched' || last.event === 'started') {
        const entry = run.state.in_flight.find((/** @type {any} */ d) => d.item === item);
        world.finish(entry.dispatch);
        await recordCompletion(run, adapter, {
          dispatch: entry.dispatch,
          harness: 'fake',
          ref: entry.harness_ref ?? '',
        });
      } else if (last.event === 'reported') {
        run.record({
          id: `verified-${item}`,
          event: 'verified',
          item,
          result: 'pass',
          branch: `hitld/${item}-x`,
        });
      } else if (last.event === 'verified') {
        run.record({ id: `merged-${item}`, event: 'merged', item, commit: 'abc1234' });
      }
    }
    if (!pending) return;
  }
  throw new Error('the fixture orchestrator did not finish');
}

/** The shape of a finished run, for comparing with an uninterrupted one. @param {import('../lib/store/store.mjs').PrivateStore} store */
function shape(store) {
  const { events } = readLedger(store);
  const abandoned = new Set(events.filter((e) => e.event === 'abandoned').map((e) => e.dispatch));
  /** @type {Record<string, string[]>} */
  const perItem = {};
  for (const e of events) {
    // `claimed` only records the harness's handle, which a crash can lose; the rest is the run.
    if (!['dispatched', 'reported', 'verified', 'merged'].includes(e.event)) continue;
    if (e.dispatch && abandoned.has(e.dispatch)) continue;
    (perItem[e.item] ??= []).push(e.event);
  }
  const s = summary(store);
  return { perItem, accepted: s.items_accepted, tokens: s.tokens_per_accepted_item.total };
}

/** Run the fixture to the end with no kill. @param {boolean} autoFinish */
async function uninterrupted(autoFinish) {
  const world = makeWorld({ autoFinish });
  const store = memoryStore(world.files);
  const run = startRun(store, { ...A, now: clock(), scope: { items: ITEMS } });
  await orchestrate(run, world.adapterFor(new Killer()), world);
  return { world, store, shape: shape(store) };
}

/**
 * Session 1 starts the run and works until killed at effect `k`. Then fresh sessions resume the
 * run, each killed in turn at the given effects, until one finishes it.
 * @param {boolean} autoFinish @param {number} k @param {number[]} resumeKills
 */
async function killAndResume(autoFinish, k, resumeKills) {
  const world = makeWorld({ autoFinish });
  const killer = new Killer(k);
  let killed = false;
  try {
    const store = memoryStore(world.files, killer);
    const run = startRun(store, { ...A, now: clock(), scope: { items: ITEMS } });
    await orchestrate(run, world.adapterFor(killer), world);
  } catch (e) {
    if (!(e instanceof Killed)) throw e;
    killed = true;
  }
  if (!killed) return { world, killed, store: memoryStore(world.files) };

  // Later sessions, each a day after the last, so the lease has expired.
  let session = 2;
  for (const kill of [...resumeKills, Infinity]) {
    const killer2 = new Killer(kill);
    const store = memoryStore(world.files, killer2);
    const who = { session: `s-${session}`, host: 'example-laptop' };
    const now = clock(session * 86400);
    try {
      if (!loadState(store).state) {
        if (readLedger(store).events.some((e) => e.event === 'run-started')) {
          rebuildRun(store, { now });
        } else {
          startRun(store, { ...who, now, scope: { items: ITEMS } });
        }
      }
      const resumed = await resumeRun(store, {
        ...who,
        now,
        expirySeconds: EXPIRY,
        reality: world.reality,
      });
      await orchestrate(resumed.run, world.adapterFor(killer2), world);
      return { world, killed, store: memoryStore(world.files) };
    } catch (e) {
      if (!(e instanceof Killed)) throw e;
      session++;
    }
  }
  throw new Error('unreachable');
}

/**
 * What must hold when a run has finished, however it was interrupted.
 * @param {Awaited<ReturnType<typeof uninterrupted>>['shape']} reference
 * @param {{ world: ReturnType<typeof makeWorld>, store: import('../lib/store/store.mjs').PrivateStore }} done
 * @param {string} label
 */
function assertFinishedLikeUninterrupted(reference, done, label) {
  const { events, problems } = readLedger(done.store);
  assert.deepEqual(problems, [], label);
  // no lost dispatch: every item merged, exactly once
  for (const item of ITEMS) {
    assert.equal(
      events.filter((e) => e.event === 'merged' && e.item === item).length,
      1,
      `${label}: ${item} merged once`,
    );
  }
  // no duplicated dispatch: one executor was ever started per item
  assert.deepEqual(
    done.world.started.map((s) => s.item).sort(),
    ITEMS,
    `${label}: one executor started per item`,
  );
  // the same ledger as an uninterrupted run, apart from abandoned attempts that never started
  assert.deepEqual(shape(done.store), reference, `${label}: same ledger shape`);
  // nothing left in flight; the state is the ledger folded
  assert.deepEqual(inflight(done.store), [], label);
  const state = loadState(done.store).state;
  assert.deepEqual(state?.in_flight, [], label);
  assert.equal(
    state?.ledger_position,
    events.at(-1)?.id,
    `${label}: state caught up with the ledger`,
  );
  assert.deepEqual(derivable(/** @type {any} */ (state)), derivable(foldLedger(events)), label);
  // IDs are unique
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, label);
  const dispatches = events.filter((e) => e.event === 'dispatched').map((e) => e.dispatch);
  assert.equal(new Set(dispatches).size, dispatches.length, label);
}

for (const autoFinish of [true, false]) {
  const mode = autoFinish ? 'executors finish at once' : 'executors still running';

  test(`kill and resume: killed before every effect of the run (${mode}), nothing lost or duplicated`, async () => {
    const reference = await uninterrupted(autoFinish);
    // count the effects of an uninterrupted session 1
    const world = makeWorld({ autoFinish });
    const counter = new Killer();
    const store = memoryStore(world.files, counter);
    const run = startRun(store, { ...A, now: clock(), scope: { items: ITEMS } });
    await orchestrate(run, world.adapterFor(counter), world);
    const total = counter.count;
    assert.ok(total > 30, `expected many kill points, got ${total}`);

    for (let k = 1; k <= total; k++) {
      const done = await killAndResume(autoFinish, k, []);
      assert.ok(done.killed, `kill ${k} fired`);
      assertFinishedLikeUninterrupted(reference.shape, done, `killed before effect ${k}/${total}`);
    }
  });

  test(`kill and resume: killed again while resuming (${mode})`, async () => {
    const reference = await uninterrupted(autoFinish);
    // Kill the first session at a spread of points, then kill the resumers at every effect they have.
    for (const k of [3, 9, 14, 20, 27]) {
      for (let j = 1; j < 40; j++) {
        const done = await killAndResume(autoFinish, k, [j]);
        assertFinishedLikeUninterrupted(
          reference.shape,
          done,
          `killed at ${k}, then at ${j} in resume`,
        );
      }
    }
  });
}

test('kill and resume: a kill between a ledger append and its checkpoint resumes without loss or repeat', async () => {
  const world = makeWorld({ autoFinish: false });
  const killer = new Killer();
  const store = memoryStore(world.files, killer);
  const run = startRun(store, { ...A, now: clock() });
  const adapter = world.adapterFor(killer);
  // kill after the `dispatched` ledger append, before its checkpoint: effect 1 of the next record
  // is the ledger append, effect 2 the slot write.
  killer.count = 0;
  killer.at = 2;
  await assert.rejects(
    () => dispatchExecutor(run, adapter, request(), { worktree: '/wt/W-1' }),
    Killed,
  );
  const persisted = loadState(memoryStore(world.files)).state;
  const ledger = readLedger(memoryStore(world.files)).events;
  assert.equal(ledger.at(-1)?.event, 'dispatched', 'the ledger has the event');
  assert.notEqual(persisted?.ledger_position, ledger.at(-1)?.id, 'the checkpoint does not');
  assert.deepEqual(persisted?.in_flight, []);

  // The fresh session finds it by replaying the ledger after the position. The harness never
  // heard of it, so it is abandoned and its item released, not left dangling.
  const resumed = await resumeRun(memoryStore(world.files), {
    ...B,
    now: clock(EXPIRY + 10),
    expirySeconds: EXPIRY,
    reality: world.reality,
  });
  assert.deepEqual(resumed.abandoned, ['D-1']);
  assert.deepEqual(resumed.unclaimed_items, ['W-1']);
  assert.equal(world.started.length, 0, 'the harness was never called');
  const events = readLedger(memoryStore(world.files)).events.map((e) => e.event);
  assert.deepEqual(events, ['run-started', 'dispatched', 'lease-taken', 'abandoned', 'unclaimed']);
});

test('kill and resume: an executor started but not yet on file is adopted, not started again', async () => {
  const world = makeWorld({ autoFinish: false });
  const killer = new Killer();
  const store = memoryStore(world.files, killer);
  const run = startRun(store, { ...A, now: clock() });
  const adapter = world.adapterFor(killer);
  // effects of dispatchExecutor: 1 append dispatched, 2 slot, 3 state, 4 harness call, 5 append claimed
  killer.count = 0;
  killer.at = 5;
  await assert.rejects(() => dispatchExecutor(run, adapter, request(), {}), Killed);
  assert.equal(world.started.length, 1, 'the executor is running');

  const resumed = await resumeRun(memoryStore(world.files), {
    ...B,
    now: clock(EXPIRY + 10),
    expirySeconds: EXPIRY,
    reality: world.reality,
  });
  assert.deepEqual(resumed.adopted, ['D-1']);
  assert.deepEqual(resumed.abandoned, []);
  assert.equal(
    resumed.run.state.in_flight[0].harness_ref,
    'ref-D-1',
    'its harness_ref is recorded on adoption',
  );
  assert.equal(world.started.length, 1, 'no second executor');
});

test('resume: a completion that arrived while no orchestrator ran is recorded; foreign and follow-up work is left alone', async () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  for (const [d, item, host] of [
    ['D-1', 'W-1', 'example-laptop'],
    ['D-2', 'W-2', 'example-laptop'],
    ['D-3', 'W-3', 'other-box'],
    ['D-4', 'W-4', 'example-laptop'],
  ]) {
    run.record({ event: 'dispatched', dispatch: d, item, role: 'executor', tier: 2, host });
  }
  const r = await resumeRun(store, {
    ...B,
    now: clock(EXPIRY + 10),
    expirySeconds: EXPIRY,
    reality: {
      live: () => [],
      completed: () => [
        {
          dispatch: 'D-1',
          report: 'status: partial',
          commit: 'abc1234',
          usage: { tokens: 42, toolCalls: 1, durationMs: 5 },
        },
      ],
      hasCommits: (d) => d.dispatch === 'D-4',
    },
  });
  assert.deepEqual(r.reported, ['D-1']);
  assert.deepEqual(r.abandoned, ['D-2']);
  assert.deepEqual(
    r.foreign.map((d) => d.dispatch),
    ['D-3'],
  );
  assert.deepEqual(
    r.follow_up.map((d) => d.dispatch),
    ['D-4'],
  );
  assert.deepEqual(
    r.run.state.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-3', 'D-4'],
  );
  const reported = readLedger(store).events.find((e) => e.event === 'reported');
  assert.deepEqual(
    [reported?.result, reported?.tokens, reported?.commit],
    ['partial', 42, 'abc1234'],
  );
  assert.match(
    r.handover.text,
    /In flight \(2\): D-3 W-3 executor on other-box \(no harness_ref yet\); D-4 W-4/,
  );
});

test('resume: without a view of the harness nothing is called dead', async () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  run.record({
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    role: 'executor',
    tier: 2,
    host: 'example-laptop',
  });
  const r = await resumeRun(store, { ...B, now: clock(EXPIRY + 10), expirySeconds: EXPIRY });
  assert.deepEqual(r.unverified, ['D-1']);
  assert.deepEqual(r.abandoned, []);
});

test('the harness refusing a dispatch ends it in the ledger', async () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  const adapter = createFakeAdapter({ capabilities: FAKE_PROFILES.minimal });
  await dispatchExecutor(run, adapter, request(), {});
  await assert.rejects(
    () => dispatchExecutor(run, adapter, request({ item: 'W-2' }), {}),
    /parallel_subagents/,
  );
  const events = readLedger(store).events;
  assert.deepEqual(
    events.slice(-2).map((e) => [e.event, e.dispatch]),
    [
      ['dispatched', 'D-2'],
      ['abandoned', 'D-2'],
    ],
  );
  assert.deepEqual(
    run.state.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-1'],
  );
});

test('the same run works on a real directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-run-'));
  const store = openStore(dir);
  const run = startRun(store, { ...A, scope: { items: ['W-1'] } });
  const adapter = createFakeAdapter({
    respond: () => ({
      report: 'status: done',
      commit: 'abc1234',
      usage: { tokens: 5, toolCalls: 1, durationMs: 2 },
    }),
  });
  const handle = await dispatchExecutor(run, adapter, request(), {});
  await recordCompletion(run, adapter, handle);
  assert.deepEqual(inflight(store), []);
  assert.deepEqual(summary(store).ledger_problems, []);
  assert.ok(store.list().includes('run-state.json'));
  assert.ok(store.list('run/checkpoints/').length >= 1);
});

test('git reality counts commits past the main branch it is given, not a fixed main', () => {
  const root = mkdtempSync(join(tmpdir(), 'hitld-reality-'));
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'hitld/W-1-work');
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  git('checkout', '-q', 'trunk');
  const entry = /** @type {any} */ ({ dispatch: 'D-1', branch: 'hitld/W-1-work' });
  assert.equal(gitReality({ cwd: root, mainBranch: 'trunk' }).hasCommits?.(entry), true);
  // The fallback main does not exist here, so nothing can be counted against it.
  assert.equal(gitReality({ cwd: root }).hasCommits?.(entry), false);
});

test('one git snapshot serves the worktree signal of every dispatch, as git in each would', () => {
  const root = mkdtempSync(join(tmpdir(), 'hitld-reality-'));
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  // D-1: a worktree on its branch, two commits ahead, one file changed
  const wt = join(mkdtempSync(join(tmpdir(), 'hitld-reality-wt-')), 'D-1');
  git(root, 'worktree', 'add', '-q', '-b', 'hitld/W-1-one', wt, 'main');
  for (const n of ['b', 'c']) {
    writeFileSync(join(wt, `${n}.txt`), `${n}\n`);
    git(wt, 'add', '.');
    git(wt, 'commit', '-q', '-m', n);
  }
  writeFileSync(join(wt, 'b.txt'), 'changed\n');
  // D-2: a branch with no worktree, one commit ahead
  git(root, 'branch', 'hitld/W-2-two', 'main');
  git(root, 'switch', '-q', 'hitld/W-2-two');
  writeFileSync(join(root, 'd.txt'), 'd\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'd');
  git(root, 'switch', '-q', 'main');

  const snapshot = gitSnapshot({ cwd: root, mainBranch: 'main' });
  /** @param {Record<string, any>} entry */
  const signal = (entry) =>
    worktreeSignal(/** @type {any} */ (entry), { cwd: root, mainBranch: 'main', snapshot });
  const byBranch = signal({ dispatch: 'D-1', branch: 'hitld/W-1-one' });
  const recorded = signal({ dispatch: 'D-1', branch: 'hitld/W-1-one', worktree: wt });
  for (const s of [byBranch, recorded]) {
    assert.equal(s?.head, git(wt, 'rev-parse', 'HEAD'));
    assert.equal(s?.commits, 2);
    assert.equal(s?.dirty, 1);
  }
  assert.deepEqual(signal({ dispatch: 'D-2', branch: 'hitld/W-2-two' }), {
    source: 'worktree',
    head: git(root, 'rev-parse', 'hitld/W-2-two'),
    commits: 1,
  });
  assert.equal(signal({ dispatch: 'D-3', branch: 'hitld/W-3-none' }), null);
  assert.equal(signal({ dispatch: 'D-4' }), null);
  // Without a snapshot each call takes its own look, with the same answer.
  assert.deepEqual(
    worktreeSignal(/** @type {any} */ ({ dispatch: 'D-1', branch: 'hitld/W-1-one' }), {
      cwd: root,
    }),
    byBranch,
  );
  git(root, 'worktree', 'remove', '--force', wt);
});
