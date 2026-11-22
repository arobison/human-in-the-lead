// The process that started a dispatch (HITLD-737): the orchestrator's session process, in which a
// background agent runs and with which it dies. `hitld dispatch start` and `dispatch follow-up`
// record it, as the harness adapter names it, and `hitld dispatch watch` checks it on each tick:
// once it has exited, an executor that ran inside it is gone too, and the watchdog says so at once
// instead of waiting out the stall time (core/lib/dispatch/watch.mjs).
//
// The record is a process ID and its start time, so a reused ID is not taken for the same
// process. It means something only on the machine that wrote it, so it lives under run/, which is
// machine-local (store/git.mjs, MACHINE_LOCAL), and names its host. With no harness to name the
// process, nothing is recorded and the rule does not apply.

import { hostname } from 'node:os';
import { isAlive, processStart, processStarts } from '../env/proc.mjs';
import * as claudeCode from '../../harness/claude-code/session.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {{ pid: number, start: string | null, host: string, recorded_at: string }} ParentRecord
 * @typedef {{ sessionProcessOf: (env: NodeJS.ProcessEnv | undefined) => number | null }} HarnessProcess
 */

/** The harnesses asked for the session's process, in order. */
export const PROCESS_HARNESSES = Object.freeze([claudeCode]);

/** @param {string} dispatch */
export const parentKey = (dispatch) => `run/parents/${dispatch}.json`;

/**
 * The session process this command runs under, as its harness names it, or null.
 * @param {NodeJS.ProcessEnv | undefined} env @param {readonly HarnessProcess[]} [harnesses]
 */
export function sessionProcess(env, harnesses = PROCESS_HARNESSES) {
  for (const h of harnesses) {
    const pid = h.sessionProcessOf(env);
    if (pid) return pid;
  }
  return null;
}

/**
 * Record the process that starts `dispatch`. Nothing is written when no harness names one, or the
 * process it names is not running here.
 * @param {PrivateStore} store @param {string} dispatch
 * @param {{ env?: NodeJS.ProcessEnv, host?: string, now?: Date, harnesses?: readonly HarnessProcess[] }} [o]
 * @returns {ParentRecord | null}
 */
export function recordParent(store, dispatch, o = {}) {
  const pid = sessionProcess(o.env, o.harnesses);
  if (!pid || !isAlive(pid)) return null;
  /** @type {ParentRecord} */
  const record = {
    pid,
    start: processStart(pid),
    host: o.host ?? hostname(),
    recorded_at: (o.now ?? new Date()).toISOString(),
  };
  store.write(parentKey(dispatch), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * The recorded parent of `dispatch`, or null when none was recorded or the record is damaged.
 * @param {PrivateStore} store @param {string} dispatch @returns {ParentRecord | null}
 */
export function readParent(store, dispatch) {
  let raw;
  try {
    raw = store.read(parentKey(dispatch));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (r && Number.isInteger(r.pid) && r.pid > 1 && typeof r.host === 'string') return r;
  } catch {
    // A damaged record is no record: the rule does not apply.
  }
  return null;
}

/**
 * The dispatches whose recorded parent has exited: its process is gone, or its ID now belongs to
 * a process that started at another time. Only records written on `host` are judged; a start time
 * that cannot be read counts as the same process, so a doubt never marks a dispatch stalled.
 * @param {PrivateStore} store @param {{ dispatch: string }[]} entries @param {string} host
 * @param {{ alive?: (pid: number) => boolean, starts?: (pids: number[]) => Map<number, string> }} [probe]
 * @returns {Set<string>}
 */
export function exitedParents(store, entries, host, probe = {}) {
  const alive = probe.alive ?? isAlive;
  const records = entries
    .map((e) => ({ dispatch: e.dispatch, parent: readParent(store, e.dispatch) }))
    .filter((r) => r.parent && r.parent.host === host);
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {{ dispatch: string, parent: ParentRecord }[]} */
  const live = [];
  for (const r of records) {
    const parent = /** @type {ParentRecord} */ (r.parent);
    if (alive(parent.pid)) live.push({ dispatch: r.dispatch, parent });
    else out.add(r.dispatch);
  }
  const pids = live.filter((r) => r.parent.start).map((r) => r.parent.pid);
  const starts = pids.length ? (probe.starts ?? processStarts)(pids) : new Map();
  for (const { dispatch, parent } of live) {
    const now = starts.get(parent.pid);
    if (parent.start && now && now !== parent.start) out.add(dispatch);
  }
  return out;
}
