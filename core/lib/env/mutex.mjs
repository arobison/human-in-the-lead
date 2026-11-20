// A small cross-process mutex: an atomically created directory that records its owner. Stale
// ones (owner gone) are taken over. Used for the registry and for lock takeover, never held long.
//
// Taking over goes by path, and a rename cannot be made conditional on which directory the path
// names, so a taker checks the directory's identity before it moves it and what it moved after,
// and puts back anything it should not have taken without ever replacing a directory that is
// there (HITLD-241). Two takers breaking one truly dead holder's mutex in the same few
// microseconds can still leave two holders: closing that needs a breaker mutex or an OS file
// lock, a follow-up the item records.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RM_RETRY } from './fsx.mjs';
import { isAlive, sleep } from './proc.mjs';

/**
 * Whether creating the mutex directory failed because it is there. On Windows a directory still
 * being deleted by its last owner refuses creation with EPERM for a moment: that is the same wait.
 * @param {unknown} e
 */
const taken = (e) => {
  const code = /** @type {NodeJS.ErrnoException} */ (e).code;
  return code === 'EEXIST' || (process.platform === 'win32' && code === 'EPERM');
};

/** How many times in a row the loop may look again at once before it waits a poll. */
const QUICK_TRIES = 3;

/** @param {string} dir @returns {number | null} */
function ownerOf(dir) {
  try {
    const n = Number(readFileSync(join(dir, 'owner'), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** @param {string} dir */
const liveOwner = (dir) => {
  const owner = ownerOf(dir);
  return owner !== null && isAlive(owner);
};

/**
 * Who a mutex directory is, so a taker can tell that the directory at the path is still the one it
 * judged. Device, inode and birth time survive a rename; the modification time changes when an
 * owner file is written, which tells a fresh directory from an old one even where an inode number
 * is reused (ext4 reuses a freed one at once) and the birth time is not kept. On a file system
 * with coarse timestamps (an older kernel's 4 ms ticks) a short-lived directory and its successor
 * could still agree on all four; then only the checks on what was moved, and the put-back, stand
 * between them, as before this identity was read, so the risk is small.
 * @typedef {{ dev: bigint, ino: bigint, birth: bigint, mtime: bigint }} DirId
 * @param {string} dir @returns {DirId | null}
 */
function idOf(dir) {
  try {
    const s = statSync(dir, { bigint: true });
    return { dev: s.dev, ino: s.ino, birth: s.birthtimeNs, mtime: s.mtimeNs };
  } catch {
    return null;
  }
}

/** @param {DirId | null} a @param {DirId | null} b @param {{ mtime?: boolean }} [o] */
const sameDir = (a, b, o = {}) =>
  !!a &&
  !!b &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.birth === b.birth &&
  (o.mtime === false || a.mtime === b.mtime);

/** @param {DirId} id */
const ageMs = (id) => Date.now() - Number(id.mtime / 1_000_000n);

/**
 * What one waiter has seen of an owner-less directory: which one, and since when.
 * @typedef {{ id: DirId | null, since: number }} Seen
 */

/**
 * Judge the mutex at `dir` stale, and say which directory was judged. Stale is a dead owner, or
 * no owner for `staleMs` by its age, or no owner while this waiter watched the same directory for
 * `orphanMs`: a creator writes its owner straight after making the directory, so one left empty
 * that long is an orphan (a creator that lost the race to a taker, whose directory was put back,
 * or one that died between the two steps). The identity is read before and after the owner, so a
 * holder that released and exited while it was being judged, and the fresh directory the next
 * process made, are never mistaken for a dead holder's.
 * @param {string} dir @param {{ staleMs: number, orphanMs: number }} o @param {Seen} seen
 * @returns {DirId | null} the stale one, or null
 */
function staleId(dir, o, seen) {
  const before = idOf(dir);
  if (!before) return null;
  const owner = ownerOf(dir);
  let stale;
  if (owner !== null) {
    seen.id = null;
    stale = !isAlive(owner);
  } else {
    if (!sameDir(seen.id, before)) {
      seen.id = before;
      seen.since = Date.now();
    }
    stale = ageMs(before) > o.staleMs || Date.now() - seen.since >= o.orphanMs;
  }
  return stale && sameDir(before, idOf(dir)) ? before : null;
}

/**
 * Put a directory moved aside by mistake back at the path, without ever replacing what is there.
 * A rename onto an empty directory replaces it on POSIX, so a creator midway (made, not yet
 * written) would lose its directory to ours, write its owner into it and believe it held the
 * mutex beside its rightful holder. So the path is first claimed with a directory of our own,
 * which fails if anyone has it, and the rename replaces only that. On Windows a rename never
 * replaces a directory, so it is tried directly. If the path is taken, the moved directory stays
 * aside under its `.stale.` name: its owner removes it on release, or the sweep once its owner is
 * dead.
 * @param {string} aside @param {string} dir @returns {boolean} whether it went back
 */
function putBack(aside, dir) {
  if (process.platform === 'win32') {
    try {
      renameSync(aside, dir);
      return true;
    } catch {
      return false;
    }
  }
  try {
    mkdirSync(dir);
  } catch {
    return false;
  }
  try {
    renameSync(aside, dir);
    return true;
  } catch {
    try {
      rmdirSync(dir);
    } catch {
      // not empty any more: someone else's now
    }
    return false;
  }
}

/**
 * Move the stale mutex aside, then check that what was moved is the directory that was judged
 * and that it still has no live owner. If not (the path came to name a fresh directory between
 * the judgment and the rename), put it back. When the move fails (another taker moved it), the
 * caller looks again; on Windows, where a file in it may be open for a moment, it returns false so
 * the caller waits first instead of spinning.
 * @param {string} dir @param {DirId} judged @returns {boolean}
 */
function moveAside(dir, judged) {
  const aside = `${dir}.stale.${process.pid}.${Date.now()}`;
  try {
    renameSync(dir, aside);
  } catch {
    return process.platform !== 'win32';
  }
  // A rename may touch the moved directory's times on some file systems: compare without them.
  if (sameDir(judged, idOf(aside), { mtime: false }) && !liveOwner(aside))
    rmSync(aside, { recursive: true, force: true, ...RM_RETRY });
  else putBack(aside, dir);
  return true;
}

/**
 * Remove mutexes left aside next to `dir`: those whose owner is dead, or that have had no owner
 * for `staleMs`; with `mine`, only this process's own. Never one with a live owner.
 * @param {string} dir @param {number} staleMs @param {boolean} [mine]
 */
function sweep(dir, staleMs, mine = false) {
  const prefix = `${basename(dir)}.stale.`;
  let names;
  try {
    names = readdirSync(dirname(dir));
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dirname(dir), name);
    const owner = ownerOf(path);
    const id = owner === null ? idOf(path) : null;
    const drop = mine
      ? owner === process.pid
      : owner !== null
        ? !isAlive(owner)
        : !!id && ageMs(id) > staleMs;
    if (drop) rmSync(path, { recursive: true, force: true, ...RM_RETRY });
  }
}

/**
 * Release: remove the mutex only while it is still ours. If a taker moved ours aside and someone
 * else holds the path now, theirs stays and ours is removed from where it was left.
 * @param {string} dir @param {number} staleMs
 */
function release(dir, staleMs) {
  if (ownerOf(dir) === process.pid) rmSync(dir, { recursive: true, force: true, ...RM_RETRY });
  else sweep(dir, staleMs, true);
}

/**
 * One attempt at the mutex: create the directory and write the owner. An ENOENT on the owner
 * write means a taker moved the fresh directory aside in between: the race was lost, as with
 * EEXIST, and the loop takes it again.
 * @param {string} dir @param {{ staleMs: number, orphanMs: number }} o @param {Seen} seen
 * @returns {'held' | 'again' | 'wait'}
 */
function attempt(dir, o, seen) {
  let made = false;
  try {
    mkdirSync(dir);
    made = true;
    writeFileSync(join(dir, 'owner'), `${process.pid}\n`);
    return 'held';
  } catch (e) {
    const lost = made && /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT';
    if (!lost && !taken(e)) throw e;
    if (lost) return 'again';
  }
  const judged = staleId(dir, o, seen);
  return judged && moveAside(dir, judged) ? 'again' : 'wait';
}

/**
 * @typedef {{ timeoutMs?: number, pollMs?: number, staleMs?: number, orphanMs?: number }} MutexOptions
 * @param {MutexOptions} options
 */
function settings(options) {
  const { timeoutMs = 30_000, pollMs = 15, staleMs = 10_000 } = options;
  return { timeoutMs, pollMs, staleMs, orphanMs: options.orphanMs ?? Math.min(250, staleMs) };
}

/**
 * Take the mutex, waiting with `wait`. Looking again at once is allowed a few times in a row (a
 * taker that just moved a stale one); after that every turn checks the deadline and waits, so a
 * rename that keeps failing (a directory not ours to change) cannot spin past `timeoutMs`.
 * @param {string} dir @param {ReturnType<typeof settings>} o @param {() => unknown} wait
 * @returns {Generator<unknown, void, unknown>}
 */
function* acquire(dir, o, wait) {
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + o.timeoutMs;
  /** @type {Seen} */
  const seen = { id: null, since: 0 };
  for (let quick = 0; ;) {
    const step = attempt(dir, o, seen);
    if (step === 'held') break;
    if (step === 'again' && quick++ < QUICK_TRIES) continue;
    quick = 0;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the lock at ${dir}`);
    yield wait();
  }
  sweep(dir, o.staleMs);
}

/**
 * Run `fn` holding the mutex at `dir`.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T> | T} fn
 * @param {MutexOptions} [options]
 * @returns {Promise<T>}
 */
export async function withMutex(dir, fn, options = {}) {
  const o = settings(options);
  for (const pause of acquire(dir, o, () => sleep(o.pollMs))) await pause;
  try {
    return await fn();
  } finally {
    release(dir, o.staleMs);
  }
}

/**
 * The same mutex for synchronous callers (the status line, which cannot await): the same
 * directory and owner file, so it excludes `withMutex` holders and is excluded by them. It waits
 * by blocking the thread in short sleeps, so keep `fn` short.
 * @template T
 * @param {string} dir
 * @param {() => T} fn
 * @param {MutexOptions} [options]
 * @returns {T}
 */
export function withMutexSync(dir, fn, options = {}) {
  const o = settings(options);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (const _ of acquire(dir, o, () => Atomics.wait(nap, 0, 0, o.pollMs)));
  try {
    return fn();
  } finally {
    release(dir, o.staleMs);
  }
}
