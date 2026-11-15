// In-flight dispatches: those with no terminal event (design parts 5.4 and 13.1). One fold, used
// by `hitld ledger in-flight` and by the run state, so the two cannot disagree.

import { TERMINAL_EVENTS, readLedger } from './ledger.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('./ledger.mjs').LedgerEntry} LedgerEntry
 *
 * @typedef {object} InFlight one entry of run-state.in_flight
 * @property {string} dispatch
 * @property {string} item
 * @property {string} [role]
 * @property {number} [tier]
 * @property {'headless' | 'interactive'} [mode] for tier 3: a background run, or its own session
 * @property {string | null} harness null until the harness accepted the dispatch (claimed)
 * @property {string | null} harness_ref the harness's own reference for the dispatch
 * @property {string | null} host
 * @property {string | null} worktree
 * @property {string | null} branch
 * @property {string[]} serial_resources
 * @property {string} started_at
 */

/**
 * Apply one event to a list of in-flight dispatches, in place.
 * @param {InFlight[]} list @param {LedgerEntry} e @returns {InFlight[]}
 */
export function applyInflight(list, e) {
  if (e.dispatch === undefined) return list;
  const at = list.findIndex((d) => d.dispatch === e.dispatch);
  if (e.event === 'dispatched') {
    if (at >= 0) return list;
    list.push({
      dispatch: e.dispatch,
      item: e.item,
      ...(e.role !== undefined ? { role: e.role } : {}),
      ...(e.tier !== undefined ? { tier: e.tier } : {}),
      ...(e.mode !== undefined ? { mode: e.mode } : {}),
      harness: null,
      harness_ref: null,
      host: e.host ?? null,
      worktree: e.worktree ?? null,
      branch: e.branch ?? null,
      serial_resources: e.serial_resources ? [...e.serial_resources] : [],
      started_at: e.at,
    });
  } else if (e.event === 'started' && at >= 0) {
    const d = list[at];
    d.harness = e.harness ?? d.harness;
    d.harness_ref = e.harness_ref ?? d.harness_ref;
    d.host = e.host ?? d.host;
    d.worktree = e.worktree ?? d.worktree;
    d.branch = e.branch ?? d.branch;
  } else if (TERMINAL_EVENTS.includes(e.event) && at >= 0) {
    list.splice(at, 1);
  }
  return list;
}

/**
 * Dispatches without a terminal event, from the ledger alone. Used on restart.
 * @param {PrivateStore | LedgerEntry[]} source
 * @returns {InFlight[]}
 */
export function inflight(source) {
  const events = Array.isArray(source) ? source : readLedger(source).events;
  /** @type {InFlight[]} */
  const list = [];
  for (const e of events) applyInflight(list, e);
  return list;
}

/**
 * The live record of a dispatch: claimed by the harness and not yet reported, abandoned or
 * released. For the environment manager's role check. Read from the ledger, never from the run
 * state, which is only a working copy. `grants` is what the dispatch holds: its serial resources.
 * @param {PrivateStore | LedgerEntry[]} source
 * @param {string} dispatch
 * @param {string} run the current run's ID: a dispatch recorded under another run is not live
 * @returns {(InFlight & { grants: string[] }) | null}
 */
export function liveDispatch(source, dispatch, run) {
  const events = Array.isArray(source) ? source : readLedger(source).events;
  const recorded = events.find((e) => e.event === 'dispatched' && e.dispatch === dispatch);
  if (!recorded || recorded.run !== run) return null;
  const d = inflight(events).find((x) => x.dispatch === dispatch);
  if (!d || d.harness_ref === null) return null;
  return { ...d, grants: [...d.serial_resources] };
}
