// The machine locks' decision core (HITLD-1051): a model checker that drives every interleaving
// of three actors over two resources to a fixed depth on a fake clock and checks the invariants
// in every state it reaches, and the review's failures replayed as traces through the model. The
// same traces run through the file-system shell in lock-traces.test.mjs.
//
// The depth-12 run takes asks, asks again, polls, renewals, releases by a handle, leaving the
// queue, crashes, reused pids, TTL ticks and clock jumps either way. A lock file an older copy is
// still writing, and a release by name, are explored in a second run to depth 8 (with them depth 12
// takes about two minutes), on the single lock only (see `steps`), and by the traces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  nextTicket,
  parseTicket,
  sameProcess,
  sameStart,
  staleReason,
  ticketGone,
  ticketName,
} from '../lib/env/lockcore.mjs';
import {
  TRACES,
  brokenInvariant,
  brokenProgress,
  expected,
  initialWorld,
  runStep,
  runTraceInModel,
} from './helpers/lock-model.mjs';

/**
 * @typedef {import('./helpers/lock-model.mjs').Model} Model
 * @typedef {import('./helpers/lock-model.mjs').World} World
 * @typedef {import('./helpers/lock-model.mjs').Step} Step
 */

/**
 * Three actors: a and b share a holder name from two processes (as the merge queue's callers
 * did before HITLD-1052), c is heavier, and its start time cannot be read, so its liveness cannot
 * be checked and its expiry is the limit (a and b, whose can, are never revoked by the clock).
 * A process that reuses b's pid is one whose identity cannot be read: b's record then stands
 * only until its expiry, never for good. r0 is taken whole (the single lock); r1 has a capacity of 2. Each actor
 * works on one resource at a time: ordering several resources is left to rc.3 (acquireAll).
 * @type {Model}
 */
const MODEL = {
  actors: [
    { id: 'a', name: 'D-X', pid: 101, weight: 1 },
    { id: 'b', name: 'D-X', pid: 102, weight: 1, reusedHidden: true },
    { id: 'c', name: 'D-Y', pid: 103, weight: 2, noStart: true },
  ],
  capacity: { r0: 1, r1: 2 },
  ttlMs: 12_000,
};
/** A TTL tick, and a clock jump either way: past the TTL and the pid-reuse window. */
const TICK = 5_000;
const JUMP = 15_000;
const DEPTH = Number(process.env.HITLD_LOCK_MODEL_DEPTH ?? 12);
const MORE_DEPTH = Number(process.env.HITLD_LOCK_MODEL_MORE_DEPTH ?? 8);
/**
 * Faults allowed on one path: none counted by default. A deeper run (HITLD_LOCK_MODEL_DEPTH) can
 * bound them (HITLD_LOCK_MODEL_FAULTS) to stay tractable.
 */
const FAULT_BUDGET = Number(process.env.HITLD_LOCK_MODEL_FAULTS ?? Infinity);

/**
 * Every step that may come next. `more` adds a lock file an older copy is still writing and a
 * release by name, in a second, shallower run: with them the space at depth 12 is about a
 * million states and takes about two minutes.
 * @param {Model} m @param {boolean} more @returns {Step[]}
 */
function steps(m, more) {
  /** @type {Step[]} */
  const out = [
    { do: 'clock', ms: TICK },
    { do: 'clock', ms: JUMP },
    { do: 'clock', ms: -JUMP },
  ];
  // An older copy that creates the lock file and has not yet written it: on r0 only. On a resource
  // with a capacity above 1, an unreadable lock file gone stale is passed over but not removed by a
  // weighted admission, and a clock that jumps back makes it count again beside the holders it let
  // in (half-written on r1, clock +15 s, a asks r1, clock -15 s: live weights 3 of 2). That is left
  // to a follow-up item with the other mixed-capacity cases; the traces cover the half-written file.
  if (more) out.push({ do: 'halfWritten', r: 'r0' });
  for (const a of m.actors) {
    for (const r of Object.keys(m.capacity)) {
      out.push(
        { do: 'ask', actor: a.id, r, wait: true },
        { do: 'ask', actor: a.id, r, wait: false },
      );
    }
    // As the command line and the manager release: by the name alone, on r0, where a and b's
    // shared name meets the single lock.
    if (more) out.push({ do: 'releaseByName', actor: a.id, r: 'r0' });
    out.push(
      { do: 'poll', actor: a.id },
      { do: 'renew', actor: a.id },
      { do: 'release', actor: a.id },
      { do: 'leave', actor: a.id },
      { do: 'crash', actor: a.id },
      { do: 'reuse', actor: a.id },
    );
  }
  return out;
}

