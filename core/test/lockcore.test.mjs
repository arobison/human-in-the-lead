// The machine locks' decision core (HITLD-1051): a model checker that drives every interleaving
// of three actors over two resources to a fixed depth on a fake clock and checks the invariants
// in every state it reaches, and the review's failures replayed as traces through the model. The
// same traces run through the file-system shell in lock-traces.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, nextTicket, parseTicket, ticketName } from '../lib/env/lockcore.mjs';
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
 * do), c is heavier. r0 is taken whole (the single lock); r1 has a capacity of 2. Each actor
 * works on one resource at a time: ordering several resources is left to rc.3 (acquireAll).
 * @type {Model}
 */
const MODEL = {
  actors: [
    { id: 'a', name: 'D-X', pid: 101, weight: 1 },
    { id: 'b', name: 'D-X', pid: 102, weight: 1 },
    { id: 'c', name: 'D-Y', pid: 103, weight: 2 },
  ],
  capacity: { r0: 1, r1: 2 },
  ttlMs: 12_000,
};
/** A TTL tick, and a clock jump either way: past the TTL and the pid-reuse window. */
const TICK = 5_000;
const JUMP = 15_000;
const DEPTH = Number(process.env.HITLD_LOCK_MODEL_DEPTH ?? 12);
/**
 * Faults allowed on one path: none counted by default. A deeper run (HITLD_LOCK_MODEL_DEPTH) can
 * bound them (HITLD_LOCK_MODEL_FAULTS) to stay tractable.
 */
const FAULT_BUDGET = Number(process.env.HITLD_LOCK_MODEL_FAULTS ?? Infinity);

/** @param {Model} m @returns {Step[]} every step that may come next */
function steps(m) {
  /** @type {Step[]} */
  const out = [
    { do: 'clock', ms: TICK },
    { do: 'clock', ms: JUMP },
    { do: 'clock', ms: -JUMP },
  ];
  for (const a of m.actors) {
    for (const r of Object.keys(m.capacity)) {
      out.push(
        { do: 'ask', actor: a.id, r, wait: true },
        { do: 'ask', actor: a.id, r, wait: false },
      );
    }
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
              s.record.pid_start,
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
const FAULTS = new Set(['crash', 'reuse']);
/** @param {Step} s */
const isFault = (s) => FAULTS.has(s.do) || (s.do === 'clock' && s.ms !== TICK);

/**
 * Explore breadth-first to `depth`, with at most `faults` faults (a crash, a reused pid, a clock
 * jump either way) on any path; actors' steps and TTL ticks are not counted. A world reached
 * again with no fewer faults spent is not explored again.
 * @param {number} depth @param {number} faults
 */
function explore(depth, faults) {
  const all = steps(MODEL);
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
    pidStart: 's2',
    self: 2,
    weight: 1,
    wait: true,
    ticket: null,
    ttlMs: 60_000,
    nonce: 'n',
  });
  assert.equal(d.outcome.kind, 'queued');
  assert.deepEqual(
    d.effects.map((e) => e.op),
    ['enqueue'],
  );
  // The state given is unchanged.
  assert.equal(state.queue.length, 0);
});
