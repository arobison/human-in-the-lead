// A small cross-process mutex: an atomically created directory that records its owner. Stale
// ones (owner gone) are taken over. Used for the registry and for lock takeover, never held long.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAlive, sleep } from './proc.mjs';

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
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    if (looksStale(dir, staleMs)) {
      // Move it aside, then check that what we moved is what we judged stale; if a live owner
      // slipped in between, put it back.
      const aside = `${dir}.stale.${process.pid}.${Date.now()}`;
      try {
        renameSync(dir, aside);
        if (looksStale(aside, staleMs)) rmSync(aside, { recursive: true, force: true });
        else renameSync(aside, dir);
      } catch {
        // someone else got there first
      }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the lock at ${dir}`);
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