/**
 * A world's key for deduplication: two worlds with one key behave alike for every property
 * checked. Times are taken relative to now. A ticket is known by its waiter and its place, not
 * its number: a new ticket always goes last, so only the order of tickets decides anything. When
 * a hold was acquired is left out: it only picks which holder a refusal names. A record's expiry
 * is its renewal plus the TTL, so the renewal stands for both.
 * @param {World} w
 */
function keyOf(w) {
  const rel = (/** @type {string} */ iso) => Date.parse(iso) - w.now;
  const who = (/** @type {string} */ name) => name.slice(16);
  /** @type {unknown[]} */
  const files = [];
  for (const [r, f] of Object.entries(w.files)) {
    const slots = [f.single, ...Object.values(f.holders)]
      .filter((s) => s !== null)
      .map((s) =>
        s.record
          ? [
              s.slot,
              s.record.holder,
              s.record.pid,
              s.record.start,
              s.record.weight ?? 0,
              rel(s.record.renewed_at),
            ]
          : [s.slot, null, s.mtime - w.now],
      )
      .sort();
    const queue = Object.values(f.queue)
      .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1))
      .map((t) => who(t.name));
    files.push([r, slots, queue]);
  }
  const actors = Object.entries(w.actors).map(([id, a]) => [
    id,
    a.crashed,
    a.reused,
    a.at ? [a.at.r, a.at.mode, a.at.ticket && who(a.at.ticket), a.at.weight] : null,
  ]);
  return JSON.stringify([w.procs, actors, files]);
}

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** The steps that are the world's faults rather than the actors' work. */
const FAULTS = new Set(['crash', 'reuse', 'halfWritten']);
/** @param {Step} s */
const isFault = (s) => FAULTS.has(s.do) || (s.do === 'clock' && s.ms !== TICK);

/**
 * Explore breadth-first to `depth`, with at most `faults` faults (a crash, a reused pid, a clock
 * jump either way) on any path; actors' steps and TTL ticks are not counted. A world reached
 * again with no fewer faults spent is not explored again.
 * @param {number} depth @param {number} faults @param {boolean} [more] the steps `steps` adds
 */
function explore(depth, faults, more = false) {
  const all = steps(MODEL, more);
  const start = deepFreeze(initialWorld(MODEL));
  let frontier = [{ world: start, spent: 0, path: /** @type {Step[]} */ ([]) }];
  /** @type {Map<string, number>} fewest faults a world was reached with */
  const seen = new Map([[keyOf(start), 0]]);
  let transitions = 0;
  const kinds = new Set();
  for (let d = 0; d < depth && frontier.length; d++) {
    /** @type {typeof frontier} */
    const next = [];
    for (const { world, spent, path } of frontier) {
      for (const s of all) {
        const cost = spent + (isFault(s) ? 1 : 0);
        if (cost > faults) continue;
        // A decision must not change the state it was given: the worlds are frozen.
        const r = runStep(MODEL, world, s);
        if (!r) continue;
        transitions++;
        kinds.add(`${s.do}:${r.result}`);
        const key = keyOf(r.world);
        const before = seen.get(key);
        if (before !== undefined && before <= cost) continue;
        const fresh = before === undefined;
        seen.set(key, cost);
        const w = deepFreeze(r.world);
        const at = [...path, s];
        if (fresh) {
          const broken = brokenInvariant(MODEL, w) ?? brokenProgress(MODEL, w);
          if (broken) {
            assert.fail(`${broken}\nafter: ${at.map((x) => JSON.stringify(x)).join('\n  ')}`);
          }
        }
        next.push({ world: w, spent: cost, path: at });
      }
    }
    frontier = next;
    if (process.env.HITLD_LOCK_MODEL_DEPTH) console.log(`depth ${d + 1}: ${seen.size} states`);
  }
  return { states: seen.size, transitions, kinds };
}

