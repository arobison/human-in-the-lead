// The machine-wide registry (design part 13.4, "Across projects"): the live executors of every
// project on this machine, and usage snapshots per account. It lives in `_machine/` beside the
// project stores and is machine-local: it is never exported, synced or committed.
//
// One JSON file, changed only while holding a cross-process mutex (the env manager's), written by
// temporary file and rename, so two projects dispatching at once never read or leave a torn file.
// A mutex whose owner died is taken over by the next writer.
//
// A live-executor entry follows its dispatch. It is dead, and stops counting against the caps,
// when its recorded process is gone (or was replaced by another with the same ID), or when its
// project's ledger no longer shows the dispatch in flight (reported, abandoned, or the store is
// gone). Readers skip dead entries; the next writer removes them.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { inflight } from '../ledger/inflight.mjs';
import { openStore } from '../store/store.mjs';
import { withMutexSync } from '../env/mutex.mjs';
import { isAlive, processInfo } from '../env/proc.mjs';

/**
 * @typedef {object} ExecutorEntry one live executor
 * @property {string} project the project's ID (policy.json project.id)
 * @property {string} dispatch
 * @property {string} item
 * @property {string} store_root the project's private store, where its ledger says if it still runs
 * @property {string[]} resources serial resources it holds
 * @property {string} host
 * @property {number} [pid] a process whose life the entry follows, where one is known
 * @property {string | null} [pid_start]
 * @property {string} started_at
 *
 * @typedef {object} MachineRegistry
 * @property {1} schema_version
 * @property {Record<string, ExecutorEntry>} executors keyed by "<project>/<dispatch>"
 * @property {Record<string, Record<string, any>[]>} usage usage snapshots, by account
 *
 * @typedef {{ liveness?: typeof entryLiveness }} LivenessOption
 */

export const REGISTRY_FILE = 'registry.json';
export const DEFAULT_ACCOUNT = 'default';
/** Snapshots kept per account: enough for a rate over the longest window, bounded in size. */
const SNAPSHOTS_KEPT = 500;

/** @param {string} machineRoot */
const fileOf = (machineRoot) => join(machineRoot, REGISTRY_FILE);

/** @returns {MachineRegistry} */
const empty = () => ({ schema_version: 1, executors: {}, usage: {} });

/** @param {string} project @param {string} dispatch */
const keyOf = (project, dispatch) => `${project}/${dispatch}`;

/**
 * Read the registry. An absent file is an empty registry; one that cannot be parsed is treated as
 * empty too, so a damaged file never blocks dispatch (the next write replaces it).
 * @param {string} machineRoot @returns {MachineRegistry}
 */
export function readMachineRegistry(machineRoot) {
  let text;
  try {
    text = readFileSync(fileOf(machineRoot), 'utf8');
  } catch {
    return empty();
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schema_version !== 1) return empty();
    return {
      schema_version: 1,
      executors: parsed.executors && typeof parsed.executors === 'object' ? parsed.executors : {},
      usage: parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {},
    };
  } catch {
    return empty();
  }
}

/**
 * Change the registry atomically with respect to other processes. `fn` may mutate the registry it
 * is given; its result is returned. Synchronous, because the status line cannot await; the lock
 * is held only for a read, a short check and a write.
 * @template T
 * @param {string} machineRoot
 * @param {(registry: MachineRegistry) => T} fn
 * @returns {T}
 */
