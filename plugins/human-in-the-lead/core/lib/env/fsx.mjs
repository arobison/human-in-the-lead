// File-system calls the environment manager needs to behave the same on Windows as elsewhere.
//
// - realPath: Node's JavaScript realpath keeps Windows short (8.3) names such as AUSTIN~1.ROB,
//   while git and the operating system report the long ones, so two spellings of one directory
//   compare unequal. The native realpath expands them. Elsewhere it is the usual realpath.
// - renameOver: on Windows a rename onto a file that another process (an antivirus scanner, a
//   reader) has open fails for a moment with EPERM, EBUSY or EACCES. It is retried a few times,
//   briefly. Elsewhere a rename is atomic and is never retried.

import { realpathSync, renameSync } from 'node:fs';

const WIN = process.platform === 'win32';

/**
 * The canonical path: links resolved and, on Windows, short names expanded.
 * @param {string} path @returns {string}
 */
export function realPath(path) {
  return WIN ? realpathSync.native(path) : realpathSync(path);
}

/** The codes a held file gives a rename on Windows. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_TRIES = 8;
const nap = new Int32Array(new SharedArrayBuffer(4));

/**
 * Rename `from` to `to`, replacing `to`. On Windows a held target is retried for up to about a
 * second (8 tries, 10 ms more each time); the last error is thrown.
 * @param {string} from @param {string} to
 */
export function renameOver(from, to) {
  for (let i = 1; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? '';
      if (!WIN || !BUSY.has(code) || i >= RENAME_TRIES) throw e;
      Atomics.wait(nap, 0, 0, 10 * i);
    }
  }
}

/**
 * Options for rmSync that ride out a file held for a moment on Windows (Node retries EBUSY, EPERM,
 * ENOTEMPTY and the like with a linear backoff). Elsewhere, none.
 */
export const RM_RETRY = WIN ? { maxRetries: 5, retryDelay: 20 } : {};