/** @param {Set<string>} kinds */
function assertCoverage(kinds) {
  // The search reached what it is meant to: grants, renewals, waits, conflicts and reaping.
  for (const k of [
    'ask:granted',
    'ask:renewed',
    'ask:queued',
    'ask:conflict',
    'ask:refused',
    'poll:granted',
    'release:released',
    'renew:lost',
    'reuse:ok',
  ]) {
    assert.ok(kinds.has(k), `the search never saw ${k}`);
  }
}

test(`every interleaving of three actors over two resources to depth ${DEPTH} keeps the invariants`, () => {
  const r = explore(DEPTH, FAULT_BUDGET);
  assertCoverage(r.kinds);
  if (DEPTH >= 12 && FAULT_BUDGET === Infinity) {
    assert.ok(r.states > 100_000, `${r.states} states, ${r.transitions} transitions`);
  }
});

test(`with a lock file being written and a release by name, to depth ${MORE_DEPTH}, the invariants hold`, () => {
  const r = explore(MORE_DEPTH, FAULT_BUDGET, true);
  assertCoverage(r.kinds);
  for (const k of ['halfWritten:ok', 'releaseByName:released', 'releaseByName:kept']) {
    assert.ok(r.kinds.has(k), `the search never saw ${k}`);
  }
});

for (const t of TRACES) {
  test(`trace in the model: ${t.name}`, () => {
    const got = runTraceInModel(t);
    assert.deepEqual(got.results, expected(t));
    assert.equal(got.holder, t.holder ?? null);
  });
}

test('tickets are numbered by a counter that never goes backwards', () => {
  const q = [parseTicket(ticketName(5_000, 'aa', 1)), parseTicket(ticketName(7_000, 'bb', 2))];
  assert.equal(nextTicket(q, 1_000), 7_001, 'a clock behind the last ticket');
  assert.equal(nextTicket(q, 9_000), 9_000, 'a clock ahead of it');
  assert.equal(nextTicket([], 1_000), 1_000);
  assert.deepEqual(parseTicket(ticketName(42, 'cc', 77)), {
    name: '000000000000042.cc.77.t',
    n: 42,
    pid: 77,
  });
});

