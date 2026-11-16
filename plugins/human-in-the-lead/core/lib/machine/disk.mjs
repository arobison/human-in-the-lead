// Free disk as a resource dispatch respects (design part 13.4). The machine file sets a floor
// (`disk_floor_mb`); below it, `hitld dispatch plan` holds every item and `dispatch start` refuses,
// the way the quota gate holds work below its reserve. Near it, `hitld run status`, the watchdog and
// the digest say so, before it is reached.
//
// Free space is the harness's allowance for the session when the harness exposes one (the
// `allowanceBytes` probe); otherwise the file system's available space where hitld writes: the
// checkout, the private store and the worktrees. Where hitld's own use is shown, it is measured
// with `du`, so the person sees what removing worktrees and results would give back.

import { join } from 'node:path';
import { envSettings, worktreeRoot } from '../env/config.mjs';
import { loadSettingsFile } from '../settings/files.mjs';
import { localSources } from './detect.mjs';

/**
 * @typedef {import('./detect.mjs').Sources} Sources
 *
 * @typedef {object} DiskState
 * @property {'ok' | 'near' | 'below' | 'unknown'} state
 * @property {number | null} free_mb
 * @property {number} floor_mb
 * @property {'allowance' | 'file system' | null} source
 * @property {string | null} where whose file system had the least room, by role: the checkout,
 *   the private store or the worktrees; null for an allowance
 * @property {string} reason one line, naming the floor
 *
 * @typedef {{ free_bytes: number | null, source: DiskState['source'], where: string | null }} Reading
 */

/** The floor when the machine file sets none: 5 GB, room for a few worktrees and a test run. */
export const DEFAULT_DISK_FLOOR_MB = 5120;
/** Free space under this many times the floor is near it. */
export const DISK_NEAR_FACTOR = 1.5;

const MB = 1024 * 1024;

/**
 * The floor in megabytes: the machine file's `disk_floor_mb`, else the default.
 * @param {Record<string, any> | null | undefined} machineFile
 */
export const diskFloorMb = (machineFile) =>
  Number.isInteger(machineFile?.disk_floor_mb) && machineFile?.disk_floor_mb > 0
    ? /** @type {number} */ (machineFile?.disk_floor_mb)
    : DEFAULT_DISK_FLOOR_MB;

/**
 * Judge free space against the floor. Pure.
 * @param {Reading} reading
 * @param {number} floorMb
 * @returns {DiskState}
 */
export function judgeDisk(reading, floorMb) {
  if (reading.free_bytes === null) {
    return {
      state: 'unknown',
      free_mb: null,
      floor_mb: floorMb,
      source: null,
      where: null,
      reason: `free disk could not be read; the floor of ${floorMb} MB (machine file disk_floor_mb) is not checked`,
    };
  }
  const free = Math.floor(reading.free_bytes / MB);
  const state = free < floorMb ? 'below' : free < floorMb * DISK_NEAR_FACTOR ? 'near' : 'ok';
  const where =
    reading.source === 'allowance'
      ? "the session's allowance"
      : `the file system of ${reading.where}`;
  return {
    state,
    free_mb: free,
    floor_mb: floorMb,
    source: reading.source,
    where: reading.where,
    reason:
      state === 'below'
        ? `free disk is ${free} MB (${where}), below the disk floor of ${floorMb} MB (machine file disk_floor_mb): no new work starts until space is freed`
        : state === 'near'
          ? `free disk is ${free} MB (${where}), near the disk floor of ${floorMb} MB (machine file disk_floor_mb)`
          : `free disk is ${free} MB (${where}), above the disk floor of ${floorMb} MB`,
  };
}

/**
 * Read free space: the harness's allowance when it gives one, else the least available space on
 * the file systems of `places`.
 * @param {{ role: string, path: string }[]} places @param {Sources} sources
 * @returns {Reading}
 */
export function readFree(places, sources) {
  const allowance = sources.allowanceBytes?.() ?? null;
  if (typeof allowance === 'number' && allowance >= 0) {
    return { free_bytes: allowance, source: 'allowance', where: null };
  }
  /** @type {Reading} */
  let least = { free_bytes: null, source: null, where: null };
  if (!sources.freeBytes) return least;
  for (const p of places) {
    const n = sources.freeBytes(p.path);
    if (typeof n !== 'number') continue;
    if (least.free_bytes === null || n < least.free_bytes) {
      least = { free_bytes: n, source: 'file system', where: p.role };
    }
  }
  return least;
}

/**
 * What hitld itself keeps on disk, in megabytes (null where `du` gave no answer): the worktrees, the
 * private store (which holds the worktrees when the machine file names no other root) and its eval
 * results.
 * @param {{ worktrees: string, store: string }} where @param {Sources} sources
 */
export function hitldUsage(where, sources) {
  /** @param {string} path */
  const du = (path) => {
    const out = sources.run('du', ['-sk', path]);
    const kb = Number(out?.trim().split(/\s+/)[0]);
    return out && Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  };
  return {
    worktrees_mb: du(where.worktrees),
    store_mb: du(where.store),
    eval_results_mb: du(join(where.store, 'eval', 'results')),
  };
}

/**
 * The disk check for a project: the floor from the machine file, free space where hitld writes,
 * and, when near or below the floor, what hitld itself uses.
 * @param {{ env: NodeJS.ProcessEnv, sources?: Sources, repoRoot: string, storeRoot: string,
 *   policy: Record<string, any> }} o
 * @returns {DiskState & { used_by_hitld?: ReturnType<typeof hitldUsage> }}
 */
export function diskCheck(o) {
  const sources = o.sources ?? localSources();
  const machine = loadSettingsFile('machine', { env: o.env });
  const floor = diskFloorMb(machine.data);
  const worktrees = worktreeRoot(envSettings(o.policy), o.repoRoot, o.storeRoot);
  const places = [
    { role: 'the checkout', path: o.repoRoot },
    { role: 'the private store', path: o.storeRoot },
    { role: 'the worktrees', path: worktrees },
  ];
  const judged = judgeDisk(readFree(places, sources), floor);
  if (judged.state !== 'near' && judged.state !== 'below') return judged;
  return { ...judged, used_by_hitld: hitldUsage({ worktrees, store: o.storeRoot }, sources) };
}

/**
 * The disk check as a status shows it: only when free space is near or below the floor.
 * @param {ReturnType<typeof diskCheck>} d
 */
export const diskWarning = (d) => (d.state === 'near' || d.state === 'below' ? d : null);
