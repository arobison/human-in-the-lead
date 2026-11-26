// Locks on serial resources (design part 13.2): the GPU, benchmark runs, a named fixture, the
// merge queue. Machine-wide, so two projects on one machine share them: they live in a directory
// beside the project stores, not inside one. Waiters queue in arrival order. A lock is stale when
// its holder's process is gone (or has been replaced by another with the same ID, or the machine
// restarted); the next taker then takes it over. A holder whose process is alive and can be told
// to be the very one is never taken over by the clock (HITLD-1052): its expiry is the limit only
// when its liveness cannot be checked (another host, or no start time). A hung live holder is
// ended by a forced release (`env unlock --force`, or the watchdog's teardown), which is logged.
//
// A resource has a capacity (design 13.4, HITLD-41): the machine profile's `capacity` gives the
// weight units it takes, and each holder takes a weight. A resource with no entry has capacity 1
// and keeps the single lock file above, unchanged. A resource with a larger capacity records each
// holder in its own file under <resource>.holders/, admitted while the live weights fit. Either
// way only the first in the queue may try, so a heavy holder waiting at the head is not overtaken
// by light ones that arrive after it.
//
// A holder name is one process's (HITLD-1050, HITLD-1052): a record names its holder and the
// process it follows (pid, start time and the machine's boot), and carries its grant's random
// token. A live holder that asks again from that process is renewed, keeping its token, before the
// queue is looked at, so it never waits behind waiters that wait on it. Another process asking
// under a name a live holder has is refused, with the holder named; once that holder is stale, the
// name is taken over like any other lock. Two callers in one process under one name share the one
// grant: each gets a handle, and the record goes when the last of them releases (a count kept in
// this process), so one handle's release never removes the other's hold. A handle renews and
// releases by its token, so a stale handle removes nothing of a later holder's.
//
// A waiter backs off from 50 ms to 1 s, with jitter, between looks; a change in the locks
// directory (fs.watch) wakes it early, as a hint only: every wake-up decides on the whole state
// again. It takes a timeout and an abort signal, and its ticket goes however it ends, on exit and
// on SIGINT or SIGTERM too (the signal is raised again once the ticket and this process's own
// holds are gone). A process's identity is read the same in every time zone: on Linux its start
// tick from /proc (no process started), elsewhere its start time from `ps` in UTC, cached, so a
// waiter does not start a `ps` on every look.
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

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { checkHolder } from './config.mjs';
import { withMutexSync } from './mutex.mjs';
import { isAlive, processStart, readStarts } from './proc.mjs';
import {
  LOCK_FORMAT,
  SINGLE,
  decide,
  holderSlot,
  parseTicket,
  staleReason,
  startsWanted,
  ticketGone,
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
 * @property {string} token the grant's token
 * @property {() => void} renew
 * @property {() => boolean} release whether this handle's hold was given up (false the second
 *   time); the record goes when the last handle in this process on the same grant releases
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

/** This machine's boot, read once: Linux's boot ID, else the kernel's boot time; null if neither. */
let boot = /** @type {string | null | undefined} */ (undefined);

/** @returns {string | null} */
export function bootId() {
  if (boot !== undefined) return boot;
  boot = null;
  try {
    boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
  } catch {
    if (process.platform !== 'win32') {
      try {
        const out = execFileSync('sysctl', ['-n', 'kern.boottime'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5_000,
        });
        const sec = /sec = (\d+)/.exec(out)?.[1];
        boot = sec ? `boottime-${sec}` : null;
      } catch {
        // not known: records carry no boot, and the start time alone tells processes apart
      }
    }
  }
  return boot;
}

/**
 * How long a start time read by `ps` (or PowerShell) is trusted without a Linux start tick to key
 * it by: a moment where `ps` is cheap; longer on Windows, where each lookup is a PowerShell call
 * of most of a second, and a process reusing a pid within that time is all it could miss.
 */