test("a waiter's first ask writes its ticket before its attempt, in one decision", () => {
  const procs = { 1: { alive: true, start: 's1' }, 2: { alive: true, start: 's2' } };
  const now = Date.parse('2026-01-01T00:00:00Z');
  const held = {
    resource: 'gpu',
    holder: 'D-1',
    pid: 1,
    pid_start: 's1',
    host: 'h',
    acquired_at: new Date(now).toISOString(),
    renewed_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const state = {
    resource: 'gpu',
    capacity: 1,
    now,
    host: 'h',
    procs,
    single: { slot: 'single', record: held, mtime: now },
    holders: [],
    queue: [],
  };
  const d = decide(state, {
    type: 'ask',
    holder: 'D-2',
    pid: 2,
    self: 2,
    weight: 1,
    wait: true,
    ticket: null,
    ttlMs: 60_000,
    nonce: 'n',
    token: 't',
  });
  assert.equal(d.outcome.kind, 'queued');
  assert.deepEqual(
    d.effects.map((e) => e.op),
    ['enqueue'],
  );
  // The state given is unchanged.
  assert.equal(state.queue.length, 0);
});

test('identity: this copy compares start, an older copy pid_start only to keep a hold, never to end it', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const iso = (/** @type {number} */ t) => new Date(t).toISOString();
  // Expired and renewed long ago, so the identity is what decides.
  const base = {
    resource: 'gpu',
    holder: 'D-1',
    pid: 7,
    host: 'h',
    acquired_at: iso(now - 60_000),
    renewed_at: iso(now - 60_000),
    expires_at: iso(now - 1_000),
  };
  /** @param {object} record @param {object} proc */
  const judge = (record, proc) =>
    staleReason(
      { slot: 'single', record: /** @type {any} */ (record), mtime: now },
      { now, host: 'h', boot: 'b', procs: { 7: { alive: true, ...proc } } },
    );
  const ours = { ...base, pid_start: 'Mon 09:00', start: 'tick:100', boot: 'b', v: 2 };
  assert.equal(judge(ours, { start: 'tick:100' }), null, 'the very one: kept past its expiry');
  assert.match(String(judge(ours, { start: 'tick:200' })), /reused/, 'another process');
  // The lookup itself failed this time (no `start` at all): a passing fault revokes nothing.
  assert.equal(judge(ours, {}), null, 'a failed lookup keeps a verified live holder');
  // A reused pid whose identity cannot be read (another user's, hidden by /proc): not verified,
  // so the expiry applies, and before it the hold stands; never a hold for good.
  assert.match(String(judge(ours, { start: null })), /liveness cannot be checked/);
  const unexpired = { ...ours, expires_at: iso(now + 60_000) };
  assert.equal(judge(unexpired, { start: null }), null, 'held until its expiry');
  // Another kind of identity (a `tick:` record, a `utc:` reading): not verified either.
  assert.match(String(judge(ours, { start: 'utc:Mon 14:00' })), /liveness cannot be checked/);
  assert.equal(judge(unexpired, { start: 'utc:Mon 14:00' }), null);
  // A pid_start that differs (another caller's time zone) never ends this copy's record.
  assert.equal(judge(ours, { start: 'tick:100', legacy: 'Mon 04:00' }), null);
  const older = { ...base, pid_start: 'Mon 09:00' };
  assert.equal(judge(older, { legacy: 'Mon 09:00' }), null, "an older copy's record, matching");
  assert.match(
    String(judge(older, { legacy: 'Mon 04:00' })),
    /liveness cannot be checked/,
    'a mismatch falls to the expiry, never "reused"',
  );
  assert.equal(
    judge({ ...older, expires_at: iso(now + 60_000) }, { legacy: 'Mon 04:00' }),
    null,
    'and before its expiry it holds',
  );
  assert.equal(sameStart('tick:1', 'tick:1'), true);
  assert.equal(sameStart('tick:1', 'tick:2'), false);
  assert.equal(sameStart('tick:1', 'utc:x'), null);
  assert.equal(sameStart(null, 'tick:1'), null);
  // Tickets: this copy's by start; an older copy's by its pid alone.
  const procs = { 9: { alive: true, start: 'tick:5' } };
  const t = { name: 'x', n: 1, pid: 9 };
  assert.equal(ticketGone({ ...t, start: 'tick:6', v: 2 }, { procs }), true, 'reads as another');
  assert.equal(ticketGone({ ...t, start: 'tick:5', v: 2 }, { procs }), false, 'its waiter');
  // A ticket has no expiry: one whose waiter cannot be verified would hold the line for good.
  assert.equal(ticketGone({ ...t, start: 'utc:y', v: 2 }, { procs }), true, 'another kind');
  const hidden = { 9: { alive: true, start: null } };
  assert.equal(ticketGone({ ...t, start: 'tick:5', v: 2 }, { procs: hidden }), true, 'unreadable');
  const failed = { 9: { alive: true } };
  assert.equal(
    ticketGone({ ...t, start: 'tick:5', v: 2 }, { procs: failed }),
    false,
    'lookup failed',
  );
  assert.equal(ticketGone(t, { procs }), false, "an older copy's ticket, by its pid");
  // sameProcess: only a readable identity on both sides that differs says another process; when
  // either side's is unreadable or absent, host, pid and boot decide.
  const host = { host: 'h', boot: 'b' };
  assert.equal(sameProcess(ours, { pid: 7, start: 'tick:100' }, host), true);
  assert.equal(sameProcess(ours, { pid: 7, start: 'tick:200' }, host), false, 'another process');
  assert.equal(sameProcess(ours, { pid: 7, start: 'utc:x' }, host), false, 'another kind');
  assert.equal(sameProcess(ours, { pid: 7, start: null }, host), true, 'the caller unreadable');
  assert.equal(sameProcess(ours, { pid: 7 }, host), true, "the caller's absent");
  assert.equal(sameProcess({ ...ours, start: null }, { pid: 7, start: 'tick:100' }, host), true);
  assert.equal(sameProcess({ ...ours, start: null }, { pid: 7, start: null }, host), true);
  assert.equal(sameProcess(older, { pid: 7, start: 'tick:100' }, host), true, 'an older record');
  // Host, pid and boot still decide.
  assert.equal(sameProcess({ ...ours, start: null }, { pid: 8, start: null }, host), false);
  assert.equal(sameProcess({ ...ours, start: null }, { pid: 7 }, { host: 'g', boot: 'b' }), false);
  assert.equal(sameProcess({ ...ours, start: null }, { pid: 7 }, { host: 'h', boot: 'c' }), false);
});

