// Process facts the environment manager relies on: whether a process is alive, and the identity of
// one (start time and working directory), so a process is only ever stopped when it is the very
// one the manager started. Uses ps and, off Linux, lsof; both ship with macOS and Linux.

import { execFileSync } from 'node:child_process';
import { readlinkSync, realpathSync } from 'node:fs';

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether a process with this ID exists. A process we may not signal still exists.
 * @param {number} pid
 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/**
 * The identity of a live process: when it started and where it runs. Null if it is gone.
 * The start time has one-second resolution, which with the ID and directory is enough to tell a
 * process from a later one that reused its ID.
 * @param {number} pid
 * @returns {{ start: string, cwd: string | null } | null}
 */
export function processInfo(pid) {
  if (!isAlive(pid)) return null;
  let start;
  try {
    start = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .replace(/\s+/g, ' ');
  } catch {
    return null;
  }
  if (!start) return null;
  return { start, cwd: cwdOf(pid) };
}

/** @param {number} pid @returns {string | null} */
function cwdOf(pid) {
  try {
    return realpathSync(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    // not Linux, or not ours to read: fall through to lsof
  }
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? realpathSync(line.slice(1)) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the process now running as `pid` is the one recorded: same start time and same working
 * directory. A process whose working directory cannot be read does not match.
 * @param {{ pid: number, start: string, cwd: string }} recorded
 * @returns {'gone' | 'match' | 'other'}
 */
export function matchProcess(recorded) {
  const now = processInfo(recorded.pid);
  if (!now) return 'gone';
  let want = recorded.cwd;
  try {
    want = realpathSync(recorded.cwd);
  } catch {
    // the directory may be gone; compare the recorded text
  }
  return now.start === recorded.start && now.cwd !== null && now.cwd === want ? 'match' : 'other';
}
