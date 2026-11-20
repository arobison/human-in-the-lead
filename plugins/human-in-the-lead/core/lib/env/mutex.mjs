// A small cross-process mutex: an atomically created directory that records its owner. Stale
// ones (owner gone) are taken over. Used for the registry and for lock takeover, never held long.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/** @param {string} dir @returns {number | null} */
function ownerOf(dir) {
  try {
    const n = Number(readFileSync(join(dir, 'owner'), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** @param {string} dir @param {number} staleMs */
function looksStale(dir, staleMs) {
  const owner = ownerOf(dir);
  if (owner !== null) return !isAlive(owner);
  // No owner file yet: its creator is mid-way, unless it has sat that way for a long time.
  try {
    return Date.now() - statSync(dir).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

/**
 * Who a mutex directory is, so a taker can tell that the directory at the path is still the one it
 * judged. Device, inode and birth time survive a rename; the modification time changes when an
 * owner file is written, which tells a fresh directory from an old one even where an inode number
 * is reused and the birth time is not kept.
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

/**
 * Judge the mutex at `dir` stale, and say which directory was judged: its identity is read before
 * and after the owner, so a holder that released and exited while it was being judged, and the
 * fresh directory the next process made, are never mistaken for a dead holder's.
 * @param {string} dir @param {number} staleMs @returns {DirId | null} the stale one, or null
 */
function staleId(dir, staleMs) {
  const before = idOf(dir);
  if (!before) return null;
  const stale = looksStale(dir, staleMs);
  return stale && sameDir(before, idOf(dir)) ? before : null;
}

/**
 * Move the stale mutex aside, then check that what was moved is the directory that was judged
 * stale and still is; if not (another taker removed that one and a fresh one took its place),
 * put it back. A rename goes by path and cannot be made conditional on what the path names, so
 * the identity is checked just before it and again after. When the move fails (another taker
 * moved it), the caller looks again at once; on Windows, where a file in it may be open for a
 * moment, it returns false so the caller waits first instead of spinning.
 * @param {string} dir @param {DirId} judged @param {number} staleMs @returns {boolean}
 */
function moveAsideIfStale(dir, judged, staleMs) {
  if (!sameDir(judged, idOf(dir))) return true;
  const aside = `${dir}.stale.${process.pid}.${Date.now()}`;
  try {
    renameSync(dir, aside);
  } catch {
    return process.platform !== 'win32';
  }
  try {
    // A rename may touch the moved directory's times on some file systems: compare without them.
    if (sameDir(judged, idOf(aside), { mtime: false }) && looksStale(aside, staleMs))
      rmSync(aside, { recursive: true, force: true, ...RM_RETRY });
    else renameSync(aside, dir);
  } catch {
    // someone else got there first
  }
  return true;
}

/**
 * One attempt at the mutex: create the directory and write the owner. An ENOENT on the owner
 * write means a taker moved the fresh directory aside in between: the race was lost, as with
 * EEXIST, and the loop takes it again.
 * @param {string} dir @param {number} staleMs
 * @returns {'held' | 'again' | 'wait'}
 */
function attempt(dir, staleMs) {
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
  const judged = staleId(dir, staleMs);
  return judged && moveAsideIfStale(dir, judged, staleMs) ? 'again' : 'wait';
}

/**
 * Run `fn` holding the mutex at `dir`.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T> | T} fn
 * @param {{ timeoutMs?: number, pollMs?: number, staleMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withMutex(dir, fn, options = {}) {
  const { timeoutMs = 30_000, pollMs = 15, staleMs = 10_000 } = options;
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const step = attempt(dir, staleMs);
    if (step === 'held') break;
    if (step === 'again') continue;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the lock at ${dir}`);
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true, ...RM_RETRY });
  }
}

/**
 * The same mutex for synchronous callers (the status line, which cannot await): the same
 * directory and owner file, so it excludes `withMutex` holders and is excluded by them. It waits
 * by blocking the thread in short sleeps, so keep `fn` short.
 * @template T
 * @param {string} dir
 * @param {() => T} fn
 * @param {{ timeoutMs?: number, pollMs?: number, staleMs?: number }} [options]
 * @returns {T}
 */
export function withMutexSync(dir, fn, options = {}) {
  const { timeoutMs = 30_000, pollMs = 15, staleMs = 10_000 } = options;
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const step = attempt(dir, staleMs);
    if (step === 'held') break;
    if (step === 'again') continue;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the lock at ${dir}`);
    Atomics.wait(nap, 0, 0, pollMs);
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true, ...RM_RETRY });
  }
}
