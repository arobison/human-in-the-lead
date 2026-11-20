// File system calls that behave the same on Windows as on macOS and Linux.
//
// Real paths: Node's default realpathSync resolves links but keeps a Windows 8.3 short name
// (C:\Users\AUSTIN~1.ROB) as it was given, while git and the native call give the long name
// (C:\Users\Austin.Robison). Two real paths compared to each other must come from the same call,
// so on Windows `realPath` is the native one. Elsewhere it is the default call, unchanged.
//
// Renames: on Windows a rename over an existing file fails with EPERM, EBUSY or EACCES while
// another process (endpoint protection, an indexer, an editor) holds the target open, usually for
// a few milliseconds. `renameReplacing` retries those, a bounded number of times, on Windows only.

import { realpathSync, renameSync, unlinkSync } from 'node:fs';

const WINDOWS = process.platform === 'win32';

/**
 * The real path of an existing path: links resolved and, on Windows, short names expanded.
 * @param {string} path
 * @returns {string}
 */
export function realPath(path) {
  return WINDOWS ? realpathSync.native(path) : realpathSync(path);
}

/** Error codes Windows gives while another process holds a file. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** The waits between attempts, in milliseconds: about two seconds in all. */
const WAITS = [10, 20, 40, 80, 160, 320, 640, 800];

/** @param {number} ms */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run a file operation; on Windows, when another process holds the file, try it again a bounded
 * number of times before the error is thrown. Elsewhere the operation runs once.
 * @template T
 * @param {() => T} op
 * @param {{ platform?: string, wait?: (ms: number) => void }} [seam] for tests
 * @returns {T}
 */
export function retryBusy(op, seam = {}) {
  const retry = (seam.platform ?? process.platform) === 'win32';
  const wait = seam.wait ?? pause;
  for (let attempt = 0; ; attempt++) {
    try {
      return op();
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? '';
      if (!retry || !BUSY.has(code) || attempt >= WAITS.length) throw e;
      wait(WAITS[attempt]);
    }
  }
}

/**
 * Rename `from` over `to`, replacing a file there, retried on Windows while a file is held.
 * @param {string} from @param {string} to
 * @param {{ rename?: (from: string, to: string) => void, platform?: string, wait?: (ms: number) => void }} [seam] for tests
 */
export function renameReplacing(from, to, seam = {}) {
  const rename = seam.rename ?? renameSync;
  retryBusy(() => rename(from, to), seam);
}

/**
 * Remove a file, as unlinkSync, retried on Windows while it is held.
 * @param {string} file
 */
export const removeFile = (file) => retryBusy(() => unlinkSync(file));

/**
 * Options for rmSync that ride out a file held for a moment on Windows (Node retries EBUSY, EPERM,
 * ENOTEMPTY and the like with a linear backoff). Elsewhere, none.
 */
export const RM_RETRY = WINDOWS ? { maxRetries: 5, retryDelay: 20 } : {};
