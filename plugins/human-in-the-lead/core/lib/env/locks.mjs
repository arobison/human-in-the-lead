// Locks on serial resources (design part 13.2): the GPU, benchmark runs, a named fixture, the
// merge queue. Machine-wide, so two projects on one machine share them: they live in a directory
// beside the project stores, not inside one. Waiters queue in arrival order. A lock is stale when
// its holder's process is gone (or has been replaced by another with the same ID), or when it was
// not renewed before it expired; the next taker then takes it over.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { checkHolder } from './config.mjs';
import { withMutex } from './mutex.mjs';
import { isAlive, processStart, sleep } from './proc.mjs';

/**
 * @typedef {object} LockRecord
 * @property {string} resource
 * @property {string} holder
 * @property {number} pid the process whose life the lock follows
 * @property {string | null} pid_start that process's start time, to tell it from a successor
 * @property {string} host
 * @property {string} acquired_at
 * @property {string} renewed_at
 * @property {string} expires_at
 *
 * @typedef {object} LockContext
 * @property {string} machineRoot the machine-wide directory, with locks/ beneath it
 * @property {string} [repoRoot] the repository's primary checkout, for the per-repository resources
 * @property {(kind: string, data: Record<string, unknown>) => void} [log]
 *
 * @typedef {object} LockHandle
 * @property {string} resource
 * @property {string} holder
 * @property {() => void} renew
 * @property {() => boolean} release
 */

const PID_REUSE_CHECK_AFTER_MS = 10_000;
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

/** @param {LockContext} ctx @param {string} resource */
const lockFile = (ctx, resource) =>
  join(ctx.machineRoot, 'locks', `${physical(ctx, resource)}.lock`);
/** @param {LockContext} ctx @param {string} resource */
const queueDir = (ctx, resource) =>
  join(ctx.machineRoot, 'locks', `${physical(ctx, resource)}.queue`);

/** @param {string} path @returns {LockRecord | null | undefined} undefined: absent; null: unreadable */
function readLock(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const r = JSON.parse(text);
    return typeof r?.holder === 'string' && Number.isInteger(r.pid) ? r : null;
  } catch {
    return null;
  }
}

/**
 * Whether a recorded lock can be taken over, and why.
 * @param {LockRecord | null} record null for a file that cannot be read
 * @param {number} now
 * @returns {string | null}
 */
function staleReason(record, now) {
  if (!record) return 'its record is unreadable';
  if (record.host !== hostname()) return Date.parse(record.expires_at) < now ? 'it expired' : null;
  if (!isAlive(record.pid)) return `its holder's process ${record.pid} is gone`;
  // Telling a process from a successor that reused its ID costs a ps call, so it is done only for a
  // lock that has not been renewed lately; a holder that renews is plainly itself.
  if (record.pid_start && now - Date.parse(record.renewed_at) > PID_REUSE_CHECK_AFTER_MS) {
    const start = processStart(record.pid);
    if (start && start !== record.pid_start) {
      return `process ${record.pid} is no longer the holder's (its ID was reused)`;
    }
  }
  if (Date.parse(record.expires_at) < now) return 'it expired without being renewed';
  return null;
}

/**
 * @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart the process's start time, looked up once by the caller (a lookup
 *   costs a process, and on Windows most of a second)
 * @param {number} ttlMs @param {string} [acquiredAt]
 * @returns {LockRecord}
 */
