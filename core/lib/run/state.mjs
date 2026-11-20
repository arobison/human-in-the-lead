// The run state as a fold of the ledger (design part 13.1). The run-state file is derived, never
// authoritative: every field that matters is the result of applying ledger events in order. Both
// resuming (absorb) and rebuilding fold the whole ledger with the same `applyEvent`, so they cannot
// disagree, even when a pull brings another writer's earlier-stamped events (HITLD-74).
//
// What the ledger cannot give: `controllers` and `quotas` (they are written by other pieces at
// their own clean points) and the lease's last renewal (a checkpoint's time). A rebuild leaves the
// first two empty, and takes the lease from the last run-started or lease-taken event.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../policy/policy.mjs';
import { schemas } from '../schema/registry.mjs';
import { applyInflight } from '../ledger/inflight.mjs';

/**
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {Record<string, any>} RunState a document valid against schemas/run-state.schema.json
 */

/**
 * A state before any run has started. Not valid until a run-started event is applied to it.
 * @returns {RunState}
 */
export function blankState() {
  return {
    schema_version: schemas().currentVersion('run-state'),
    run: null,
    scope: {},
    in_flight: [],
    ledger_position: null,
    decisions_open: [],
    decisions_answered: [],
    controllers: {},
    quotas: null,
    merge_queue: { waiting: [], batch: null },
    lease: null,
    checkpoint: { number: 0, prev_hash: null },
  };
}

/**
 * Apply one ledger event to a state, in place.
 * @param {RunState} state @param {LedgerEntry} e @returns {RunState}
 */
export function applyEvent(state, e) {
  applyInflight(state.in_flight, e);
  switch (e.event) {
    case 'run-started':
      state.run = {
        id: e.run,
        started_at: e.at,
        ...(e.skill_versions?.hitld_version !== undefined
          ? { hitld_version: e.skill_versions.hitld_version }
          : {}),
        ...(e.policy_hash !== undefined ? { policy_hash: e.policy_hash } : {}),
      };
      state.scope = e.scope ? structuredClone(e.scope) : {};
      state.decisions_answered = [];
      state.lease = leaseOf(e);
      break;
    case 'lease-taken':
      state.lease = leaseOf(e);
      break;
    case 'lease-released':
      // Only the holder's lease is released: an event about a session that no longer holds it
      // (it was taken over meanwhile) changes nothing.
      if (state.lease && state.lease.session === e.session && state.lease.host === e.host) {
        state.lease.released = { at: e.at, reason: e.reason, by: e.by };
      }
      break;
    case 'asked':
      if (!state.decisions_open.some((/** @type {any} */ q) => q.decision === e.decision)) {
        state.decisions_open.push({
          decision: e.decision,
          ...(e.dispatch !== undefined ? { dispatch: e.dispatch } : {}),
          asked_at: e.at,
        });
      }
      break;
    case 'sent': {
      // The first showing only: asking again does not restart the owner's clock.
      const open = state.decisions_open.find((/** @type {any} */ q) => q.decision === e.decision);
      if (open && open.sent_at === undefined) open.sent_at = e.at;
      break;
    }
    case 'answered': {
      state.decisions_open = state.decisions_open.filter(
        (/** @type {any} */ q) => q.decision !== e.decision,
      );
      if (state.run) state.decisions_answered.push({ decision: e.decision, answered_at: e.at });
      break;
    }
    case 'verified':
      state.merge_queue.waiting = state.merge_queue.waiting.filter(
        (/** @type {any} */ w) => w.item !== e.item,
      );
      if (e.result === 'pass') {
        state.merge_queue.waiting.push({ item: e.item, branch: e.branch ?? null });
      }
      break;
    case 'merged':
    case 'reverted':
      state.merge_queue.waiting = state.merge_queue.waiting.filter(
        (/** @type {any} */ w) => w.item !== e.item,
      );
      break;
    default:
  }
  state.ledger_position = e.id;
  return state;
}

/** A fresh lease from a run-started or lease-taken event. @param {LedgerEntry} e */
const leaseOf = (e) => ({
  host: e.host,
  session: e.session,
  renewed_at: e.at,
  ...(e.harness_ref !== undefined ? { harness_ref: e.harness_ref } : {}),
});

/**
 * Bring a state up to the ledger. The position must be in the ledger: a position that is not means
 * the state and the ledger do not belong together, which is an error: rebuild instead.
 *
 * The ledger is the union of the writers' files, ordered by time (ledger/ledger.mjs), so a pull can
 * bring in another writer's event stamped before the position: applying only what comes after the
 * position would skip it for ever. So the state is folded again from the whole ledger, as a
 * rebuild does, and the two cannot disagree. What the ledger cannot give is kept from the state:
 * `controllers`, `quotas`, the checkpoint, and the lease's last renewal while the same lease holds.
 * Applying the same ledger twice changes nothing.
 * @param {RunState} state @param {LedgerEntry[]} events
 * @returns {{ state: RunState, applied: LedgerEntry[], changed: boolean }} applied: the events
 *   after the position; changed: whether what the ledger gives differs from before, which is also
 *   true when only an earlier-stamped event arrived
 */
export function absorb(state, events) {
  const position = state.ledger_position;
  const from = position === null ? 0 : events.findIndex((e) => e.id === position) + 1;
  if (position !== null && from === 0) {
    throw new Error(
      `run state is at ledger event ${position}, which is not in the ledger; run hitld run rebuild`,
    );
  }
  const applied = events.slice(from);
  const before = canonicalJson(ledgerPart(state));
  const folded = foldLedger(events);
  const renewed = state.lease?.renewed_at;
  const sameLease =
    state.lease &&
    folded.lease &&
    canonicalJson({ ...state.lease, renewed_at: null }) ===
      canonicalJson({ ...folded.lease, renewed_at: null });
  for (const key of Object.keys(folded)) {
    if (['controllers', 'quotas', 'checkpoint', 'schema_version'].includes(key)) continue;
    state[key] = folded[key];
  }
  if (sameLease && renewed !== undefined && renewed > state.lease.renewed_at) {
    state.lease.renewed_at = renewed;
  }
  const changed = applied.length > 0 || canonicalJson(ledgerPart(state)) !== before;
  return { state, applied, changed };
}

/** What of a state the ledger gives: all but the parts kept from the state itself. @param {RunState} state */
function ledgerPart(state) {
  const { controllers: _c, quotas: _q, checkpoint: _k, ...rest } = state;
  return { ...rest, lease: rest.lease ? { ...rest.lease, renewed_at: null } : rest.lease };
}

/**
 * Rebuild a state from the whole ledger.
 * @param {LedgerEntry[]} events @returns {RunState}
 */
export function foldLedger(events) {
  const state = blankState();
  for (const e of events) applyEvent(state, e);
  return state;
}

/** The hash a checkpoint records as its predecessor's. @param {RunState} state */
export const hashState = (state) => createHash('sha256').update(canonicalJson(state)).digest('hex');