test('a caller whose identity cannot be read re-locks and releases by name; a readable other is refused', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const iso = (/** @type {number} */ t) => new Date(t).toISOString();
  /** @param {string | null} start @returns {any} */
  const rec = (start) => ({
    resource: 'gpu',
    holder: 'D-1',
    pid: 7,
    pid_start: null,
    start,
    host: 'h',
    acquired_at: iso(now - 1_000),
    renewed_at: iso(now - 1_000),
    expires_at: iso(now + 60_000),
    token: 'tok',
    boot: 'b',
    v: 2,
  });
  /** @param {any} record @param {string | null | undefined} live the pid's identity now */
  const state = (record, live) => ({
    resource: 'gpu',
    capacity: 1,
    now,
    host: 'h',
    boot: 'b',
    procs: { 7: { alive: true, ...(live === undefined ? {} : { start: live }) } },
    single: { slot: 'single', record, mtime: now },
    holders: [],
    queue: [],
  });
  /** @param {string | null} start */
  const ask = (start) =>
    /** @type {const} */ ({
      type: 'ask',
      holder: 'D-1',
      pid: 7,
      start,
      self: 7,
      selfStart: start,
      weight: 1,
      wait: false,
      ticket: null,
      ttlMs: 60_000,
      nonce: 'n',
      token: 'new',
    });
  /** @param {string | null} start */
  const release = (start) =>
    /** @type {const} */ ({ type: 'release', holder: 'D-1', pid: 7, start, self: 9 });
  /** @param {any} d */
  const shape = (d) => [d.outcome.kind, d.outcome.renewed ?? null];

  // Written by a caller whose identity could not be read, asked again by it: renewed, token kept.
  const hidden = decide(state(rec(null), null), ask(null));
  assert.deepEqual(shape(hidden), ['granted', true]);
  assert.equal(hidden.outcome.kind === 'granted' && hidden.outcome.record.token, 'tok');
  assert.equal(hidden.outcome.kind === 'granted' && hidden.outcome.record.start, null);
  // Either side unreadable is enough.
  assert.deepEqual(shape(decide(state(rec(null), 'tick:1'), ask('tick:1'))), ['granted', true]);
  assert.deepEqual(shape(decide(state(rec('tick:1'), 'tick:1'), ask(null))), ['granted', true]);
  // Released by name for that pid, either side unreadable.
  for (const [r, c] of /** @type {const} */ ([
    [null, null],
    [null, 'tick:1'],
    ['tick:1', null],
  ])) {
    const d = decide(state(rec(r), c), release(c));
    assert.equal(d.outcome.kind, 'released', `record ${r}, caller ${c}`);
    assert.deepEqual(
      d.effects.map((e) => e.op),
      ['remove', 'log'],
    );
  }
  // A readable identity on both sides that differs: refused, and the hold stays. Another kind
  // (`utc:` against `tick:`) is not verified as the holder either, so the expiry is its limit.
  const other = decide(state(rec('utc:x'), 'utc:x'), ask('tick:2'));
  assert.deepEqual(
    [other.outcome.kind, other.outcome.kind === 'refused' && other.outcome.conflict],
    ['refused', true],
  );
  const kept = decide(state(rec('utc:x'), 'utc:x'), release('tick:2'));
  assert.equal(kept.outcome.kind, 'kept');
  assert.equal(kept.outcome.kind === 'kept' && kept.outcome.by?.pid, 7);
  // Fresh, that is still refused; renewed long ago, the same kind that differs is a reused pid:
  // stale, so the caller takes the name over, as a new grant.
  assert.equal(decide(state(rec('tick:1'), 'tick:2'), ask('tick:2')).outcome.kind, 'refused');
  const old = { ...rec('tick:1'), renewed_at: iso(now - 600_000) };
  const reused = decide(state(old, 'tick:2'), ask('tick:2'));
  assert.deepEqual(shape(reused), ['granted', false]);
  assert.equal(reused.outcome.kind === 'granted' && reused.outcome.record.token, 'new');
});
