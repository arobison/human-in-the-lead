// Process facts the environment manager relies on: whether a process is alive, and the identity of
// one (start time and working directory), so a process is only ever stopped when it is the very
// one the manager started. Uses ps and, off Linux, lsof; both ship with macOS and Linux.
//
// Windows has neither. There the start time comes from PowerShell's Get-Process, one call for any
// number of processes (each call costs most of a second, so callers look a process up once, not
// on every poll), and the working directory of another process cannot be read at all. The start
// time there is exact to a tenth of a microsecond, so it alone tells a process from a later one
// that reused its ID. A process tree is stopped with taskkill /T /F: Windows has no process groups
// and no signal a process can handle, so there is no graceful stop to wait for.

import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { realPath } from './fsx.mjs';
import { systemRoot } from './shell.mjs';

const WIN = process.platform === 'win32';

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
 * The start times of live processes, by ID, in one call: ps elsewhere, PowerShell on Windows. A
 * process that is gone, or whose start time cannot be read, is missing from the map.
 *
 * `ps` prints the start time in the caller's time zone and locale, so two callers in different
 * ones read one process differently. With `utc`, it runs with TZ=UTC and LC_ALL=C, and every
 * caller reads the same text (the machine locks compare it across processes, HITLD-1052).
 * Without it the text is as before, which the records of older copies hold. Windows prints UTC
 * either way.
 * @param {number[]} pids @param {{ utc?: boolean }} [o]
 * @returns {Map<number, string>}
 */
export function processStarts(pids, o = {}) {
  return readStarts(pids, o) ?? new Map();
}

/**
 * As processStarts, but null when the lookup itself failed (the tool missing, failing or timing
 * out), so a caller can tell that from a process whose start time the tool could not read, which
 * is missing from the map.
 * @param {number[]} pids @param {{ utc?: boolean }} [o]
 * @returns {Map<number, string> | null}
 */
export function readStarts(pids, o = {}) {
  /** @type {Map<number, string>} */
  const out = new Map();
  const live = [...new Set(pids)].filter((p) => isAlive(p));
  if (!live.length) return out;
  try {
    if (WIN) {
      const ps = join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      // A process whose start time is not ours to read (the System process) is skipped, and the
      // exit code is always 0, so one such process does not lose the others.
      const script =
        `$ErrorActionPreference = 'SilentlyContinue'; foreach ($p in (Get-Process -Id ${live.join(',')} -ErrorAction SilentlyContinue)) ` +
        `{ try { '{0} {1}' -f $p.Id, $p.StartTime.ToUniversalTime().ToString('o') } catch {} }; exit 0`;
      const text = execFileSync(
        ps,
        ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 15_000,
        },
      );
      for (const line of text.split(/\r?\n/)) {
        const m = /^(\d+) (\S+)$/.exec(line.trim());
        if (m) out.set(Number(m[1]), m[2]);
      }
    } else {
      const text = execFileSync('ps', ['-o', 'pid=,lstart=', '-p', live.join(',')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        // The machine locks look a process up inside their critical section: never wait long.
        timeout: 5_000,
        ...(o.utc ? { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } } : {}),
      });
      for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (m) out.set(Number(m[1]), m[2].trim().replace(/\s+/g, ' '));
      }
    }
  } catch {
    // the tool is missing or failed: nothing is known
    return null;
  }
  return out;
}

/** This process's own start time, looked up once. @type {string | null | undefined} */
let ownStart;

/**
 * A process's start time, or null when it is gone or cannot be read. This process's own is
 * looked up once and remembered.
 * @param {number} pid @returns {string | null}
 */
export function processStart(pid) {
  if (pid === process.pid) {
    if (ownStart === undefined) ownStart = processStarts([pid]).get(pid) ?? null;
    return ownStart;
  }
  return processStarts([pid]).get(pid) ?? null;
}

/**
 * The identity of a live process: when it started and where it runs. Null if it is gone.
 * The start time has one-second resolution, which with the ID and directory is enough to tell a
 * process from a later one that reused its ID. On Windows the directory is always null (it cannot
 * be read) and the start time is exact.
 * @param {number} pid
 * @returns {{ start: string, cwd: string | null } | null}
 */
export function processInfo(pid) {
  const start = processStart(pid);
  if (!start) return null;
  return { start, cwd: WIN ? null : cwdOf(pid) };
}

/** @param {number} pid @returns {string | null} */
function cwdOf(pid) {
  try {
    return realPath(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    // not Linux, or not ours to read: fall through to lsof
  }
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? realPath(line.slice(1)) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the process now running as `pid` is the one recorded: same start time and same working
 * directory. A process whose working directory cannot be read does not match, except on Windows,
 * where no directory can be read and the exact start time decides alone.
 * @param {{ pid: number, start: string, cwd: string | null }} recorded
 * @returns {'gone' | 'match' | 'other'}
 */
export function matchProcess(recorded) {
  const now = processInfo(recorded.pid);
  if (!now) return 'gone';
  if (WIN) return now.start === recorded.start ? 'match' : 'other';
  let want = recorded.cwd;
  try {
    want = realPath(/** @type {string} */ (recorded.cwd));
  } catch {
    // the directory may be gone; compare the recorded text
  }
  return now.start === recorded.start && now.cwd !== null && now.cwd === want ? 'match' : 'other';
}

/**
 * Stop a process and everything it started. Windows: taskkill /T /F, which ends the tree at once
 * (there is nothing gentler a console program can act on). Elsewhere: the signal to the process
 * group the process leads (a detached child leads its own), or to the process alone when it leads
 * none.
 * @param {number} pid @param {NodeJS.Signals} [signal] ignored on Windows
 */
export function killTree(pid, signal = 'SIGTERM') {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (WIN) {
    try {
      execFileSync(
        join(systemRoot(), 'System32', 'taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true, timeout: 15_000 },
      );
    } catch {
      // already gone, or not ours to stop
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
