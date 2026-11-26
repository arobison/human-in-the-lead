// A model of the machine locks for the model checker (lockcore.test.mjs) and the traces that
// replay the review's failures (lock-traces.test.mjs): the files are plain objects, the clock is a
// number and the processes are a table, and every decision is lockcore's `decide`, the same
// function the file-system shell calls. Nothing here reads a file, a clock or a process.

import { SINGLE, decide, holderSlot } from '../../lib/env/lockcore.mjs';

export const HOST = 'model-host';
/** The model machine's boot: every process in it belongs to this one. */
export const BOOT = 'model-boot';
/** The model's clock starts here: a real date, so the records' times are real ISO strings. */
export const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * @typedef {import('../../lib/env/lockcore.mjs').LockState} LockState
 * @typedef {import('../../lib/env/lockcore.mjs').LockEvent} LockEvent
 * @typedef {import('../../lib/env/lockcore.mjs').LockRecord} LockRecord
 * @typedef {import('../../lib/env/lockcore.mjs').Slot} Slot
 * @typedef {import('../../lib/env/lockcore.mjs').Ticket} Ticket
 * @typedef {import('../../lib/env/lockcore.mjs').Effect} Effect
 * @typedef {import('../../lib/env/lockcore.mjs').Outcome} Outcome
 *
 * @typedef {{ id: string, name: string, pid: number, weight: number, noStart?: boolean,
 *   reusedHidden?: boolean }} ActorSpec `reusedHidden`: the process that reuses its pid is one whose
 *   identity cannot be read (another user's, or hidden by /proc)
 *   `noStart`: its process's start time cannot be read, so its liveness cannot be checked and its
 *   expiry is the limit
 * @typedef {{ r: string, mode: 'held' | 'waiting', ticket: string | null, weight: number | null,
 *   token: string | null }} At
 * @typedef {{ crashed: boolean, reused: boolean, at: At | null }} ActorState
 * @typedef {{ single: Slot | null, holders: Record<string, Slot>, queue: Record<string, Ticket> }} Files
 * @typedef {{ now: number, procs: Record<number, { alive: boolean, start: string | null }>,
 *   files: Record<string, Files>, actors: Record<string, ActorState> }} World
 * @typedef {{ actors: ActorSpec[], capacity: Record<string, number>, ttlMs: number }} Model
 */

/**
 * The start time an actor's own process has, null when it cannot be read; a process that reuses
 * its pid has another.
 */
export const startOf = (/** @type {ActorSpec} */ a) => (a.noStart ? null : `start-${a.id}`);
/** The token an actor's grants carry: one actor holds one grant at a time. */
export const tokenOf = (/** @type {ActorSpec} */ a) => `tok-${a.id}`;

/** @param {Model} m @returns {World} */
export function initialWorld(m) {
  /** @type {World} */
  const w = { now: EPOCH, procs: {}, files: {}, actors: {} };
  for (const a of m.actors) {
    w.procs[a.pid] = { alive: true, start: startOf(a) };
    w.actors[a.id] = { crashed: false, reused: false, at: null };
  }
  for (const r of Object.keys(m.capacity)) w.files[r] = { single: null, holders: {}, queue: {} };
  return w;
}

/**
 * What `decide` sees of one resource, as the shell reads it: with every process's start time.
 * @param {Model} m @param {World} w @param {string} r @returns {LockState}
 */
export function stateOf(m, w, r) {
  const f = w.files[r];
  return {
    resource: r,
    capacity: m.capacity[r],
    now: w.now,
    host: HOST,
    boot: BOOT,
    single: f.single,
    holders: Object.values(f.holders),
    queue: Object.values(f.queue),
    procs: w.procs,
  };
}

/**
 * Apply a decision's changes to a copy of the world, as the shell applies them to the files.
 * @param {World} w @param {string} r @param {Effect[]} effects @returns {World}
 */
export function applyEffects(w, r, effects) {
  const f = w.files[r];
  /** @type {Files} */
  const next = { single: f.single, holders: { ...f.holders }, queue: { ...f.queue } };
  for (const e of effects) {
    if (e.op === 'create') {
      if (next.single) throw new Error('an exclusive create found the lock file there');
      next.single = { slot: SINGLE, record: e.record, mtime: w.now };
    } else if (e.op === 'write') {
      const slot = { slot: e.slot, record: e.record, mtime: w.now };
      if (e.slot === SINGLE) next.single = slot;
      else next.holders[e.slot] = slot;
    } else if (e.op === 'remove') {
      if (e.slot === SINGLE) next.single = null;
      else delete next.holders[e.slot];
    } else if (e.op === 'enqueue') next.queue[e.ticket.name] = e.ticket;
    else if (e.op === 'dequeue') delete next.queue[e.name];
  }
  return { ...w, files: { ...w.files, [r]: next } };
}

/**
 * An actor's ask, as acquireLock makes it.
 * @param {Model} m @param {ActorSpec} a @param {string} r @param {boolean} wait
 * @param {string | null} ticket @returns {Extract<LockEvent, { type: 'ask' }>}
 */
export const askEvent = (m, a, r, wait, ticket) => ({
  type: 'ask',
  holder: a.name,
  pid: a.pid,
  pidStart: startOf(a),
  start: startOf(a),
  self: a.pid,
  selfStart: startOf(a),
  weight: m.capacity[r] > 1 ? a.weight : 1,
  wait,
  ticket,
  ttlMs: m.ttlMs,
  nonce: a.id,
  token: tokenOf(a),
});

/**
 * Decide an ask and apply it, confirming a weighted grant, as the shell's step does.
 * @param {Model} m @param {World} w @param {string} r @param {Extract<LockEvent, { type: 'ask' }>} ev
 * @returns {{ world: World, outcome: Outcome }}
 */
export function runAsk(m, w, r, ev) {
  const d = decide(stateOf(m, w, r), ev);
  let world = applyEffects(w, r, d.effects);
  let outcome = d.outcome;
  if (outcome.kind === 'granted' && outcome.confirm) {
    const enq = d.effects.find((e) => e.op === 'enqueue');
    const ticket = enq && enq.op === 'enqueue' ? enq.ticket.name : ev.ticket;
    const c = decide(stateOf(m, world, r), {
      type: 'confirm',
      holder: ev.holder,
      pid: ev.pid,
      pidStart: ev.pidStart,
      start: ev.start,
      wait: ev.wait,
      ticket,
    });
    world = applyEffects(world, r, c.effects);
    outcome = c.outcome;
  }
  return { world, outcome };
}

/** @param {World} w @param {string} id @param {ActorState} s @returns {World} */
const setActor = (w, id, s) => ({ ...w, actors: { ...w.actors, [id]: s } });

/**
 * One step of an actor or of the world. Returns the next world and the outcome's name, or null
 * when the step does not apply in this world.
 * @typedef {{ do: 'ask', actor: string, r: string, wait?: boolean }
 *   | { do: 'poll', actor: string }
 *   | { do: 'renew', actor: string }
 *   | { do: 'release', actor: string }
 *   | { do: 'releaseByName', actor: string, r: string }
 *   | { do: 'leave', actor: string }
 *   | { do: 'crash', actor: string }
 *   | { do: 'reuse', actor: string }
 *   | { do: 'clock', ms: number }
 *   | { do: 'halfWritten', r: string }} Step
 * @param {Model} m @param {World} w @param {Step} s
 * @returns {{ world: World, result: string } | null}
 */
export function runStep(m, w, s) {
  if (s.do === 'clock') return { world: { ...w, now: w.now + s.ms }, result: 'ok' };
  if (s.do === 'halfWritten') {
    // An older copy creates the lock file only when it is not there (an exclusive open) and it has
    // seen no live weighted holder; one that finds such a holder after creating it backs out.
    const f = w.files[s.r];
    if (f.single || Object.values(f.holders).some((h) => live(w, h))) return null;
    const single = { slot: SINGLE, record: null, mtime: w.now };
    return { world: { ...w, files: { ...w.files, [s.r]: { ...f, single } } }, result: 'ok' };
  }
  const a = /** @type {ActorSpec} */ (m.actors.find((x) => x.id === s.actor));
  const st = w.actors[a.id];
  if (s.do === 'reuse') {
    if (!st.crashed || st.reused) return null;
    const procs = {
      ...w.procs,
      [a.pid]: { alive: true, start: a.noStart || a.reusedHidden ? null : `reused-${a.id}` },
    };
    return { world: setActor({ ...w, procs }, a.id, { ...st, reused: true }), result: 'ok' };
  }
  if (st.crashed) return null;
  if (s.do === 'crash') {
    const procs = { ...w.procs, [a.pid]: { alive: false, start: startOf(a) } };
    return {
      world: setActor({ ...w, procs }, a.id, { crashed: true, reused: false, at: null }),
      result: 'ok',
    };
  }
  if (s.do === 'ask' || s.do === 'poll') {
    let r, wait, ticket;
    if (s.do === 'ask') {
      // A new ask, or a holder's ask again; never while waiting, and one resource at a time.
      if (st.at?.mode === 'waiting' || (st.at && st.at.r !== s.r)) return null;
      r = s.r;
      wait = s.wait ?? false;
      ticket = null;
    } else {
      if (st.at?.mode !== 'waiting') return null;
      r = st.at.r;
      wait = true;
      ticket = st.at.ticket;
    }
    const { world, outcome } = runAsk(m, w, r, askEvent(m, a, r, wait, ticket));
    /** @type {At | null} */
    let at = null;
    if (outcome.kind === 'granted') {
      at = {
        r,
        mode: 'held',
        ticket: null,
        weight: outcome.record.weight ?? null,
        token: outcome.record.token ?? null,
      };
    } else if (outcome.kind === 'queued') {
      at = { r, mode: 'waiting', ticket: outcome.ticket, weight: null, token: null };
    }
    return { world: setActor(world, a.id, { ...st, at }), result: resultOf(outcome) };
  }
  if (s.do === 'renew') {
    if (st.at?.mode !== 'held') return null;
    const d = decide(stateOf(m, w, st.at.r), {
      type: 'renew',
      holder: a.name,
      token: /** @type {string} */ (st.at.token),
      ttlMs: m.ttlMs,
      weight: st.at.weight,
    });
    return { world: applyEffects(w, st.at.r, d.effects), result: resultOf(d.outcome) };
  }
  if (s.do === 'release' || s.do === 'releaseByName') {
    const r = s.do === 'release' ? st.at?.r : s.r;
    if (!r || (s.do === 'release' && st.at?.mode !== 'held')) return null;
    /** @type {LockEvent} */
    const ev =
      s.do === 'release'
        ? { type: 'release', holder: a.name, token: /** @type {string} */ (st.at?.token) }
        : { type: 'release', holder: a.name, force: true };
    const d = decide(stateOf(m, w, r), ev);
    const world = applyEffects(w, r, d.effects);
    // A forced release by name (the command line's --force, the watchdog) is done to the holder,
    // which still has its handle: a stale one now, whose release must remove nothing.
    return {
      world: s.do === 'releaseByName' ? world : setActor(world, a.id, { ...st, at: null }),
      result: resultOf(d.outcome),
    };
  }
  if (s.do === 'leave') {
    if (st.at?.mode !== 'waiting') return null;
    const d = decide(stateOf(m, w, st.at.r), {
      type: 'leave',
      ticket: /** @type {string} */ (st.at.ticket),
    });
    return {
      world: setActor(applyEffects(w, st.at.r, d.effects), a.id, { ...st, at: null }),
      result: resultOf(d.outcome),
    };
  }
  return null;
}

/**
 * An outcome's name, as both the model and the file-system shell report it.
 * @param {Outcome} o
 */
export function resultOf(o) {
  if (o.kind === 'granted') return o.renewed ? 'renewed' : 'granted';
  if (o.kind === 'refused') return o.conflict ? 'conflict' : 'refused';
  return o.kind;
}

// ---------------------------------------------------------------------------------------------
// The invariants, judged without lockcore: what is live is worked out here again from the records,
// the clock and the process table.

const PID_CHECK_MS = 10_000;
const GRACE_MS = 1_000;

/**
 * Whether a record file holds a live hold now.
 * @param {World} w @param {Slot} sl
 */
export function live(w, sl) {
  const r = sl.record;
  if (!r) return Math.abs(w.now - sl.mtime) <= GRACE_MS;
  const p = w.procs[r.pid];
  if (!p?.alive) return false;
  const expired = Date.parse(r.expires_at) < w.now;
  if (!expired && w.now - Date.parse(r.renewed_at) <= PID_CHECK_MS) return true;
  // Past that, a process that can be told to be the very one holds, expired or not; one that
  // cannot be told holds until its expiry.
  // This copy's records (the model writes no other kind) compare `start`: a verified holder ends
  // only when its process reads as another one.
  if (r.start) {
    // Nothing looked up this time: it stands. Read as itself, or as another: decided. Not
    // readable: not verified, so its expiry is the limit.
    if (p.start === undefined) return true;
    if (p.start !== null) return p.start === r.start;
    return !expired;
  }
  return !expired;
}

/**
 * The actor a record or ticket belongs to: same pid, and its own process (not one that reused it).
 * @param {Model} m @param {World} w @param {number} pid @param {string | null | undefined} start
 */
function actorOf(m, w, pid, start) {
  const a = m.actors.find((x) => x.pid === pid);
  if (!a || w.actors[a.id].crashed) return null;
  if (start !== undefined && start !== null && start !== startOf(a)) return null;
  return a;
}

/**
 * The tickets whose waiter lives: its process alive, and the very one when both start times are
 * known (a process that reused a dead waiter's pid does not wait).
 * @param {World} w @param {string} r @returns {Ticket[]}
 */
const liveTickets = (w, r) =>
  Object.values(w.files[r].queue)
    .filter((t) => {
      const p = w.procs[t.pid];
      // A ticket with an identity is its waiter's only while the process reads as that waiter.
      return !!p?.alive && !(t.start && p.start !== undefined && p.start !== t.start);
    })
    .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1));

