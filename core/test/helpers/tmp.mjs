// Temporary directories for tests, removed when the test file's process exits. Every test makes
// its temporary directories here, never with mkdtempSync(join(tmpdir(), ...)) directly:
// `npm test` (core/test/run.mjs) fails when a run leaves anything behind in its temporary
// directory. They had built up to about 170,000 and filled the disk (HITLD-130).

import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {Set<string>} */
const made = new Set();

/**
 * Give the owner write access to everything under `dir`, for a test that made a part read-only.
 * @param {string} dir
 */
function unlock(dir) {
  try {
    if (lstatSync(dir).isSymbolicLink()) return;
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) unlock(p);
    }
  } catch {
    // Gone already, or not ours to change.
  }
}

/** Remove one directory, read-only parts included. @param {string} dir */
export function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    unlock(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
  made.delete(dir);
}

/**
 * Keep a directory a test made some other way (beside a temporary one, say) for removal at exit.
 * @param {string} dir @returns {string} the same directory
 */
export function removeAtExit(dir) {
  made.add(dir);
  return dir;
}

/**
 * A new directory under the system's temporary directory, removed when this process exits.
 * @param {string} prefix such as 'hitld-orch-'
 * @returns {string}
 */
export function tempDir(prefix) {
  return removeAtExit(mkdtempSync(join(tmpdir(), prefix)));
}

process.on('exit', () => {
  for (const dir of [...made]) {
    try {
      removeTempDir(dir);
    } catch {
      // The run's check (core/test/run.mjs) names what is left.
    }
  }
});