function newRecord(resource, holder, pid, pidStart, ttlMs, acquiredAt) {
  const now = new Date();
  return {
    resource,
    holder,
    pid,
    pid_start: pidStart,
    host: hostname(),
    acquired_at: acquiredAt ?? now.toISOString(),
    renewed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/**
 * The live waiters of a resource, in arrival order; dead waiters are dropped.
 * @param {LockContext} ctx @param {string} resource @returns {string[]} ticket file names */
function liveQueue(ctx, resource) {
  const dir = queueDir(ctx, resource);
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    const pid = Number(name.split('.').at(-2));
    if (isAlive(pid)) live.push(name);
    else rmSync(join(dir, name), { force: true });
  }
  return live;
}

/**
 * One attempt to take the lock. Returns the new record if taken, or the current holder's.
 * @param {LockContext} ctx @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart @param {number} ttlMs
 * @returns {Promise<{ taken: true, record: LockRecord, renewed?: boolean } | { taken: false, held_by: LockRecord | null }>}
 */
async function attempt(ctx, resource, holder, pid, pidStart, ttlMs) {
  const path = lockFile(ctx, resource);
  mkdirSync(join(ctx.machineRoot, 'locks'), { recursive: true });
  for (let tries = 0; tries < 5; tries++) {
    const record = newRecord(resource, holder, pid, pidStart, ttlMs);
    try {
      writeFileSync(path, JSON.stringify(record) + '\n', { flag: 'wx' });
      return { taken: true, record };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    const current = readLock(path);
    if (current === undefined) continue; // released between our two looks
    if (current && current.holder === holder) {
      // Asking again as the holder renews.
      const renewed = { ...record, acquired_at: current.acquired_at };
      writeFileSync(path, JSON.stringify(renewed) + '\n');
      return { taken: true, record: renewed, renewed: true };
    }
    const reason = staleReason(current, Date.now());
    if (!reason) return { taken: false, held_by: current };
    // Take over under a mutex, re-checking inside it, so two takers cannot both win.
    const won = await withMutex(`${path}.takeover`, () => {
      const again = readLock(path);
      if (again === undefined) return { ok: true, previous: null };
      if (!staleReason(again, Date.now())) return { ok: false, previous: again };
      rmSync(path, { force: true });
      return { ok: true, previous: again };
    });
    if (!won.ok) return { taken: false, held_by: won.previous };
    ctx.log?.('lock_takeover', {
      resource,
      holder,
      previous_holder: won.previous?.holder ?? null,
      reason,
    });
  }
  return { taken: false, held_by: readLock(path) ?? null };
}

/**
 * Acquire a serial resource for a holder.
 *
 * Without `wait`, returns at once, taken or not. With `wait`, the caller queues behind earlier
 * arrivals and polls until it is first and the lock is free, or `timeoutMs` passes. A holder that
 * asks for a lock it already holds renews it. The lock follows `pid` (default: this process); an
 * in-process handle renews it on a timer, so it expires only if this process stops.
 * @param {LockContext} ctx
 * @param {{ resource: string, holder: string, pid?: number, ttlSeconds?: number, wait?: boolean,
 *   timeoutMs?: number, pollMs?: number, autoRenew?: boolean }} request
 * @returns {Promise<{ acquired: true, handle: LockHandle, record: LockRecord, waited_ms: number }
 *   | { acquired: false, held_by: LockRecord | null, waited_ms: number, timed_out: boolean }>}
 */
export async function acquireLock(ctx, request) {
  const resource = checkResource(request.resource);
  const holder = checkHolder(request.holder);
  const pid = request.pid ?? process.pid;
  const ttlMs = (request.ttlSeconds ?? 300) * 1000;
  const pollMs = request.pollMs ?? 50;
  const started = Date.now();
  const deadline = request.timeoutMs === undefined ? Infinity : started + request.timeoutMs;
  /** @type {string | null} */
  let ticket = null;
  let queued = false;
  const tdir = queueDir(ctx, resource);
  const dropTicket = () => {
    if (ticket) rmSync(join(tdir, ticket), { force: true });
    ticket = null;
  };

  /** @type {string | null | undefined} looked up at the first attempt, then reused */
  let pidStart;

  try {
    for (;;) {
      const queue = liveQueue(ctx, resource);
      // Only the first in line may try; a newcomer with others waiting joins the queue instead.
      const myTurn = queue.length === 0 || (ticket !== null && queue[0] === ticket);
      if (myTurn) {
        if (pidStart === undefined) pidStart = processStart(pid);
        const r = await attempt(ctx, resource, holder, pid, pidStart, ttlMs);
        if (r.taken) {
          dropTicket();
          const waited = Date.now() - started;
          if (queued) ctx.log?.('lock_wait', { resource, holder, waited_ms: waited });
          ctx.log?.('lock_acquired', { resource, holder, pid, renewed: r.renewed ?? false });
          return {
            acquired: true,
            record: r.record,
            waited_ms: waited,
            handle: makeHandle(
              ctx,
              resource,
              holder,
              pid,
              pidStart,
              ttlMs,
              request.autoRenew !== false,
            ),
          };
        }
        if (!request.wait) {
          return { acquired: false, held_by: r.held_by, waited_ms: 0, timed_out: false };
        }
      } else if (!request.wait) {
        const held = readLock(lockFile(ctx, resource));
        return { acquired: false, held_by: held ?? null, waited_ms: 0, timed_out: false };
      }
      if (Date.now() >= deadline) {
        dropTicket();
        const held = readLock(lockFile(ctx, resource));
        return {
          acquired: false,
          held_by: held ?? null,
          waited_ms: Date.now() - started,
          timed_out: true,
        };
      }
      if (!ticket) {
        mkdirSync(tdir, { recursive: true });
        queued = true;
        ticket = `${String(Date.now()).padStart(15, '0')}.${randomBytes(3).toString('hex')}.${process.pid}.t`;
        writeFileSync(join(tdir, ticket), JSON.stringify({ holder, pid: process.pid }) + '\n');
      }
      await sleep(pollMs);
    }
  } finally {
    dropTicket();
  }
}

/**
 * @param {LockContext} ctx @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart @param {number} ttlMs @param {boolean} autoRenew
 * @returns {LockHandle}
 */
function makeHandle(ctx, resource, holder, pid, pidStart, ttlMs, autoRenew) {
  const path = lockFile(ctx, resource);
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const renew = () => {
    const cur = readLock(path);
    if (cur && cur.holder === holder) {
      writeFileSync(
        path,
        JSON.stringify({ ...newRecord(resource, holder, pid, pidStart, ttlMs, cur.acquired_at) }) +
          '\n',
      );
    }
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
      return releaseLock(ctx, { resource, holder }).released;
    },
  };
}

/**
 * Release a lock. Only the holder's own lock is removed; asking for someone else's is a no-op.
 * @param {LockContext} ctx @param {{ resource: string, holder: string }} request
 * @returns {{ released: boolean, held_by?: string }}
 */
export function releaseLock(ctx, request) {
  const resource = checkResource(request.resource);
  const holder = checkHolder(request.holder);
  const path = lockFile(ctx, resource);
  const cur = readLock(path);
  if (!cur) return { released: false };
  if (cur.holder !== holder) return { released: false, held_by: cur.holder };
  rmSync(path, { force: true });
  ctx.log?.('lock_released', { resource, holder });
  return { released: true };
}

/**
 * Who holds what, and who waits, for the named resources.
 * @param {LockContext} ctx @param {string[]} resources
 */
export function lockStatus(ctx, resources) {
  const now = Date.now();
  return resources.map((resource) => {
    const record = readLock(lockFile(ctx, checkResource(resource)));
    const waiting = liveQueue(ctx, resource).map((t) => {
      try {
        return JSON.parse(readFileSync(join(queueDir(ctx, resource), t), 'utf8')).holder;
      } catch {
        return null;
      }
    });
    return {
      resource,
      held_by: record?.holder ?? null,
      stale: record === undefined ? false : staleReason(record, now),
      record: record ?? null,
      waiting,
    };
  });
}
