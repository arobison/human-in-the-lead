// Locks on serial resources (design part 13.2): the GPU, benchmark runs, a named fixture, the
// merge queue. Machine-wide, so two projects on one machine share them: they live in a directory
// beside the project stores, not inside one. Waiters queue in arrival order. A lock is stale when
// its holder's process is gone (or has been replaced by another with the same ID), or when it was
// not renewed before it expired; the next taker then takes it over.
//
// A resource has a capacity (design 13.4, HITLD-41): the machine profile's `capacity` gives the
// weight units it takes, and each holder takes a weight. A resource with no entry has capacity 1
// and keeps the single lock file above, unchanged. A resource with a larger capacity records each
// holder in its own file under <resource>.holders/, admitted while the live weights fit. Either
// way only the first in the queue may try, so a heavy holder waiting at the head is not overtaken
// by light ones that arrive after it.
//
// A holder name is one process's (HITLD-1050): a record names its holder and the process it
// follows (pid and start time). A live holder that asks again from that process is renewed
// before the queue is looked at, so it never waits behind waiters that wait on it. Another process
// asking under a name a live holder has is refused, with the holder named; once that holder is
// stale, the name is taken over like any other lock.
//
// Every decision is made by `decide` in lockcore.mjs (HITLD-1051); this file is its shell. It
// reads the resource's files and the processes they name into a state, and, inside the resource's
// one critical section, asks `decide` and applies what it returns. The critical section is the
// resource's `.admit` mutex, which weighted admissions have always taken, used now for the single
// lock too, with the single lock's `.takeover` mutex inside it, which older copies take to take it
// over. Records are written whole, through a temporary file and a rename, so a reader never sees
// one half-written; the first creation of the single lock stays an exclusive create (a hard link
// of the written file), so older copies, which create it with an exclusive open, are still
// excluded. The files and paths are those older copies use; the ticket numbering and the fields
// are compatible with them.

