// What a run does with a ledger it has just pulled from the store remote (design 0003, section 8).
//
// The run state, and with it a lease's last renewal, never leaves the machine; the ledger does.
// So after a pull this machine knows about another machine's lease only through the ledger's
// `run-started`, `lease-taken` and `lease-released` events. The lease is the lock, so:
//
//   - a lease the ledger shows another machine took and never released counts as held, however
//     old it is: no renewal time is known for it, and a session that is gone cannot be told from
//     one that is working. Taking it needs a release (`hitld run retire` for a session known dead,
//     or the holder's hand-over), or the owner's say-so (`--force`, or `--replace` on run start);
//   - a lease this machine holds is judged as before, by its own run state and expiry.
//
// And a machine that never ran the project has the pulled ledger but no run state: it is rebuilt
// from the ledger, so resume and retire have something to work on.

import { readLedger } from '../ledger/ledger.mjs';
import { LeaseError } from './lease.mjs';
import { absorb, foldLedger } from './state.mjs';
import { loadState, saveCheckpoint } from './checkpoint.mjs';
import { rebuildRun } from './run.mjs';

/**
 * Rebuild the run state from the ledger when this machine has none and the ledger holds a run.
 * @param {import('../store/store.mjs').PrivateStore} store @param {number | undefined} kept
 * @returns {boolean} whether the state was rebuilt
 */
export function restoreState(store, kept) {
  if (loadState(store).state) return false;
  if (!readLedger(store).events.some((e) => e.event === 'run-started')) return false;
  rebuildRun(store, { kept });
  return true;
}

/**
 * Bring a run state that lags the pulled ledger up to it, as a checkpoint: the state is machine-local
 * and the pull added events it has not absorbed (another machine's release, say). The lease's
 * renewal time is not touched. A state that does not belong to the ledger is left as it is.
 * @param {import('../store/store.mjs').PrivateStore} store @param {number | undefined} kept
 * @returns {boolean} whether a checkpoint was written
 */
export function catchUp(store, kept) {
  const { state } = loadState(store);
  if (!state) return false;
  try {
    const next = structuredClone(state);
    if (!absorb(next, readLedger(store).events).applied.length) return false;
    saveCheckpoint(store, state, next, { kept: kept ?? 5 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The lease the ledger shows held by another machine, or null: not released since it was taken,
 * and taken on a host other than `host`.
 * @param {import('../store/store.mjs').PrivateStore} store @param {string} host
 */
export function heldElsewhere(store, host) {
  const { events } = readLedger(store);
  if (!events.some((e) => e.event === 'run-started')) return null;
  const state = foldLedger(events);
  const lease = state.lease;
  if (!lease || lease.released || lease.host === host) return null;
  return { run: String(state.run.id), lease };
}

/**
 * Refuse (`lease-held`) to start or resume a run whose lease the pulled ledger shows another
 * machine holds. Restores the run state first, so `hitld run retire` can act on it. Does nothing
 * unless a pull ran (a skipped one, as with --no-sync, is the owner's choice).
 * @param {{
 *   store: import('../store/store.mjs').PrivateStore,
 *   kept: number | undefined,
 *   host: string,
 *   pull: { status: string } | null,
 *   override: string,
 * }} o override: the flag that takes the lease anyway, named in the message
 */
export function refuseHeldElsewhere(o) {
  if (!o.pull || o.pull.status === 'skipped') return;
  catchUp(o.store, o.kept);
  const held = heldElsewhere(o.store, o.host);
  if (!held) return;
  restoreState(o.store, o.kept);
  const { lease } = held;
  throw new LeaseError(
    'held',
    `run ${held.run}'s lease was taken by session ${lease.session} on ${lease.host} at ${lease.renewed_at}, and the ledger shows no release since. A lease taken on another machine counts as held however old it is. If that session is known dead: hitld run retire --holder ${lease.session} (the owner's or the chief of staff's call). Or take it deliberately with ${o.override}`,
    lease,
  );
}