export function updateMachineRegistry(machineRoot, fn) {
  return withMutexSync(join(machineRoot, '.registry.mutex'), () => {
    const registry = readMachineRegistry(machineRoot);
    const result = fn(registry);
    const path = fileOf(machineRoot);
    mkdirSync(machineRoot, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
    renameSync(tmp, path);
    return result;
  });
}

/**
 * Whether an entry's executor is still running: its process (if recorded) exists and is the same
 * one, and its project's ledger shows the dispatch in flight.
 * @param {ExecutorEntry} e @returns {{ live: true } | { live: false, why: string }}
 */
export function entryLiveness(e) {
  if (e.pid !== undefined && e.host === hostname()) {
    if (!isAlive(e.pid)) return { live: false, why: `its process ${e.pid} is gone` };
    if (e.pid_start) {
      const info = processInfo(e.pid);
      if (info && info.start !== e.pid_start) {
        return { live: false, why: `process ${e.pid} is no longer its executor's (ID reused)` };
      }
    }
  }
  try {
    // The store path is the registry's own record of where that project's ledger is; the ledger
    // is only read here, never written.
    const running = inflight(openStore(e.store_root));
    if (!running.some((d) => d.dispatch === e.dispatch)) {
      return { live: false, why: `${e.project} no longer has ${e.dispatch} in flight` };
    }
  } catch {
    return { live: false, why: `${e.project}'s ledger cannot be read` };
  }
  return { live: true };
}

/**
 * The live executors, from every project. Reads only; dead entries are skipped, not removed.
 * @param {string} machineRoot @param {LivenessOption} [options]
 * @returns {ExecutorEntry[]}
 */
export function liveExecutors(machineRoot, options = {}) {
  const check = options.liveness ?? entryLiveness;
  return Object.values(readMachineRegistry(machineRoot).executors).filter((e) => check(e).live);
}

/**
 * Executors running in projects other than `project`, counted against the person's and the
 * machine's caps. The project's own are already counted by its in-flight list.
 * @param {string} machineRoot @param {string} project
 */
export function runningElsewhere(machineRoot, project) {
  const n = liveExecutors(machineRoot).filter((e) => e.project !== project).length;
  // The registry is this machine's: it cannot see the person's executors on other machines, so the
  // person's count and the machine's are the same here.
  return { person: n, machine: n };
}

/**
 * The projects that have a live executor now, with `project` included: the ones competing for
 * headroom near the reserve.
 * @param {string} machineRoot @param {string} project @returns {string[]}
 */
export function activeProjects(machineRoot, project) {
  return [...new Set([project, ...liveExecutors(machineRoot).map((e) => e.project)])];
}

/**
 * Record a live executor, unless the person's or machine's maximum is already reached. The count
 * and the write happen under the mutex, so projects dispatching at once cannot together pass a cap.
 * Entries that are no longer live are removed first.
 * @param {string} machineRoot
 * @param {Omit<ExecutorEntry, 'host' | 'started_at'> & { host?: string, started_at?: string }} entry
 * @param {{ person?: number, machine?: number }} [max] the maxima from the person and machine files
 * @param {LivenessOption} [options]
 * @returns {{ ok: true, removed: string[] } | { ok: false, layer: 'person' | 'machine', max: number, live: number }}
 */
export function registerExecutor(machineRoot, entry, max = {}, options = {}) {
  const check = options.liveness ?? entryLiveness;
  return updateMachineRegistry(machineRoot, (reg) => {
    /** @type {string[]} */
    const removed = [];
    for (const [k, e] of Object.entries(reg.executors)) {
      if (!check(e).live) {
        delete reg.executors[k];
        removed.push(k);
      }
    }
    const key = keyOf(entry.project, entry.dispatch);
    if (!reg.executors[key]) {
      const live = Object.keys(reg.executors).length;
      for (const layer of /** @type {const} */ (['person', 'machine'])) {
        const limit = max[layer];
        if (typeof limit === 'number' && live >= limit) {
          return /** @type {const} */ ({ ok: false, layer, max: limit, live });
        }
      }
    }
    reg.executors[key] = {
      host: hostname(),
      started_at: new Date().toISOString(),
      ...entry,
    };
    return /** @type {const} */ ({ ok: true, removed });
  });
}

/**
 * Remove an executor's entry when its dispatch ends.
 * @param {string} machineRoot @param {string} project @param {string} dispatch
 * @returns {boolean} whether there was an entry
 */
export function releaseExecutor(machineRoot, project, dispatch) {
  return updateMachineRegistry(machineRoot, (reg) => {
    const key = keyOf(project, dispatch);
    const had = key in reg.executors;
    delete reg.executors[key];
    return had;
  });
}

/**
 * Remove every entry that is no longer live.
 * @param {string} machineRoot @param {LivenessOption} [options]
 * @returns {{ key: string, why: string }[]}
 */
export function reconcileExecutors(machineRoot, options = {}) {
  const check = options.liveness ?? entryLiveness;
  return updateMachineRegistry(machineRoot, (reg) => {
    /** @type {{ key: string, why: string }[]} */
    const gone = [];
    for (const [key, e] of Object.entries(reg.executors)) {
      const r = check(e);
      if (!r.live) {
        delete reg.executors[key];
        gone.push({ key, why: r.why });
      }
    }
    return gone;
  });
}

/**
 * Add a usage snapshot for an account. The same snapshot recorded twice is kept once.
 * @param {string} machineRoot @param {string} account @param {Record<string, any>} snapshot
 * @returns {boolean} whether it was added
 */
export function recordSnapshot(machineRoot, account, snapshot) {
  return updateMachineRegistry(machineRoot, (reg) => {
    const list = (reg.usage[account] ??= []);
    const line = JSON.stringify(snapshot);
    if (list.some((s) => JSON.stringify(s) === line)) return false;
    list.push(snapshot);
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (list.length > SNAPSHOTS_KEPT) list.splice(0, list.length - SNAPSHOTS_KEPT);
    return true;
  });
}

/**
 * Every account's snapshots, each tagged with its account, ascending in time. The tag is added
 * on reading and is not part of the usage-snapshot schema.
 * @param {string} machineRoot @returns {Record<string, any>[]}
 */
export function readAccountSnapshots(machineRoot) {
  const usage = readMachineRegistry(machineRoot).usage;
  return Object.entries(usage)
    .flatMap(([account, list]) =>
      Array.isArray(list)
        ? list.map((/** @type {Record<string, any>} */ s) => ({ ...s, account }))
        : [],
    )
    .sort((/** @type {any} */ a, /** @type {any} */ b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * A project's fraction of the headroom near the reserve: its share over the shares of every
 * active project (equal, 1, where the person file sets none).
 * @param {Record<string, any> | null} person the person file
 * @param {string} project @param {string[]} active
 * @returns {number} in (0, 1]
 */
export function shareFraction(person, project, active) {
  /** @param {string} id */
  const share = (id) => {
    const s = person?.projects?.[id]?.share;
    return typeof s === 'number' && s > 0 ? s : 1;
  };
  const ids = new Set([...active, project]);
  let total = 0;
  for (const id of ids) total += share(id);
  return share(project) / total;
}
