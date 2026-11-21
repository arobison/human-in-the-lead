// Locks on serial resources (design part 13.2): the GPU, benchmark runs, a named fixture, the
// merge queue. Machine-wide, so two projects on one machine share them: they live in a directory
// beside the project stores, not inside one. Waiters queue in arrival order. A lock is stale when
// its holder's process is gone (or has been replaced by another with the same ID), or when it was
// not renewed before it expired; the next taker then takes it over.
//
// A resource has a capacity (design 13.4, HITLD-41): the machine profile's `capacity` gives the
// weight units it takes, and each holder takes a weight. A resource with no entry has capacity 1
// and keeps the single lock file above, unchanged. A resource with a larger capacity records each
// holder in its own file under <resource>.holders/, admitted under a mutex while the live weights
// fit. Either way only the first in the queue may try, so a heavy holder waiting at the head is
// not overtaken by light ones that arrive after it.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { checkHolder } from './config.mjs';
import { withMutex } from './mutex.mjs';
import { isAlive, processStart, processStarts, sleep } from './proc.mjs';

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
 * @property {number} [weight] the units it holds of a resource with a capacity above 1
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

/** @param {LockContext} ctx @param {string} resource */
const holdersDir = (ctx, resource) =>
  join(ctx.machineRoot, 'locks', `${physical(ctx, resource)}.holders`);
/**
 * A holder's file. Holder names may differ only by case (D-1 and d-1), which a case-insensitive
 * file system would fold into one file, so the name is hex-encoded; the record names the holder.
 * @param {LockContext} ctx @param {string} resource @param {string} holder
 */
const holderFile = (ctx, resource, holder) =>
  join(holdersDir(ctx, resource), `${Buffer.from(holder).toString('hex')}.json`);

/**
 * The holders recorded for a resource with a capacity, oldest first.
 * @param {LockContext} ctx @param {string} resource
 * @returns {{ path: string, record: LockRecord | null }[]}
 */
function readHolders(ctx, resource) {
  const dir = holdersDir(ctx, resource);
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const path = join(dir, name);
    const record = readLock(path);
    if (record !== undefined) out.push({ path, record });
  }
  const at = (/** @type {LockRecord | null} */ r) => (r ? Date.parse(r.acquired_at) || 0 : 0);
  return out.sort((a, b) => at(a.record) - at(b.record));
}

/**
 * Write a weighted holder's record whole: a reader under the admission mutex would take a
 * half-written file for an unreadable, stale one and remove it.
 * @param {string} path @param {LockRecord} record
 */
function writeHolder(path, record) {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(record) + '\n');
  renameSync(tmp, path);
}

/** @param {LockRecord | null} r */
const weightOf = (r) => (r && Number.isInteger(r.weight) ? /** @type {number} */ (r.weight) : 1);

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
 * @param {Map<number, string>} [starts] process start times looked up together beforehand
 *   (startsFor), so judging several holders costs one process lookup, not one each
 * @returns {string | null}
 */
function staleReason(record, now, starts) {
  if (!record) return 'its record is unreadable';
  if (record.host !== hostname()) return Date.parse(record.expires_at) < now ? 'it expired' : null;
  if (!isAlive(record.pid)) return `its holder's process ${record.pid} is gone`;
  // Telling a process from a successor that reused its ID costs a ps call, so it is done only for a
  // lock that has not been renewed lately; a holder that renews is plainly itself.
  if (record.pid_start && now - Date.parse(record.renewed_at) > PID_REUSE_CHECK_AFTER_MS) {
    const start = starts ? starts.get(record.pid) : processStart(record.pid);
    if (start && start !== record.pid_start) {
      return `process ${record.pid} is no longer the holder's (its ID was reused)`;
    }
  }
  if (Date.parse(record.expires_at) < now) return 'it expired without being renewed';
  return null;
}

/**
 * The start times staleReason will ask for, for the given records, in one lookup.
 * @param {(LockRecord | null | undefined)[]} records @param {number} now
 * @returns {Map<number, string>}
 */