const START_CACHE_MS = process.platform === 'win32' ? 30_000 : 2_000;
/** @type {Map<string, { key: string | null, start: string | null, at: number }>} */
const startCache = new Map();
/** How many times a start-time lookup started a process (`ps`, PowerShell), for the tests. */
export const probes = { runs: 0 };

/**
 * A process's start tick on Linux (field 22 of /proc/<pid>/stat): a file read, not a process, the
 * same for every reader whatever its time zone or locale, and a different value for a later
 * process that reuses the pid. Null elsewhere, or where /proc does not show it.
 * @param {number} pid @returns {string | null}
 */
function startTick(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return text.slice(text.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

/** Whether this machine shows processes' start ticks in /proc (Linux), judged once. */
let procfs = /** @type {boolean | undefined} */ (undefined);
const hasProcfs = () => (procfs ??= startTick(process.pid) !== null);

/**
 * Start times read by `ps` (PowerShell on Windows), cached: on Linux for as long as the pid has
 * the same start tick, elsewhere for a moment. `utc`: read in UTC with the C locale, the same for
 * every caller; otherwise as the caller's `ps` prints it, the text older copies wrote in their
 * records. A pid the lookup ran for but could not read maps to null; one it could not run for
 * (the tool failed or timed out) is missing, and that is not cached.
 * @param {number[]} pids @param {boolean} utc @returns {Map<number, string | null>}
 */
function psStarts(pids, utc) {
  /** @type {Map<number, string | null>} */
  const out = new Map();
  /** @type {[number, string | null][]} */
  const need = [];
  for (const pid of pids) {
    const key = startTick(pid);
    const c = startCache.get(`${utc ? 'u' : 'l'}${pid}`);
    const valid =
      !!c &&
      c.key === key &&
      ((key !== null && c.start !== null) || performance.now() - c.at < START_CACHE_MS);
    if (valid && c) out.set(pid, c.start);
    else need.push([pid, key]);
  }
  if (need.length) {
    probes.runs++;
    const found = readStarts(
      need.map(([p]) => p),
      { utc },
    );
    if (found) {
      for (const [pid, key] of need) {
        const start = found.get(pid) ?? null;
        startCache.set(`${utc ? 'u' : 'l'}${pid}`, { key, start, at: performance.now() });
        out.set(pid, start);
      }
    }
  }
  if (startCache.size > 1024) startCache.clear();
  return out;
}

/**
 * Processes' identities as records and tickets carry them (`start`), read the same by every
 * caller: where /proc shows start ticks (Linux), the tick (`tick:<n>`, no process started), and
 * null for a process whose tick it does not show (another user's, under hidepid); elsewhere the
 * start time in UTC (`utc:<text>`), null for one the lookup could not read. A pid is missing when
 * the lookup itself failed: nothing is known of it this time.
 * @param {number[]} pids @returns {Map<number, string | null>}
 */
function identities(pids) {
  /** @type {Map<number, string | null>} */
  const out = new Map();
  if (hasProcfs()) {
    for (const pid of pids) {
      const tick = startTick(pid);
      out.set(pid, tick === null ? null : `tick:${tick}`);
    }
    return out;
  }
  for (const [pid, s] of psStarts(pids, true)) out.set(pid, s === null ? null : `utc:${s}`);
  return out;
}

/**
 * A process's identity as a record carries it, or null when it cannot be read (or the lookup
 * failed).
 * @param {number} pid @returns {string | null}
 */
export function processIdentity(pid) {
  return identities([pid]).get(pid) ?? null;
}

/**
 * The processes the records and tickets name: whether each is alive, and the identity (`start`)
 * or, for an older copy's record, the caller's start time text (`legacy`) of those staleReason
 * and ticketGone will ask for: null where the lookup could not read it, absent where the lookup
 * itself failed.
 * @param {(LockRecord | null)[]} records @param {import('./lockcore.mjs').Ticket[]} queue
 * @param {number} now @param {string} host
 * @returns {import('./lockcore.mjs').Procs}
 */
function procsFor(records, queue, now, host) {
  /** @type {import('./lockcore.mjs').Procs} */
  const procs = {};
  for (const r of records) if (r && r.host === host) procs[r.pid] = { alive: isAlive(r.pid) };
  for (const t of queue) procs[t.pid] ??= { alive: isAlive(t.pid) };
  const wanted = startsWanted(records, now, host, queue);
  const stable = wanted.stable.filter((p) => procs[p]?.alive);
  if (stable.length) {
    const found = identities(stable);
    for (const p of stable) if (found.has(p)) procs[p].start = found.get(p) ?? null;
  }
  const legacy = wanted.legacy.filter((p) => procs[p]?.alive);
  if (legacy.length) {
    const found = psStarts(legacy, false);
    for (const p of legacy) if (found.has(p)) procs[p].legacy = found.get(p) ?? null;
  }
  return procs;
}

/**
 * A ticket as its file names it and says: the waiter's name, identity, boot and format, where its
 * content has them (an older copy's has only the name and pid).
 * @param {string} dir @param {string} name @returns {import('./lockcore.mjs').Ticket}
 */
function readTicket(dir, name) {
  const t = parseTicket(name);
  try {
    const c = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (typeof c?.holder === 'string') t.holder = c.holder;
    if (typeof c?.start === 'string') t.start = c.start;
    if (typeof c?.boot === 'string') t.boot = c.boot;
    if (Number.isInteger(c?.v)) t.v = c.v;
  } catch {
    // gone, or not readable: its pid still says whether its waiter lives
  }
  return t;
}

/**
 * Everything `decide` looks at for a resource, read now.
 * @param {LockContext} ctx @param {string} resource @returns {LockState}
 */
function readState(ctx, resource) {
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
  const qdir = queueDir(ctx, resource);
  const queue = list(qdir)
    .filter((n) => n.endsWith('.t'))
    .map((n) => readTicket(qdir, n));
  const records = [single?.record ?? null, ...holders.map((h) => h.record)];
  return {
    resource,
    capacity: capacityOf(ctx, resource),
    now,
    host,
    boot: bootId(),
    single,
    holders,
    queue,
    procs: procsFor(records, queue, now, host),
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
        writeWhole(
          join(dir, e.ticket.name),
          JSON.stringify({
            holder: e.ticket.holder ?? null,
            pid: e.ticket.pid,
            start: e.ticket.start ?? null,
            boot: e.ticket.boot ?? null,
            v: LOCK_FORMAT,
          }) + '\n',
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
          start: ev.start,
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

// ---------------------------------------------------------------------------------------------
// This process's part: the grants its handles share, and what goes when it exits or is signalled.

/** Handles in this process on one grant (resource file and token): the record goes with the last. */
/** @type {Map<string, number>} */
const shared = new Map();

/** What to undo if this process exits or is stopped by a signal: tickets and its own holds. */
/** @type {Set<() => void>} */
const onExit = new Set();
const SIGNALS = /** @type {const} */ (['SIGINT', 'SIGTERM']);

const runExit = () => {
  for (const f of [...onExit]) {
    try {
      f();
    } catch {
      // the process is ending: undo what can be undone
    }
  }
  onExit.clear();
};

/** @param {NodeJS.Signals} signal */
function onSignal(signal) {
  runExit();
  uninstall();
  // Raised again for the default action, unless the program has its own handler for it.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
/** @type {Record<string, () => void>} */
const handlers = Object.fromEntries(SIGNALS.map((sig) => [sig, () => onSignal(sig)]));
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', runExit);
  for (const sig of SIGNALS) process.on(sig, handlers[sig]);
}
function uninstall() {
  if (!installed) return;
  installed = false;
  process.off('exit', runExit);
  for (const sig of SIGNALS) process.off(sig, handlers[sig]);
}

/** @param {() => void} f @returns {() => void} that forgets it */
function atExit(f) {
  onExit.add(f);
  install();
  return () => {
    onExit.delete(f);
    if (onExit.size === 0) uninstall();
  };
}

/**
 * A waiter's sleep: up to `ms`, ended early by a change in the resource's directories (a hint
 * only: the waiter decides on the whole state again) or by its abort signal.
 * @param {LockContext} ctx @param {string} resource @param {AbortSignal | undefined} signal
 */
function waker(ctx, resource, signal) {
  /** @type {(() => void) | null} */
  let wake = null;
  const poke = () => wake?.();
  /** @type {import('node:fs').FSWatcher[]} */
  const watchers = [];
  // Only the files a decision reads: the single lock, tickets and weighted records. The critical
  // section's mutex directories and the temporary files records are written through are not, or
  // a waiter's own decision would wake it again at once.
  const lock = `${physical(ctx, resource)}.lock`;
  /** @type {[string, (name: string) => boolean][]} */
  const dirs = [
    [locksDir(ctx), (n) => n === lock],
    [queueDir(ctx, resource), (n) => n.endsWith('.t')],
    [holdersDir(ctx, resource), (n) => n.endsWith('.json')],
  ];
  for (const [d, wanted] of dirs) {
    try {
      const w = watch(d, { persistent: false }, (_event, name) => {
        if (name === null || wanted(String(name))) poke();
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch {
      // not there yet, or not watchable here: the backoff alone paces the waiter
    }
  }
  signal?.addEventListener('abort', poke);
  return {
    /** @param {number} ms @returns {Promise<void>} */
    sleep: (ms) =>
      new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          wake = null;
          resolve();
        };
        const t = setTimeout(done, Math.max(0, ms));
        wake = done;
      }),
    /** End the current sleep now. */
    wake: poke,
    close() {
      signal?.removeEventListener('abort', poke);
      for (const w of watchers) w.close();
    },
  };
}

/** A delay with jitter: between three quarters and five quarters of `ms`. @param {number} ms */
const jitter = (ms) => Math.max(1, Math.round(ms * (0.75 + Math.random() * 0.5)));

/**
 * Acquire a serial resource for a holder, taking `weight` units of its capacity (default 1). A
 * weight above the resource's capacity could never be granted and is refused.
 *
 * Without `wait`, returns at once, taken or not. With `wait`, the caller queues behind earlier
 * arrivals and looks again, backing off from `pollMs` (50 ms) to `maxPollMs` (1 s) with jitter
 * and woken early by changes in the locks directory, until it is first and the lock is free,
 * `timeoutMs` passes or `signal` aborts. Its ticket is written in the same decision as its first
 * attempt, so no one who asks after it gets in first, and it goes however the wait ends (on exit
 * and SIGINT or SIGTERM too). The lock follows `pid` (default: this process): while that process
 * lives and can be told to be the very one, the lock is never taken over, whatever its expiry; an
 * in-process handle renews it on a timer too, for the case its liveness cannot be checked.
 *
 * A holder that asks for a lock it already holds renews it, at once, with or without `wait` and
 * whether or not others are queued: its hold is looked for before the queue, and it keeps the
 * weight and the token it holds (`renewed` is true). Its hold is the live record under its name
 * written for the same process (pid, start time and boot). Two callers in this process under one
 * name share the grant: the record goes when the last of their handles releases. Another process
 * asking under a name a live holder has is refused at once, never queued, with that holder in
 * `held_by`; once that holder is stale, the name is taken over like any other lock.
 * @param {LockContext} ctx
 * @param {{ resource: string, holder: string, pid?: number, ttlSeconds?: number, wait?: boolean,
 *   timeoutMs?: number, pollMs?: number, maxPollMs?: number, signal?: AbortSignal,
 *   autoRenew?: boolean, weight?: number }} request
 * @returns {Promise<{ acquired: true, handle: LockHandle, record: LockRecord, waited_ms: number,
 *       renewed: boolean }
 *   | { acquired: false, held_by: LockRecord | null, waited_ms: number, timed_out: boolean,
 *       aborted: boolean, capacity: number }>}
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
  // `pid_start` as `ps` prints it here, for older copies; `start`, the identity this copy compares.
  const pidStart = processStart(pid);
  const start = processIdentity(pid);
  const selfStart = processIdentity(process.pid);
  const ttlMs = (request.ttlSeconds ?? 300) * 1000;
  const pollMs = request.pollMs ?? 50;
  const maxPollMs = Math.max(pollMs, request.maxPollMs ?? 1000);
  const wait = request.wait === true;
  const signal = request.signal;
  const started = Date.now();
  const deadline = request.timeoutMs === undefined ? Infinity : started + request.timeoutMs;
  const token = randomBytes(8).toString('hex');
  /** @type {string | null} */
  let ticket = null;
  let queued = false;
  // A ticket goes on exit or a signal, as it does when the wait ends. A program with its own
  // handler for the signal keeps running: the wait then ends too (as an abort), so it cannot
  // write a new ticket that nothing would remove.
  let ended = false;
  /** @type {ReturnType<typeof waker> | null} */
  let wake = null;
  const forget = atExit(() => {
    ended = true;
    if (ticket !== null) leave(ctx, resource, ticket);
    ticket = null;
    wake?.wake();
  });

  /** @returns {LockEvent} */
  const ask = () => ({
    type: 'ask',
    holder,
    pid,
    pidStart,
    start,
    self: process.pid,
    selfStart,
    weight,
    wait,
    ticket,
    ttlMs,
    nonce: randomBytes(3).toString('hex'),
    token,
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
      handle: makeHandle(ctx, resource, {
        holder,
        pid,
        token: r.record.token ?? token,
        ttlMs,
        autoRenew: request.autoRenew !== false,
        weight: r.record.weight ?? null,
      }),
    };
  };
  /** @param {LockRecord | null} by @param {{ timedOut?: boolean, aborted?: boolean }} how */
  const notAcquired = (by, how) => ({
    acquired: /** @type {const} */ (false),
    held_by: by,
    waited_ms: Date.now() - started,
    timed_out: how.timedOut === true,
    aborted: how.aborted === true,
    capacity,
  });

  wake = wait ? waker(ctx, resource, signal) : null;
  let delay = pollMs;
  let head = false;
  try {
    for (;;) {
      if (ended || (wait && signal?.aborted)) {
        return notAcquired(currentHolder(ctx, resource), { aborted: true });
      }
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
        if (r.conflict) return notAcquired(r.held_by, {});
        return { ...notAcquired(r.held_by, {}), waited_ms: 0 };
      }
      if (r.kind !== 'queued') throw new Error(`an ask was decided as ${r.kind}`);
      ticket = r.ticket;
      queued = true;
      if (Date.now() >= deadline) {
        return notAcquired(currentHolder(ctx, resource), { timedOut: true });
      }
      // Back off between looks: pollMs first, and again on reaching the head of the line, then
      // doubling with jitter up to maxPollMs. A release wakes the waiter through the watch; a
      // holder killed outright is found at the next look, within maxPollMs.
      if (r.turn && !head) delay = pollMs;
      head = r.turn;
      const left = deadline - Date.now();
      const pause = delay === pollMs ? pollMs : jitter(delay);
      await /** @type {NonNullable<typeof wake>} */ (wake).sleep(
        Math.min(pause, maxPollMs, Math.max(1, left)),
      );
      delay = Math.min(maxPollMs, delay * 2);
    }
  } finally {
    wake?.close();
    if (ticket !== null) leave(ctx, resource, ticket);
    forget();
  }
}

/**
 * A waiter's poll, read without the critical section: when it is still not first in line and
 * nothing needs changing, that is the answer, and the waiter has not taken the mutex every poll.
 * Anything else (its turn, a dead ticket to drop) is decided again inside the critical section.
 * @param {LockContext} ctx @param {string} resource @param {LockEvent} event
 * @returns {Outcome | null}
 */
function peek(ctx, resource, event) {
  const d = decide(readState(ctx, resource), event);
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
  boot: null,
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
 * A handle on a grant. Its renewals and its release go by the grant's token. Handles in this
 * process on the same grant share it: the record goes with the last one's release. A hold that
 * follows this process is given up on exit and on SIGINT or SIGTERM; one that follows another
 * process (the command line's, which follows its caller) is left for that process.
 * @param {LockContext} ctx @param {string} resource
 * @param {{ holder: string, pid: number, token: string, ttlMs: number, autoRenew: boolean,
 *   weight: number | null }} h
 * @returns {LockHandle}
 */
function makeHandle(ctx, resource, h) {
  const key = `${lockFile(ctx, resource)}\n${h.token}`;
  shared.set(key, (shared.get(key) ?? 0) + 1);
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let released = false;
  const renew = () => {
    const r = step(ctx, resource, {
      type: 'renew',
      holder: h.holder,
      token: h.token,
      ttlMs: h.ttlMs,
      weight: h.weight,
    });
    // Its grant is gone (forced off, or taken over): nothing is left for the timer to renew.
    if (r.kind === 'lost' && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const drop = () =>
    step(ctx, resource, { type: 'release', holder: h.holder, token: h.token }).kind === 'released';
  if (h.autoRenew) {
    timer = setInterval(renew, Math.max(1000, Math.floor(h.ttlMs / 3)));
    timer.unref();
  }
  const forget =
    h.pid === process.pid
      ? atExit(() => {
          if (!shared.has(key)) return;
          shared.delete(key);
          // Nothing to release where the locks directory is gone, and the critical section
          // would make it again.
          if (existsSync(locksDir(ctx))) drop();
        })
      : () => {};
  return {
    resource,
    holder: h.holder,
    token: h.token,
    renew,
    release() {
      if (released) return false;
      released = true;
      if (timer) clearInterval(timer);
      forget();
      const left = (shared.get(key) ?? 1) - 1;
      if (left > 0) {
        shared.set(key, left);
        return true;
      }
      shared.delete(key);
      // Its own record only, by token: one taken over since (under the same name or not) stays.
      return drop();
    },
  };
}

/**
 * Release a lock by its holder's name, as the command line and the manager do. With `token`, only
 * the grant with that token goes. Without it, the name's records written for `pid` (default this
 * process) go, and any that are stale; a live hold of another process under the name stays, and
 * is named (`pid`). With `force`, the name's records go whoever holds them, logged as
 * `lock_forced` with the holders' identities: the way to end a hung but live holder. Asking for
 * someone else's name, or asking again, removes nothing.
 * @param {LockContext} ctx
 * @param {{ resource: string, holder: string, pid?: number, token?: string, force?: boolean }} request
 * @returns {{ released: boolean, held_by?: string, pid?: number }}
 */
export function releaseLock(ctx, request) {
  const resource = checkResource(request.resource);
  const holder = checkHolder(request.holder);
  /** @type {LockEvent} */
  let event;
  const self = process.pid;
  if (request.force && request.pid !== undefined) {
    throw new Error("a forced release takes no pid: it removes the name's holds whoever has them");
  }
  if (request.token !== undefined) {
    event = { type: 'release', holder, token: request.token, self };
  } else if (request.force) event = { type: 'release', holder, force: true, self };
  else {
    const pid = request.pid ?? process.pid;
    event = {
      type: 'release',
      holder,
      pid,
      pidStart: processStart(pid),
      start: processIdentity(pid),
      self,
    };
  }
  const r = step(ctx, resource, event);
  if (r.kind === 'released') return { released: true };
  if (r.kind !== 'kept' || r.held_by === null) return { released: false };
  return { released: false, held_by: r.held_by, ...(r.by ? { pid: r.by.pid } : {}) };
}

/** @param {LockRecord | null} r */
const legacy = (r) => !!r && r.v === undefined;

/**
 * Who holds what, and who waits, for the named resources. `held_by` and `stale` describe one
 * holder: a live one when there is any (the single lock's first, else the oldest weighted), so
 * `held_by && !stale` means "some live holder"; otherwise the single lock's record, stale or
 * unreadable, as before. `holders` lists every holder with its weight, its identity (pid, start
 * time, host, boot), its age and its last renewal; `waiters` every live waiter with how long it
 * has waited (`waiting` keeps only their names). `used` counts a live single lock as the whole
 * capacity, else sums the live weights, as admission does. Records and tickets an older copy
 * wrote (no format marker) are flagged `legacy` and counted in `legacy`. It only reads: dead
 * waiters' tickets are left for the next decision to drop.
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
    const secs = (/** @type {string | undefined} */ iso) =>
      iso ? Math.max(0, Math.round((s.now - Date.parse(iso)) / 1000)) : null;
    const holders = all.map((h) => {
      const r = h.slot.record;
      return {
        holder: r?.holder ?? null,
        weight: h.weight,
        stale: h.stale,
        ...(r
          ? {
              pid: r.pid,
              pid_start: r.pid_start ?? null,
              host: r.host,
              boot: r.boot ?? null,
              age_s: secs(r.acquired_at),
              renewed_s_ago: secs(r.renewed_at),
              expires_at: r.expires_at,
              legacy: legacy(r),
            }
          : {}),
      };
    });
    const tickets = [...s.queue]
      .filter((t) => !ticketGone(t, s))
      .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1));
    const waiters = tickets.map((t) => ({
      holder: t.holder ?? null,
      pid: t.pid,
      waited_s: Math.max(0, Math.round((s.now - t.n) / 1000)),
      legacy: t.v === undefined,
    }));
    const old = {
      records: all.filter((h) => legacy(h.slot.record)).length,
      tickets: waiters.filter((w) => w.legacy).length,
    };
    return {
      resource,
      capacity,
      used,
      held_by: chosen?.slot.record?.holder ?? null,
      stale: chosen ? chosen.stale : false,
      record: chosen?.slot.record ?? null,
      holders,
      waiting: waiters.map((w) => w.holder),
      waiters,
      ...(old.records || old.tickets ? { legacy: old } : {}),
    };
  });
}

/** This copy's root: the directory above core/. */
const SELF_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The copies of the command on PATH that write locks in an older format than this one: each
 * named by the command's path, its install root and its version, when they can be read. A copy
 * is found by following the command to its real file and up to the directory that holds
 * core/lib/env; one whose lock core has no LOCK_FORMAT of at least this copy's is older.
 * @param {string} [pathEnv]
 * @returns {{ path: string, root: string, version: string | null }[]}
 */
export function outdatedCopies(pathEnv = process.env.PATH ?? '') {
  const base = 'hitld';
  const names = process.platform === 'win32' ? [`${base}.cmd`, `${base}.exe`, base] : [base];
  /** @type {{ path: string, root: string, version: string | null }[]} */
  const out = [];
  const seen = new Set([realOr(SELF_ROOT).replace(/[\\/]$/, '')]);
  for (const d of pathEnv.split(delimiter)) {
    if (!d) continue;
    for (const name of names) {
      const bin = join(d, name);
      let real;
      try {
        real = realpathSync(bin);
      } catch {
        continue;
      }
      const root = installRoot(real);
      if (!root || seen.has(root)) continue;
      seen.add(root);
      let core = '';
      try {
        core = readFileSync(join(root, 'core', 'lib', 'env', 'lockcore.mjs'), 'utf8');
      } catch {
        // no lock core there: an older layout
      }
      const format = Number(/export const LOCK_FORMAT = (\d+)/.exec(core)?.[1] ?? 0);
      if (format >= LOCK_FORMAT) continue;
      out.push({ path: bin, root, version: versionAt(root) });
    }
  }
  return out;
}

/** @param {string} p */
function realOr(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** @param {string} file @returns {string | null} */
function installRoot(file) {
  for (let d = dirname(file), i = 0; i < 6; d = dirname(d), i++) {
    if (existsSync(join(d, 'core', 'lib', 'env'))) return d;
    if (dirname(d) === d) break;
  }
  return null;
}

/** @param {string} root @returns {string | null} */
function versionAt(root) {
  for (const f of ['package.json', join('.claude-plugin', 'plugin.json')]) {
    try {
      const v = JSON.parse(readFileSync(join(root, f), 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch {
      // try the next
    }
  }
  return null;
}