/**
 * The live weights on a resource; a single lock fills it.
 * @param {Model} m @param {World} w @param {string} r @param {(sl: Slot) => boolean} [skip]
 */
function used(m, w, r, skip = () => false) {
  const f = w.files[r];
  let n = 0;
  if (f.single && live(w, f.single) && !skip(f.single)) n += m.capacity[r];
  for (const h of Object.values(f.holders)) {
    if (live(w, h) && !skip(h))
      n += Number.isInteger(h.record?.weight) ? Number(h.record?.weight) : 1;
  }
  return n;
}

/**
 * Check the state invariants; returns the first broken one, described, or null.
 * @param {Model} m @param {World} w @returns {string | null}
 */
export function brokenInvariant(m, w) {
  for (const r of Object.keys(m.capacity)) {
    const f = w.files[r];
    // The sum of live weights never exceeds the capacity.
    if (used(m, w, r) > m.capacity[r])
      return `${r}: live weights ${used(m, w, r)} > ${m.capacity[r]}`;
    const slots = [f.single, ...Object.values(f.holders)].filter((s) => s !== null);
    const holders = new Set(
      slots
        .filter((sl) => sl.record && live(w, sl))
        .map((sl) => actorOf(m, w, /** @type {LockRecord} */ (sl.record).pid, sl.record?.start)?.id)
        .filter((x) => x !== undefined),
    );
    const tickets = liveTickets(w, r);
    // No ghost in line: a live ticket whose waiter's start time is known is that waiter's, and
    // it is waiting on it.
    for (const t of tickets) {
      if (!t.start) continue;
      const a = actorOf(m, w, t.pid, t.start);
      if (!a || w.actors[a.id].at?.ticket !== t.name) return `${r}: ghost ticket ${t.name}`;
    }
    const waiters = tickets.map((t) => actorOf(m, w, t.pid, undefined)?.id ?? null);
    // No waiter waits on a holder that is itself waiting: no live holder has a ticket too.
    for (const id of waiters) if (id && holders.has(id)) return `${r}: ${id} holds and waits`;
    // No wait-for cycle: a waiter waits for the live holders and the waiters ahead of it.
    /** @type {Map<string, Set<string>>} */
    const edges = new Map();
    waiters.forEach((id, i) => {
      if (!id) return;
      const to = new Set([...holders].filter((h) => h !== id));
      for (const ahead of waiters.slice(0, i)) if (ahead && ahead !== id) to.add(ahead);
      edges.set(id, /** @type {Set<string>} */ (to));
    });
    const cycle = findCycle(edges);
    if (cycle) return `${r}: wait-for cycle ${cycle.join(' -> ')}`;
  }
  return null;
}

