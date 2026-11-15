// Pausing at the quota gate and resuming (design part 12.5): when the gate stops autonomous
// dispatch, the run records why and when the limiting window resets, so the chief of staff can
// wake it then; when the gate lets dispatch go again (the window reset, the budget was raised, or
// new readings show room), it records the resume. Both are ledger events, written by the session
// that holds the lease; anyone may read whether a pause is on.
//
// The pause gate is the gate for no item in particular: it stops only when every item would stop.
// An item held because its own estimate would cross the reserve is a hold, not a pause.

import { dispatchGate } from './gate.mjs';
import { readLedgerEntries, readSnapshots } from './usage.mjs';
import { activeProjects, readAccountSnapshots, shareFraction } from '../registry/machine.mjs';

/**
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 *
 * @typedef {object} Pause
 * @property {string} id the paused event's ID
 * @property {string} at when dispatch paused
 * @property {string} limit the limit that stopped it
 * @property {string | null} resets_at when that limit's window resets, where known
 * @property {string | null} reason the gate's reason, as recorded
 */

/**
 * The pause in force: the last `paused` event with no `resumed` after it, or null.
 * @param {LedgerEntry[]} events @returns {Pause | null}
 */
export function activePause(events) {
  const at = events.findLastIndex((e) => e.event === 'paused' || e.event === 'resumed');
  if (at < 0 || events[at].event !== 'paused') return null;
  return pauseOf(events[at]);
}

/**
 * The most recent pause that named its reset, ended or not: the watchdog uses it to find executors
 * a limit cut off, once that reset has passed.
 * @param {LedgerEntry[]} events @returns {Pause | null}
 */
export function lastTimedPause(events) {
  const e = events.findLast((x) => x.event === 'paused' && x.resets_at !== undefined);
  return e ? pauseOf(e) : null;
}

/** @param {LedgerEntry} e @returns {Pause} */
const pauseOf = (e) => ({
  id: e.id,
  at: e.at,
  limit: e.limit,
  resets_at: e.resets_at ?? null,
  reason: e.notes ?? null,
});

/**
 * The gate for no item in particular, as the run sees it now: the project's snapshots and every
 * account's from the machine registry, the ledger's estimates, and this project's share near the
 * reserve.
 * @param {{ policy: Record<string, any>, store: PrivateStore, machineRoot: string,
 *   person: Record<string, any> | null, state: Record<string, any> | null, now?: number }} p
 */
export function pauseGate(p) {
  const projectId = p.policy.project.id;
  const snapshots = [...readSnapshots(p.store).snapshots, ...readAccountSnapshots(p.machineRoot)];
  const share = shareFraction(p.person, projectId, activeProjects(p.machineRoot, projectId));
  const started = p.state?.run?.started_at ? Date.parse(p.state.run.started_at) : null;
  return dispatchGate(
    p.policy,
    snapshots,
    {},
    {
      ledger: readLedgerEntries(p.store),
      runStartedAt: started,
      share,
      ...(p.now !== undefined ? { now: p.now } : {}),
    },
  );
}

/**
 * What to record, given the gate now and the pause in force: `paused` when the gate stops dispatch
 * and no pause is on (or the one on names another limit or reset), `resumed` when a pause is on and
 * the gate no longer stops dispatch, nothing otherwise.
 * @param {{ mode: string, reason: string, binding: string | null, resets_at: string | null }} gate
 * @param {Pause | null} active
 * @param {number} now ms
 * @returns {LedgerEntry | null} the event to record, without ID or time
 */
export function pauseTransition(gate, active, now) {
  if (gate.mode === 'stop') {
    const limit = gate.binding ?? 'unknown';
    // The same limit still stops dispatch: nothing new, unless it now names a later reset. Just
    // after a reset the gate has no reading yet and gives no reset time; the known one stands.
    if (
      active &&
      active.limit === limit &&
      (!gate.resets_at || gate.resets_at === active.resets_at)
    ) {
      return null;
    }
    return {
      event: 'paused',
      limit,
      ...(gate.resets_at ? { resets_at: gate.resets_at } : {}),
      notes: gate.reason.length > 400 ? `${gate.reason.slice(0, 399)}…` : gate.reason,
    };
  }
  if (!active) return null;
  const reset = active.resets_at !== null && now >= Date.parse(active.resets_at);
  return {
    event: 'resumed',
    reason: reset ? 'reset' : 'budget',
    notes: `after the pause at ${active.limit} (${active.id}): ${gate.mode}`,
  };
}

/**
 * Whether a pause in force is due to be lifted: its reset time has passed (the wake the chief of
 * staff scheduled), or the gate already lets dispatch go (a raised budget, new readings).
 * @param {Pause | null} active
 * @param {{ mode: string, reason: string }} gate
 * @param {number} now ms
 */
export function resumeDue(active, gate, now) {
  if (!active) return { paused: false, due: false, why: 'dispatch is not paused' };
  if (gate.mode !== 'stop') {
    return {
      paused: true,
      due: true,
      why: `the quota gate allows dispatch again (${gate.mode}): re-plan now`,
    };
  }
  if (active.resets_at !== null && now >= Date.parse(active.resets_at)) {
    return {
      paused: true,
      due: true,
      why: `${active.limit} reset at ${active.resets_at}: re-plan; the gate decides from the next reading`,
    };
  }
  return {
    paused: true,
    due: false,
    why: active.resets_at
      ? `paused at ${active.limit} until it resets at ${active.resets_at}`
      : `paused at ${active.limit}; its reset time is not known, so each check-in looks again`,
  };
}
