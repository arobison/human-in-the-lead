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

/**
 * Move a stale mutex aside, then check that what was moved is what was judged stale; if a live
 * owner slipped in between, put it back. When the move fails (another taker moved it), the
 * caller looks again at once; on Windows, where a file in it may be open for a moment, it returns
 * false so the caller waits first instead of spinning.
 * @param {string} dir @param {number} staleMs @returns {boolean}
 */
function moveAsideIfStale(dir, staleMs) {
  const aside = `${dir}.stale.${process.pid}.${Date.now()}`;
  try {
    renameSync(dir, aside);
  } catch {
    return process.platform !== 'win32';
  }
  try {
    if (looksStale(aside, staleMs)) rmSync(aside, { recursive: true, force: true, ...RM_RETRY });
    else renameSync(aside, dir);
  } catch {
    // someone else got there first
  }
  return true;
}

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
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid}\n`);
      break;
    } catch (e) {
      if (!taken(e)) throw e;
    }
    if (looksStale(dir, staleMs) && moveAsideIfStale(dir, staleMs)) continue;
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
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid}\n`);
      break;
    } catch (e) {
      if (!taken(e)) throw e;
    }
    if (looksStale(dir, staleMs) && moveAsideIfStale(dir, staleMs)) continue;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the lock at ${dir}`);
    Atomics.wait(nap, 0, 0, pollMs);
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true, ...RM_RETRY });
  }
}