/** @param {Map<string, Set<string>>} edges @returns {string[] | null} */
function findCycle(edges) {
  /** @type {Map<string, number>} */
  const mark = new Map();
  /** @param {string} n @param {string[]} path @returns {string[] | null} */
  const visit = (n, path) => {
    if (mark.get(n) === 1) return [...path.slice(path.indexOf(n)), n];
    if (mark.get(n) === 2) return null;
    mark.set(n, 1);
    for (const next of edges.get(n) ?? []) {
      const c = visit(next, [...path, n]);
      if (c) return c;
    }
    mark.set(n, 2);
    return null;
  };
  for (const n of edges.keys()) {
    const c = visit(n, []);
    if (c) return c;
  }
  return null;
}

/**
 * The properties judged by trying a step from a state: the first in line is admitted as soon as
 * the capacity frees, and no one else gets in ahead of it; a release, by a handle, never removes
 * another holder's record, and a second one removes nothing. Returns what broke, or null.
 * @param {Model} m @param {World} w @returns {string | null}
 */
export function brokenProgress(m, w) {
  for (const r of Object.keys(m.capacity)) {
    const tickets = liveTickets(w, r);
    if (!tickets.length) continue;
    const head = tickets[0];
    const a = actorOf(m, w, head.pid, undefined);
    const st = a ? w.actors[a.id] : null;
    if (a && st?.at?.mode === 'waiting' && st.at.ticket === head.name) {
      const weight = m.capacity[r] > 1 ? a.weight : 1;
      const mine = (/** @type {Slot} */ sl) =>
        sl.record?.holder === a.name && sl.record?.pid === a.pid;
      // Its name held live by another process refuses it, rightly: that is not capacity.
      const slots = [w.files[r].single, ...Object.values(w.files[r].holders)];
      const nameTaken = slots.some(
        (sl) => sl && sl.record?.holder === a.name && !mine(sl) && live(w, sl),
      );
      const fits = !nameTaken && used(m, w, r, mine) + weight <= m.capacity[r];
      const polled = runStep(m, w, { do: 'poll', actor: a.id });
      if (fits && polled?.result !== 'granted' && polled?.result !== 'renewed') {
        return `${r}: ${a.id} is first in line and fits, but its poll was ${polled?.result}`;
      }
    }
    // No newcomer gets in while someone waits.
    for (const x of m.actors) {
      const xs = w.actors[x.id];
      if (xs.crashed || xs.at) continue;
      for (const wait of [false, true]) {
        const got = runStep(m, w, { do: 'ask', actor: x.id, r, wait });
        if (got?.result === 'granted') return `${r}: newcomer ${x.id} got in ahead of the queue`;
      }
    }
  }
  for (const x of m.actors) {
    const xs = w.actors[x.id];
    if (xs.crashed || xs.at?.mode !== 'held') continue;
    const r = xs.at.r;
    const before = w.files[r];
    const once = runStep(m, w, { do: 'release', actor: x.id });
    if (!once) continue;
    const after = once.world.files[r];
    const gone = [before.single, ...Object.values(before.holders)].filter(
      (sl) =>
        sl &&
        !(sl.slot === SINGLE ? after.single : after.holders[sl.slot]) &&
        !(
          sl.record?.holder === x.name &&
          sl.record?.pid === x.pid &&
          sl.record?.start === startOf(x)
        ),
    );
    if (gone.length) return `${r}: ${x.id}'s release removed another holder's record`;
    // Again, as a handle released twice: nothing more goes.
    const again = runStep(m, setActor(once.world, x.id, xs), { do: 'release', actor: x.id });
    if (again && again.result !== 'kept')
      return `${r}: ${x.id}'s second release was ${again.result}`;
    if (again && JSON.stringify(again.world.files) !== JSON.stringify(once.world.files)) {
      return `${r}: ${x.id}'s second release changed the files`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The review's failures, as traces: each step with the result it must have. Each runs through the
// model here and through the file-system shell (lock-traces.test.mjs), which must agree.

/**
 * @typedef {Step & { expect?: string, during?: boolean }} TraceStep
 * @typedef {{ name: string, actors: ActorSpec[], ttlMs: number, steps: TraceStep[],
 *   holder?: string | null, modelOnly?: boolean }} Trace `modelOnly`: a fault the file-system
 *   run cannot make (a start time that cannot be read, a waiter's pid reused); lock-traces covers
 *   each in a test of its own
 */

const A = { id: 'a', name: 'D-A', pid: 9001, weight: 1 };
const B = { id: 'b', name: 'D-B', pid: 9002, weight: 1 };
const C = { id: 'c', name: 'D-C', pid: 9003, weight: 1 };
const X1 = { id: 'a', name: 'D-X', pid: 9001, weight: 1 };
const X2 = { id: 'b', name: 'D-X', pid: 9002, weight: 1 };
const N = { id: 'a', name: 'D-N', pid: 9001, weight: 1, noStart: true };

/** @type {Trace[]} */
export const TRACES = [
  {
    name: 'a holder that asks again while another waits is renewed at once',
    actors: [A, B],
    ttlMs: 300_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'ask', actor: 'a', r: 'gpu', wait: true, expect: 'renewed' },
      { do: 'poll', actor: 'b', expect: 'queued' },
      { do: 'release', actor: 'a', expect: 'released' },
      { do: 'poll', actor: 'b', expect: 'granted' },
    ],
    holder: 'b',
  },
  {
    name: 'the same name from a second process is refused until the first is gone',
    actors: [X1, X2],
    ttlMs: 300_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', wait: true, expect: 'conflict' },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'conflict' },
      { do: 'crash', actor: 'a' },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'granted' },
    ],
    holder: 'b',
  },
  {
    name: "a forced-off handle's release leaves the new holder's record under the same name",
    actors: [X1, X2],
    ttlMs: 300_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'releaseByName', actor: 'a', r: 'gpu', expect: 'released' },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'granted' },
      { do: 'release', actor: 'a', expect: 'kept' },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'renewed' },
    ],
    holder: 'b',
  },
  {
    name: 'a live holder past its expiry keeps the lock: the clock never revokes it',
    actors: [A, B],
    ttlMs: 1_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'clock', ms: 2_000 },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'refused' },
      { do: 'clock', ms: 20_000 },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'refused' },
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'renewed' },
    ],
    holder: 'a',
  },
  {
    name: 'a holder whose liveness cannot be checked is taken over once it expires',
    actors: [N, B],
    ttlMs: 1_000,
    modelOnly: true,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'refused' },
      { do: 'clock', ms: 2_000 },
      { do: 'ask', actor: 'b', r: 'gpu', expect: 'granted' },
    ],
    holder: 'b',
  },
  {
    name: 'a dead waiter whose pid was reused does not hold the head of the queue',
    actors: [A, B, C],
    ttlMs: 300_000,
    modelOnly: true,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'ask', actor: 'c', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'crash', actor: 'b' },
      { do: 'reuse', actor: 'b' },
      { do: 'release', actor: 'a', expect: 'released' },
      { do: 'poll', actor: 'c', expect: 'granted' },
    ],
    holder: 'c',
  },
  {
    name: 'a lock file being written is held, not taken over, until it has stayed unreadable',
    actors: [A],
    ttlMs: 300_000,
    steps: [
      { do: 'halfWritten', r: 'gpu' },
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'refused' },
      { do: 'clock', ms: 2_000 },
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
    ],
    holder: 'a',
  },
  {
    name: 'a clock that jumps back does not put a later waiter ahead of an earlier one',
    actors: [A, B, C],
    ttlMs: 300_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'clock', ms: -60_000 },
      { do: 'ask', actor: 'c', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'release', actor: 'a', expect: 'released' },
      { do: 'poll', actor: 'c', expect: 'queued' },
      { do: 'poll', actor: 'b', expect: 'granted' },
    ],
    holder: 'b',
  },
  {
    // In the file-system run, the two steps marked `during` happen in another process while b's
    // first ask is deciding: the holder is released and a newcomer asks.
    name: "a waiter's first attempt takes its ticket, so a newcomer cannot get in ahead of it",
    actors: [A, B, C],
    ttlMs: 300_000,
    steps: [
      { do: 'ask', actor: 'a', r: 'gpu', expect: 'granted' },
      { do: 'ask', actor: 'b', r: 'gpu', wait: true, expect: 'queued' },
      { do: 'releaseByName', actor: 'a', r: 'gpu', expect: 'released', during: true },
      { do: 'ask', actor: 'c', r: 'gpu', expect: 'refused', during: true },
      { do: 'poll', actor: 'b', expect: 'granted' },
    ],
    holder: 'b',
  },
];

/**
 * Run a trace through the model; returns each step's result and who holds the resource after.
 * @param {Trace} t @returns {{ results: string[], holder: string | null }}
 */
export function runTraceInModel(t) {
  /** @type {Model} */
  const m = { actors: t.actors, capacity: { gpu: 1 }, ttlMs: t.ttlMs };
  let w = initialWorld(m);
  /** @type {string[]} */
  const results = [];
  for (const s of t.steps) {
    const next = runStep(m, w, s);
    if (!next) throw new Error(`step ${JSON.stringify(s)} does not apply`);
    w = next.world;
    if (s.expect !== undefined) results.push(next.result);
  }
  const single = w.files.gpu.single?.record;
  const holder = single ? (actorOf(m, w, single.pid, single.start)?.id ?? null) : null;
  return { results, holder };
}

/** @param {Trace} t */
export const expected = (t) => t.steps.filter((s) => s.expect !== undefined).map((s) => s.expect);

export { holderSlot };