import {
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { checkHolder } from './config.mjs';
import { withMutexSync } from './mutex.mjs';
import { isAlive, processStart, processStarts, sleep } from './proc.mjs';
import {
  SINGLE,
  decide,
  holderSlot,
  parseTicket,
  staleReason,
  startsWanted,
  weightOf,
} from './lockcore.mjs';

/**
 * @typedef {import('./lockcore.mjs').LockRecord} LockRecord
 * @typedef {import('./lockcore.mjs').LockState} LockState
 * @typedef {import('./lockcore.mjs').LockEvent} LockEvent
 * @typedef {import('./lockcore.mjs').Effect} Effect
 * @typedef {import('./lockcore.mjs').Outcome} Outcome
 * @typedef {import('./lockcore.mjs').Slot} Slot
 *
 * @typedef {object} LockContext
 * @property {string} machineRoot the machine-wide directory, with locks/ beneath it
 * @property {string} [repoRoot] the repository's primary checkout, for the per-repository resources
 * @property {Record<string, number>} [capacity] the machine profile's capacity per resource
 * @property {(kind: string, data: Record<string, unknown>) => void} [log]
 *
 * @typedef {object} LockHandle
 * @property {string} resource
 * @property {string} holder
 * @property {() => void} renew
 * @property {() => boolean} release
 */

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** @param {string} resource */
function checkResource(resource) {
  if (typeof resource !== 'string' || !NAME.test(resource) || resource.includes('..')) {
    throw new Error(`resource ${JSON.stringify(resource)} is not a safe lower-case name`);
  }
  return resource;
}

/**
 * Resources that are serial per repository, not per machine (design 13.2 and 13.4): the merge
 * queue works on one repository's main branch, so two repositories never wait on each other.
 */
export const PER_REPOSITORY = Object.freeze(['merge-queue']);

/**
 * The name a resource's files carry: the resource itself, or, for a per-repository one, the
 * resource and a short hash of the repository's root. Records and reports keep the plain name.
 * @param {LockContext} ctx @param {string} resource
 */
function physical(ctx, resource) {
  if (!PER_REPOSITORY.includes(resource)) return resource;
  if (!ctx.repoRoot) {
    throw new Error(`${resource} is per repository: the lock context needs the repository's root`);
  }
  const key = createHash('sha256').update(ctx.repoRoot).digest('hex').slice(0, 12);
  return `${resource}.${key}`;
}

/**
 * The weight units a resource takes: the machine profile's entry, else 1. A per-repository
 * resource is serial by nature and always has capacity 1.
 * @param {LockContext} ctx @param {string} resource @returns {number}
 */
export function capacityOf(ctx, resource) {
  if (PER_REPOSITORY.includes(resource)) return 1;
  const c = ctx.capacity?.[resource];
  return Number.isInteger(c) && /** @type {number} */ (c) >= 1 ? /** @type {number} */ (c) : 1;
}

/** @param {LockContext} ctx */
const locksDir = (ctx) => join(ctx.machineRoot, 'locks');
/** @param {LockContext} ctx @param {string} resource */
const holdersDir = (ctx, resource) => join(locksDir(ctx), `${physical(ctx, resource)}.holders`);
/** @param {LockContext} ctx @param {string} resource */
const lockFile = (ctx, resource) => join(locksDir(ctx), `${physical(ctx, resource)}.lock`);
/** @param {LockContext} ctx @param {string} resource */
const queueDir = (ctx, resource) => join(locksDir(ctx), `${physical(ctx, resource)}.queue`);

/**
 * A slot's file: the single lock, or a weighted holder's file, named by its hex-encoded name
 * (names may differ only by case, which a case-insensitive file system would fold together).
 * @param {LockContext} ctx @param {string} resource @param {string} slot
 */
const slotPath = (ctx, resource, slot) =>
  slot === SINGLE ? lockFile(ctx, resource) : join(holdersDir(ctx, resource), `${slot}.json`);

/**
 * A record file as it is now: absent (null), or its record (null when it cannot be read whole) and
 * when it was last written.
 * @param {string} path @param {string} slot @returns {Slot | null}
 */
function readSlot(path, slot) {
  let text;
  let mtime;
  try {
    text = readFileSync(path, 'utf8');
    mtime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  try {
    const r = JSON.parse(text);
    const ok = typeof r?.holder === 'string' && Number.isInteger(r.pid);
    return { slot, record: ok ? r : null, mtime };
  } catch {
    return { slot, record: null, mtime };
  }
}

/** @param {string} dir @returns {string[]} */
function list(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The processes the records and tickets name: whether each is alive, and the start time of those
 * staleReason will ask for. `starts: false` skips the start times, which cost a process to look
 * up: enough for a waiter to learn it is still not first in line.
 * @param {(LockRecord | null)[]} records @param {number[]} ticketPids @param {number} now
 * @param {string} host @param {boolean} starts
 * @returns {import('./lockcore.mjs').Procs}
 */
function procsFor(records, ticketPids, now, host, starts) {
  /** @type {import('./lockcore.mjs').Procs} */
  const procs = {};
  for (const r of records) if (r && r.host === host) procs[r.pid] = { alive: isAlive(r.pid) };
  for (const pid of ticketPids) procs[pid] ??= { alive: isAlive(pid) };
  if (starts) {
    const wanted = startsWanted(records, now, host).filter((p) => procs[p]?.alive);
    if (wanted.length) {
      const found = processStarts(wanted);
      for (const p of wanted) procs[p].start = found.get(p) ?? null;
    }
  }
  return procs;
}

/**
 * Everything `decide` looks at for a resource, read now.
 * @param {LockContext} ctx @param {string} resource @param {{ starts?: boolean }} [o]
 * @returns {LockState}
 */
function readState(ctx, resource, o = {}) {
  const now = Date.now();
  const host = hostname();
  const single = readSlot(lockFile(ctx, resource), SINGLE);
  const hdir = holdersDir(ctx, resource);
  const holders = /** @type {Slot[]} */ (
    list(hdir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => readSlot(join(hdir, n), n.slice(0, -'.json'.length)))
      .filter(Boolean)
  );
  const queue = list(queueDir(ctx, resource))
    .filter((n) => n.endsWith('.t'))
    .map(parseTicket);
  const records = [single?.record ?? null, ...holders.map((h) => h.record)];
  return {
    resource,
    capacity: capacityOf(ctx, resource),
    now,
    host,
    single,
    holders,
    queue,
    procs: procsFor(
      records,
      queue.map((t) => t.pid),
      now,
      host,
      o.starts !== false,
    ),
  };
}

/**
 * Write a file whole: a reader sees the old one or the new one, never half of either.
 * @param {string} path @param {string} text
 */
function writeWhole(path, text) {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Create a file only if there is none, whole: written aside, then hard-linked into place, which
 * fails if the path is taken, as an exclusive open does. Where hard links are not supported it
 * falls back to the exclusive open.
 * @param {string} path @param {string} text @returns {boolean} whether it was created
 */
function createWhole(path, text) {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    if (code === 'EEXIST') return false;
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS' && code !== 'EXDEV') throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
  try {
    writeFileSync(path, text, { flag: 'wx' });
    return true;
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') return false;
    throw e;
  }
}

/**
 * Apply a decision's changes in order, stopping at an exclusive create that finds the lock file
 * taken (by an older copy, which creates it without the critical section). A ticket is reported
 * to `onEnqueue` as soon as it is written, so a waiter whose later change throws still removes it.
 * @param {LockContext} ctx @param {string} resource @param {Effect[]} effects
 * @param {(ticket: string) => void} [onEnqueue]
 * @returns {{ ok: boolean, logs: Effect[] }}
 */
function apply(ctx, resource, effects, onEnqueue) {
  /** @type {Effect[]} */
  const logs = [];
  for (const e of effects) {
    switch (e.op) {
      case 'create':
        mkdirSync(locksDir(ctx), { recursive: true });
        if (!createWhole(slotPath(ctx, resource, e.slot), JSON.stringify(e.record) + '\n')) {
          return { ok: false, logs };
        }
        break;
      case 'write': {
        const path = slotPath(ctx, resource, e.slot);
        mkdirSync(e.slot === SINGLE ? locksDir(ctx) : holdersDir(ctx, resource), {
          recursive: true,
        });
        writeWhole(path, JSON.stringify(e.record) + '\n');
        break;
      }
      case 'remove':
        rmSync(slotPath(ctx, resource, e.slot), { force: true });
        break;
      case 'enqueue': {
        const dir = queueDir(ctx, resource);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, e.ticket.name),
          JSON.stringify({ holder: e.ticket.holder ?? null, pid: e.ticket.pid }) + '\n',
        );
        onEnqueue?.(e.ticket.name);
        break;
      }
      case 'dequeue':
        rmSync(join(queueDir(ctx, resource), e.name), { force: true });
        break;
      case 'log':
        logs.push(e);
        break;
    }
  }
  return { ok: true, logs };
}

/**
 * Run `fn` inside the resource's one critical section: its `.admit` mutex, and inside it the
 * single lock's `.takeover` mutex, so older copies' admissions and takeovers are excluded too
 * (they take one or the other, never both, so the order cannot deadlock). It is synchronous, so
 * no other work in this process runs inside it, and it is held for a few file operations.
 * @template T @param {LockContext} ctx @param {string} resource @param {() => T} fn @returns {T}
 */
function critical(ctx, resource, fn) {
  return withMutexSync(`${holdersDir(ctx, resource)}.admit`, () =>
    withMutexSync(`${lockFile(ctx, resource)}.takeover`, fn),
  );
}

/**
 * Decide an event on the state as it is now, and apply the decision, inside the critical section.
 * An exclusive create that loses to an older copy decides again on what is there now; a weighted
 * grant is confirmed against a single lock created meanwhile. Logs are written after it.
 * @param {LockContext} ctx @param {string} resource @param {LockEvent} event
 * @param {(ticket: string) => void} [onEnqueue] told of a ticket as soon as it is written
 * @returns {Outcome}
 */
function step(ctx, resource, event, onEnqueue) {
  /** @type {Effect[]} */
  const logs = [];
  const outcome = critical(ctx, resource, () => {
    let ev = event;
    for (let tries = 0; ; tries++) {
      const d = decide(readState(ctx, resource), ev);
      const done = apply(ctx, resource, d.effects, onEnqueue);
      logs.push(...done.logs);
      const enqueued = d.effects.find((e) => e.op === 'enqueue');
      if (enqueued && enqueued.op === 'enqueue' && ev.type === 'ask') {
        ev = { ...ev, ticket: enqueued.ticket.name };
      }
      if (!done.ok) {
        if (tries < 4) continue;
        if (ev.type === 'ask' && ev.wait && ev.ticket) {
          return /** @type {Outcome} */ ({
            kind: 'queued',
            ticket: ev.ticket,
            held_by: readSlot(lockFile(ctx, resource), SINGLE)?.record ?? null,
            turn: true,
          });
        }
        return /** @type {Outcome} */ ({
          kind: 'refused',
          held_by: readSlot(lockFile(ctx, resource), SINGLE)?.record ?? null,
          conflict: false,
        });
      }
      if (d.outcome.kind === 'granted' && d.outcome.confirm && ev.type === 'ask') {
        const c = decide(readState(ctx, resource), {
          type: 'confirm',
          holder: ev.holder,
          pid: ev.pid,
          pidStart: ev.pidStart,
          wait: ev.wait,
          ticket: ev.ticket,
        });
        apply(ctx, resource, c.effects);
        return c.outcome.kind === 'granted'
          ? { ...c.outcome, record: d.outcome.record }
          : c.outcome;
      }
      return d.outcome;
    }
  });
  for (const l of logs) if (l.op === 'log') ctx.log?.(l.kind, l.data);
  return outcome;
}

/**
 * Acquire a serial resource for a holder, taking `weight` units of its capacity (default 1). A
 * weight above the resource's capacity could never be granted and is refused.
 *
 * Without `wait`, returns at once, taken or not. With `wait`, the caller queues behind earlier
 * arrivals and polls until it is first and the lock is free, or `timeoutMs` passes. Its ticket is
 * written in the same decision as its first attempt, so no one who asks after it gets in first.
 * The lock follows `pid` (default: this process); an in-process handle renews it on a timer, so it
 * expires only if this process stops.
 *
 * A holder that asks for a lock it already holds renews it, at once, with or without `wait` and
 * whether or not others are queued: its hold is looked for before the queue, and it keeps the
 * weight it holds (`renewed` is true). Its hold is the live record under its name written for the
 * same process (`pid` and that process's start time). A hold that has lapsed (expired, or its
 * process gone) is no longer held: asking again then waits its turn like any caller. Another
 * process asking under a name a live holder has is refused at once, never queued, with that
 * holder in `held_by`; once that holder is stale, the name is taken over like any other lock.
 * @param {LockContext} ctx
 * @param {{ resource: string, holder: string, pid?: number, ttlSeconds?: number, wait?: boolean,
 *   timeoutMs?: number, pollMs?: number, autoRenew?: boolean, weight?: number }} request
 * @returns {Promise<{ acquired: true, handle: LockHandle, record: LockRecord, waited_ms: number,
 *       renewed: boolean }
 *   | { acquired: false, held_by: LockRecord | null, waited_ms: number, timed_out: boolean,
 *       capacity: number }>}
 */
export async function acquireLock(ctx, request) {
  const resource = checkResource(request.resource);
  const holder = checkHolder(request.holder);
  const capacity = capacityOf(ctx, resource);
  const weight = request.weight ?? 1;
  if (!Number.isInteger(weight) || weight < 1) {
    throw new Error(`weight ${JSON.stringify(weight)} is not a whole number of at least 1`);
  }
  if (weight > capacity) {
    throw new Error(
      `weight ${weight} is more than ${resource}'s capacity of ${capacity} (the machine profile's capacity.${resource})`,
    );
  }
  const pid = request.pid ?? process.pid;
  const pidStart = processStart(pid);
  const ttlMs = (request.ttlSeconds ?? 300) * 1000;
  const pollMs = request.pollMs ?? 50;
  const wait = request.wait === true;
  const started = Date.now();
  const deadline = request.timeoutMs === undefined ? Infinity : started + request.timeoutMs;
  /** @type {string | null} */
  let ticket = null;
  let queued = false;

  /** @returns {LockEvent} */
  const ask = () => ({
    type: 'ask',
    holder,
    pid,
    pidStart,
    self: process.pid,
    weight,
    wait,
    ticket,
    ttlMs,
    nonce: randomBytes(3).toString('hex'),
  });

  /** @param {{ record: LockRecord, renewed: boolean }} r */
  const granted = (r) => {
    const waited = Date.now() - started;
    if (queued) ctx.log?.('lock_wait', { resource, holder, waited_ms: waited });
    ctx.log?.('lock_acquired', {
      resource,
      holder,
      pid,
      renewed: r.renewed,
      ...(r.record.weight === undefined ? {} : { weight: r.record.weight, capacity }),
    });
    return {
      acquired: /** @type {const} */ (true),
      record: r.record,
      waited_ms: waited,
      renewed: r.renewed,
      handle: makeHandle(
        ctx,
        resource,
        holder,
        pid,
        pidStart,
        ttlMs,
        request.autoRenew !== false,
        r.record.weight ?? null,
      ),
    };
  };
  /** @param {LockRecord | null} by @param {boolean} timedOut */
  const notAcquired = (by, timedOut) => ({
    acquired: /** @type {const} */ (false),
    held_by: by,
    waited_ms: Date.now() - started,
    timed_out: timedOut,
    capacity,
  });

  try {
    for (;;) {
      /** @type {Outcome} */
      // The ticket is known from the moment it is written: if anything after it in the same
      // decision throws, the `finally` below still removes it, and it never holds the line.
      const r =
        (ticket !== null && peek(ctx, resource, ask())) ||
        step(ctx, resource, ask(), (t) => {
          ticket = t;
        });
      if (r.kind === 'granted') {
        ticket = null;
        return granted(r);
      }
      if (r.kind === 'refused') {
        ticket = null;
        // Its name held by another process: refused, not waited for.
        if (r.conflict) return notAcquired(r.held_by, false);
        return { ...notAcquired(r.held_by, false), waited_ms: 0 };
      }
      if (r.kind !== 'queued') throw new Error(`an ask was decided as ${r.kind}`);
      ticket = r.ticket;
      queued = true;
      if (Date.now() >= deadline) return notAcquired(currentHolder(ctx, resource), true);
      await sleep(pollMs);
    }
  } finally {
    if (ticket !== null) leave(ctx, resource, ticket);
  }
}

/**
 * A waiter's poll, read without the critical section: when it is still not first in line and
 * nothing needs changing, that is the answer, and the waiter has not taken the mutex every poll.
 * Anything else (its turn, a dead ticket to drop) is decided again inside the critical section.
 * Start times are not looked up here: they bear only on whether a record is stale, which decides
 * nothing for a waiter that is not first in line.
 * @param {LockContext} ctx @param {string} resource @param {LockEvent} event
 * @returns {Outcome | null}
 */
function peek(ctx, resource, event) {
  const d = decide(readState(ctx, resource, { starts: false }), event);
  return d.outcome.kind === 'queued' && !d.outcome.turn && d.effects.length === 0
    ? d.outcome
    : null;
}

/**
 * A waiter leaves the queue (granted elsewhere, timed out, or stopped): its own ticket goes. Only
 * the waiter removes its own ticket and no one else's place depends on its staying, so this needs
 * no critical section.
 * @param {LockContext} ctx @param {string} resource @param {string} ticket
 */
function leave(ctx, resource, ticket) {
  const queue = list(queueDir(ctx, resource))
    .filter((n) => n === ticket)
    .map(parseTicket);
  apply(
    ctx,
    resource,
    decide({ ...emptyState(resource), queue }, { type: 'leave', ticket }).effects,
  );
}

/** @param {string} resource @returns {LockState} */
const emptyState = (resource) => ({
  resource,
  capacity: 1,
  now: Date.now(),
  host: hostname(),
  single: null,
  holders: [],
  queue: [],
  procs: {},
});

/**
 * Who holds a resource now, for a refusal: the single lock's holder, else the oldest weighted one.
 * @param {LockContext} ctx @param {string} resource @returns {LockRecord | null}
 */
function currentHolder(ctx, resource) {
  const single = readSlot(lockFile(ctx, resource), SINGLE)?.record;
  if (single) return single;
  const hdir = holdersDir(ctx, resource);
  const records = list(hdir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => readSlot(join(hdir, n), n)?.record)
    .filter((r) => !!r);
  const at = (/** @type {LockRecord} */ r) => Date.parse(r.acquired_at) || 0;
  return /** @type {LockRecord[]} */ (records).sort((a, b) => at(a) - at(b))[0] ?? null;
}

/**
 * @param {LockContext} ctx @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart @param {number} ttlMs @param {boolean} autoRenew
 * @param {number | null} weight the weight held, for a resource with a capacity above 1
 * @returns {LockHandle}
 */
function makeHandle(ctx, resource, holder, pid, pidStart, ttlMs, autoRenew, weight) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  // Only its own record: one another process took over under the same name is not this hold.
  const renew = () => {
    step(ctx, resource, { type: 'renew', holder, pid, pidStart, ttlMs, weight });
  };
  if (autoRenew) {
    timer = setInterval(renew, Math.max(1000, Math.floor(ttlMs / 3)));
    timer.unref();
  }
  return {
    resource,
    holder,
    renew,
    release() {
      if (timer) clearInterval(timer);
      // Its own records only, for its process: a release by a handle whose hold lapsed and was
      // taken over under the same name leaves the new holder's record in place.
      return step(ctx, resource, { type: 'release', holder, pid, pidStart }).kind === 'released';
    },
  };
}

/**
 * Release a lock by its holder's name. Only the holder's own lock is removed; asking for someone
 * else's is a no-op, and so is asking again.
 * @param {LockContext} ctx @param {{ resource: string, holder: string }} request
 * @returns {{ released: boolean, held_by?: string }}
 */
export function releaseLock(ctx, request) {
  const resource = checkResource(request.resource);
  const holder = checkHolder(request.holder);
  const r = step(ctx, resource, { type: 'release', holder });
  if (r.kind === 'released') return { released: true };
  if (r.kind !== 'kept' || r.held_by === null) return { released: false };
  return { released: false, held_by: r.held_by };
}

/**
 * Who holds what, and who waits, for the named resources. `held_by` and `stale` describe one
 * holder: a live one when there is any (the single lock's first, else the oldest weighted), so
 * `held_by && !stale` means "some live holder"; otherwise the single lock's record, stale or
 * unreadable, as before. `holders` lists every holder with its weight; `used` counts a live single
 * lock as the whole capacity, else sums the live weights, as admission does. It passes `capacity`
 * only when the profile's capacity was lowered under live holders. It only reads: dead waiters'
 * tickets are left for the next decision to drop.
 * @param {LockContext} ctx @param {string[]} resources
 */
export function lockStatus(ctx, resources) {
  return resources.map((resource) => {
    checkResource(resource);
    const s = readState(ctx, resource);
    const capacity = s.capacity;
    const at = (/** @type {Slot} */ h) => (h.record ? Date.parse(h.record.acquired_at) || 0 : 0);
    const weighted = [...s.holders].sort((a, b) => at(a) - at(b));
    const all = [
      ...(s.single ? [{ slot: s.single, weight: capacity, single: true }] : []),
      ...weighted.map((h) => ({ slot: h, weight: weightOf(h.record), single: false })),
    ].map((h) => ({ ...h, stale: staleReason(h.slot, s) }));
    const live = all.find((h) => !h.stale);
    const chosen = live ?? all.find((h) => h.single) ?? all[0];
    const singleLive = all.some((h) => h.single && !h.stale);
    const used = singleLive
      ? capacity
      : all.filter((h) => !h.stale).reduce((n, h) => n + h.weight, 0);
    const holders = all.map((h) => ({
      holder: h.slot.record?.holder ?? null,
      weight: h.weight,
      stale: h.stale,
    }));
    const waiting = [...s.queue]
      .filter((t) => s.procs[t.pid]?.alive)
      .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1))
      .map((t) => {
        try {
          return JSON.parse(readFileSync(join(queueDir(ctx, resource), t.name), 'utf8')).holder;
        } catch {
          return null;
        }
      });
    return {
      resource,
      capacity,
      used,
      held_by: chosen?.slot.record?.holder ?? null,
      stale: chosen ? chosen.stale : false,
      record: chosen?.slot.record ?? null,
      holders,
      waiting,
    };
  });
}
