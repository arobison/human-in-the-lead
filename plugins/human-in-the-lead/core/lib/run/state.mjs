// The run state as a fold of the ledger (design part 13.1). The run-state file is derived, never
// authoritative: every field that matters is the result of applying ledger events in order, so
// resuming means applying the events after `ledger_position`, and rebuilding means applying them
// all. Both use the same `applyEvent`, so they cannot disagree.
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
      state.lease = { host: e.host, session: e.session, renewed_at: e.at };
      break;
    case 'lease-taken':
      state.lease = { host: e.host, session: e.session, renewed_at: e.at };
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

/**
 * Apply the ledger events after the state's position. Nothing is applied twice: events up to and
 * including `ledger_position` are skipped, so a state that already absorbed some of them (a crash
 * after the checkpoint, a retry) is safe. A position that is not in the ledger means the state
 * and the ledger do not belong together, which is an error: rebuild instead.
 * @param {RunState} state @param {LedgerEntry[]} events
 * @returns {{ state: RunState, applied: LedgerEntry[] }}
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
  for (const e of applied) applyEvent(state, e);
  return { state, applied };
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