function startsFor(records, now) {
  const pids = [];
  for (const r of records) {
    if (!r || r.host !== hostname() || !r.pid_start) continue;
    if (now - Date.parse(r.renewed_at) > PID_REUSE_CHECK_AFTER_MS) pids.push(r.pid);
  }
  return pids.length ? processStarts(pids) : new Map();
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
 * One attempt to take `weight` units of a resource with a capacity above 1. Under the resource's
 * admission mutex: stale holders are removed (and logged as takeovers), the live weights are
 * summed, and the holder is recorded if its weight fits. Asking again as a holder renews it and
 * keeps the weight it holds.
 * @param {LockContext} ctx @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart @param {number} ttlMs @param {number} weight @param {number} capacity
 * @returns {Promise<{ taken: true, record: LockRecord, renewed?: boolean }
 *   | { taken: false, held_by: LockRecord | null, used: number }>}
 */
async function attemptWeighted(ctx, resource, holder, pid, pidStart, ttlMs, weight, capacity) {
  const dir = holdersDir(ctx, resource);
  mkdirSync(dir, { recursive: true });
  /** @type {{ previous_holder: string | null, reason: string }[]} */
  const takeovers = [];
  const result = await withMutex(`${dir}.admit`, () => {
    const now = Date.now();
    const holders = readHolders(ctx, resource);
    const singlePath = lockFile(ctx, resource);
    const single = readLock(singlePath);
    const starts = startsFor([...holders.map((h) => h.record), single], now);
    // The caller already holds the single lock (taken while this resource had capacity 1):
    // asking again renews that, rather than taking a second hold beside it.
    if (single && single.holder === holder && !staleReason(single, now, starts)) {
      const renewed = {
        ...newRecord(resource, holder, pid, pidStart, ttlMs),
        acquired_at: single.acquired_at,
      };
      writeFileSync(singlePath, JSON.stringify(renewed) + '\n');
      return { taken: /** @type {const} */ (true), record: renewed, renewed: true };
    }
    /** @type {LockRecord | null} */
    let own = null;
    /** @type {LockRecord[]} */
    const live = [];
    for (const h of holders) {
      if (h.record && h.record.holder === holder) {
        own = h.record;
        continue;
      }
      const reason = staleReason(h.record, now, starts);
      if (reason) {
        rmSync(h.path, { force: true });
        takeovers.push({ previous_holder: h.record?.holder ?? null, reason });
        continue;
      }
      live.push(/** @type {LockRecord} */ (h.record));
    }
    // A live single lock file (taken by a caller that sees capacity 1) fills the resource.
    const singleLive = single && !staleReason(single, now, starts);
    const used = singleLive ? capacity : live.reduce((n, r) => n + weightOf(r), 0);
    const path = holderFile(ctx, resource, holder);
    if (own) {
      const renewed = {
        ...newRecord(resource, holder, pid, pidStart, ttlMs, own.acquired_at),
        weight: weightOf(own),
      };
      writeHolder(path, renewed);
      return { taken: /** @type {const} */ (true), record: renewed, renewed: true };
    }
    if (used + weight > capacity) {
      return {
        taken: /** @type {const} */ (false),
        held_by: singleLive ? single : (live[0] ?? null),
        used,
      };
    }
    const record = { ...newRecord(resource, holder, pid, pidStart, ttlMs), weight };
    writeHolder(path, record);
    // The single lock is taken without this mutex, by a caller that sees capacity 1. Each side
    // writes its own record first and then looks for the other's, so of two that arrive together
    // at least one sees the other and backs out: at worst both refuse, never both hold.
    const after = readLock(singlePath);
    if (after && after.holder !== holder && !staleReason(after, Date.now())) {
      rmSync(path, { force: true });
      return { taken: /** @type {const} */ (false), held_by: after, used: capacity };
    }
    return { taken: /** @type {const} */ (true), record };
  });
  for (const t of takeovers) ctx.log?.('lock_takeover', { resource, holder, ...t });
  return result;
}

/**
 * The live weighted holders of a resource, other than `holder`. They exist beside a caller that
 * sees capacity 1 only when the machine profile's capacity changed under live holders, or when
 * callers read different profiles.
 * @param {LockContext} ctx @param {string} resource @param {string} holder
 * @returns {LockRecord[]}
 */
function liveWeightedBesides(ctx, resource, holder) {
  const now = Date.now();
  const holders = readHolders(ctx, resource).map((h) => h.record);
  const starts = startsFor(holders, now);
  return /** @type {LockRecord[]} */ (
    holders.filter((r) => r && r.holder !== holder && !staleReason(r, now, starts))
  );
}

/**
 * Take a resource that has capacity 1 for this caller: the single lock, unchanged, with two checks
 * for weighted holders written by callers that see a larger capacity. Before: a live weighted
 * holder keeps it held, and the caller's own weighted hold is renewed instead of taking a second.
 * After: having written the lock, it looks again (the other side does the same, see
 * attemptWeighted), and backs out if a weighted holder came in meanwhile.
 * @param {LockContext} ctx @param {string} resource @param {string} holder @param {number} pid
 * @param {string | null} pidStart @param {number} ttlMs
 * @returns {Promise<{ taken: true, record: LockRecord, renewed?: boolean } | { taken: false, held_by: LockRecord | null }>}
 */
async function attemptSerial(ctx, resource, holder, pid, pidStart, ttlMs) {
  const ownPath = holderFile(ctx, resource, holder);
  const own = readLock(ownPath);
  if (own && own.holder === holder && !staleReason(own, Date.now())) {
    const renewed = {
      ...newRecord(resource, holder, pid, pidStart, ttlMs, own.acquired_at),
      weight: weightOf(own),
    };
    writeHolder(ownPath, renewed);
    return { taken: true, record: renewed, renewed: true };
  }
  const before = liveWeightedBesides(ctx, resource, holder);
  if (before.length) return { taken: false, held_by: before[0] };
  const r = await attempt(ctx, resource, holder, pid, pidStart, ttlMs);
  if (!r.taken || r.renewed) return r;
  const after = liveWeightedBesides(ctx, resource, holder);
  if (!after.length) return r;
  const path = lockFile(ctx, resource);
  if (readLock(path)?.holder === holder) rmSync(path, { force: true });
  return { taken: false, held_by: after[0] };
}

/**
 * Who holds a resource now, for a refusal: the single lock's holder, else the oldest weighted one.
 * @param {LockContext} ctx @param {string} resource @returns {LockRecord | null}
 */
function currentHolder(ctx, resource) {
  const single = readLock(lockFile(ctx, resource));
  if (single) return single;
  return readHolders(ctx, resource).find((h) => h.record)?.record ?? null;
}

/**
 * Acquire a serial resource for a holder, taking `weight` units of its capacity (default 1). A
 * weight above the resource's capacity could never be granted and is refused.
 *
 * Without `wait`, returns at once, taken or not. With `wait`, the caller queues behind earlier
 * arrivals and polls until it is first and the lock is free, or `timeoutMs` passes. A holder that
 * asks for a lock it already holds renews it. The lock follows `pid` (default: this process); an
 * in-process handle renews it on a timer, so it expires only if this process stops.
 * @param {LockContext} ctx
 * @param {{ resource: string, holder: string, pid?: number, ttlSeconds?: number, wait?: boolean,
 *   timeoutMs?: number, pollMs?: number, autoRenew?: boolean, weight?: number }} request
 * @returns {Promise<{ acquired: true, handle: LockHandle, record: LockRecord, waited_ms: number }
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
  const weighted = capacity > 1;
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
        const r = weighted
          ? await attemptWeighted(ctx, resource, holder, pid, pidStart, ttlMs, weight, capacity)
          : await attemptSerial(ctx, resource, holder, pid, pidStart, ttlMs);
        if (r.taken) {
          dropTicket();
          const waited = Date.now() - started;
          if (queued) ctx.log?.('lock_wait', { resource, holder, waited_ms: waited });
          ctx.log?.('lock_acquired', {
            resource,
            holder,
            pid,
            renewed: r.renewed ?? false,
            ...(r.record.weight === undefined ? {} : { weight: r.record.weight, capacity }),
          });
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
              r.record.weight ?? null,
            ),
          };
        }
        if (!request.wait) {
          return { acquired: false, held_by: r.held_by, waited_ms: 0, timed_out: false, capacity };
        }
      } else if (!request.wait) {
        const held = currentHolder(ctx, resource);
        return { acquired: false, held_by: held, waited_ms: 0, timed_out: false, capacity };
      }
      if (Date.now() >= deadline) {
        dropTicket();
        return {
          acquired: false,
          held_by: currentHolder(ctx, resource),
          waited_ms: Date.now() - started,
          timed_out: true,
          capacity,
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
 * @param {number | null} weight the weight held, for a resource with a capacity above 1
 * @returns {LockHandle}
 */
function makeHandle(ctx, resource, holder, pid, pidStart, ttlMs, autoRenew, weight) {
  const path = weight === null ? lockFile(ctx, resource) : holderFile(ctx, resource, holder);
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const renew = () => {
    const cur = readLock(path);
    if (!cur || cur.holder !== holder) return;
    const record = newRecord(resource, holder, pid, pidStart, ttlMs, cur.acquired_at);
    if (weight === null) writeFileSync(path, JSON.stringify(record) + '\n');
    else writeHolder(path, { ...record, weight });
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
  // Both of the holder's records go: its weighted one and the single lock, if it has either.
  const own = holderFile(ctx, resource, holder);
  const ownWeighted = readLock(own)?.holder === holder;
  if (ownWeighted) rmSync(own, { force: true });
  const path = lockFile(ctx, resource);
  const cur = readLock(path);
  const ownSingle = cur?.holder === holder;
  if (ownSingle) rmSync(path, { force: true });
  if (ownWeighted || ownSingle) {
    ctx.log?.('lock_released', { resource, holder });
    return { released: true };
  }
  if (!cur) return { released: false };
  return { released: false, held_by: cur.holder };
}

/**
 * Who holds what, and who waits, for the named resources. `held_by` and `stale` describe one
 * holder: a live one when there is any (the single lock's first, else the oldest weighted), so
 * `held_by && !stale` means "some live holder"; otherwise the single lock's record, stale or
 * unreadable, as before. `holders` lists every holder with its weight; `used` counts a live single
 * lock as the whole capacity, else sums the live weights, as admission does. It passes `capacity`
 * only when the profile's capacity was lowered under live holders.
 * @param {LockContext} ctx @param {string[]} resources
 */
export function lockStatus(ctx, resources) {
  const now = Date.now();
  return resources.map((resource) => {
    const capacity = capacityOf(ctx, checkResource(resource));
    const single = readLock(lockFile(ctx, resource));
    const weighted = readHolders(ctx, resource);
    const starts = startsFor([single, ...weighted.map((h) => h.record)], now);
    const all = [
      ...(single === undefined ? [] : [{ record: single, weight: capacity, single: true }]),
      ...weighted.map((h) => ({ record: h.record, weight: weightOf(h.record), single: false })),
    ].map((h) => ({ ...h, stale: staleReason(h.record, now, starts) }));
    const live = all.find((h) => !h.stale);
    /** @type {LockRecord | null | undefined} */
    const record = live ? live.record : single !== undefined ? single : weighted[0]?.record;
    const singleLive = all.some((h) => h.single && !h.stale);
    const used = singleLive
      ? capacity
      : all.filter((h) => !h.stale).reduce((n, h) => n + h.weight, 0);
    const holders = all.map((h) => ({
      holder: h.record?.holder ?? null,
      weight: h.weight,
      stale: h.stale,
    }));
    const waiting = liveQueue(ctx, resource).map((t) => {
      try {
        return JSON.parse(readFileSync(join(queueDir(ctx, resource), t), 'utf8')).holder;
      } catch {
        return null;
      }
    });
    return {
      resource,
      capacity,
      used,
      held_by: record?.holder ?? null,
      stale: record === undefined ? false : staleReason(record, now, starts),
      record: record ?? null,
      holders,
      waiting,
    };
  });
}
