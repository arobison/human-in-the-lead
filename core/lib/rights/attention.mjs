// The owner's attention in the ledger (design parts 5.4 and 11.1): when a question was asked, when
// it was first shown to its decider, when it was answered, and the calls the orchestrator made
// without asking. Queue time is asked to sent; owner time is sent to answered.
//
// These write the ledger directly, as the rights commands do for the trust record: they run in
// the owner's main session, which need not be the session holding the run's lease. A run state
// that is behind absorbs the events the next time anything is recorded or resumed.
//
// Each of asked, sent and answered is written once per decision: a second one, from a retry or an
// orchestrator that already recorded it, is not appended. A decision a precedent resolves is
// neither asked nor answered here: no one was asked, so it adds nothing to decision latency. Its
// application is in the trust record.

import { appendEvent, readLedger } from '../ledger/ledger.mjs';
import { effectiveEvents } from '../ledger/summary.mjs';
import { loadState } from '../run/checkpoint.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 */

/** The longest logged call: it is a sentence in a digest, not a report. */
export const LOGGED_TEXT_MAX = 500;

/** @param {PrivateStore} store */
function currentRun(store) {
  try {
    return loadState(store).state?.run?.id;
  } catch {
    return undefined;
  }
}

/**
 * The session and host that wrote an event no dispatch wrote. Either may be unknown.
 * @typedef {{ session?: string, host?: string }} Who
 */

/** @param {Who | undefined} who */
const whoFields = (who) => ({
  ...(who?.session ? { session: who.session } : {}),
  ...(who?.host ? { host: who.host } : {}),
});

/**
 * Record asked, sent or answered for a decision, once.
 * @param {PrivateStore} store
 * @param {'asked' | 'sent' | 'answered'} event
 * @param {string} decision
 * @param {string} at ISO 8601
 * @param {{ delivery?: 'interrupt' | 'digest', via?: 'default', who?: Who, text?: string }} [extra] on
 *   sent: how it was sent; on answered: that a default took it, and the answer as written in the
 *   item (text), which a merge under the owner's delegation checks a changed answer against; who:
 *   the session and host that write it
 * @returns {{ event: LedgerEntry, appended: boolean }} the event now in the ledger
 */
export function recordDecisionEvent(store, event, decision, at, extra = {}) {
  const existing = readLedger(store).events.find(
    (e) => e.event === event && e.decision === decision && e.corrects === undefined,
  );
  if (existing) return { event: existing, appended: false };
  const run = currentRun(store);
  const { event: written, appended } = appendEvent(store, {
    id: `${event}-${decision}`,
    event,
    decision,
    ...(run ? { run } : {}),
    ...(extra.delivery ? { delivery: extra.delivery } : {}),
    ...(extra.via ? { via: extra.via } : {}),
    ...(event === 'answered' && extra.text ? { text: extra.text } : {}),
    ...whoFields(extra.who),
    at,
  });
  return { event: written, appended };
}

/**
 * When a decision was asked and first shown, from the ledger. Either is null when not recorded.
 * @param {PrivateStore} store @param {string} decision
 * @returns {{ asked: string | null, sent: string | null }}
 */
export function decisionTimes(store, decision) {
  const events = effectiveEvents(readLedger(store).events).filter((e) => e.decision === decision);
  const first = (/** @type {string} */ kind) => events.find((e) => e.event === kind)?.at ?? null;
  return { asked: first('asked'), sent: first('sent') };
}

/**
 * What the ledger says of each decision's life: when it was asked, first shown and how, and when
 * it was answered and by whom.
 * @param {PrivateStore} store
 * @returns {Map<string, { asked: string | null, sent: string | null, delivery: 'interrupt' | 'digest' | null, answered: string | null, via: string | null }>}
 */
export function decisionLives(store) {
  /** @type {Map<string, { asked: string | null, sent: string | null, delivery: 'interrupt' | 'digest' | null, answered: string | null, via: string | null }>} */
  const lives = new Map();
  for (const e of effectiveEvents(readLedger(store).events)) {
    if (e.decision === undefined || !['asked', 'sent', 'answered'].includes(e.event)) continue;
    const life = lives.get(e.decision) ?? {
      asked: null,
      sent: null,
      delivery: null,
      answered: null,
      via: null,
    };
    lives.set(e.decision, life);
    if (e.event === 'asked') life.asked ??= e.at;
    else if (e.event === 'sent' && life.sent === null) {
      life.sent = e.at;
      life.delivery = e.delivery ?? 'digest';
    } else if (e.event === 'answered' && life.answered === null) {
      life.answered = e.at;
      life.via = e.via ?? null;
    }
  }
  return lives;
}

/**
 * The decision the person answered last, for a rating given right after an answer. A decision
 * that took its default was not answered by anyone, so it is not rated.
 * @param {PrivateStore} store @returns {string | null}
 */
export function latestAnswered(store) {
  const events = effectiveEvents(readLedger(store).events);
  return events.findLast((e) => e.event === 'answered' && e.via === undefined)?.decision ?? null;
}

/**
 * Record a call the orchestrator made without asking (design part 4.2): the digest lists it, and
 * the owner can reverse it by the event's ID.
 * @param {PrivateStore} store
 * @param {{ text: string, item?: string, dispatch?: string, area?: string, session?: string, host?: string }} call
 *   session and host: who made the call (the session that logs it, and its machine)
 * @param {string} at ISO 8601
 * @returns {LedgerEntry}
 */
export function recordLoggedCall(store, call, at) {
  const run = currentRun(store);
  return appendEvent(store, {
    event: 'logged',
    text: call.text,
    ...(call.item ? { item: call.item } : {}),
    ...(call.dispatch ? { dispatch: call.dispatch } : {}),
    ...(call.area ? { area: call.area } : {}),
    ...whoFields(call),
    ...(run ? { run } : {}),
    at,
  }).event;
}

/**
 * The logged calls, oldest first, as the ledger stands after corrections.
 * @param {PrivateStore} store
 * @param {{ since?: string | null }} [filter] since: only those logged after it
 * @returns {LedgerEntry[]}
 */
export function loggedCalls(store, filter = {}) {
  return effectiveEvents(readLedger(store).events).filter(
    (e) => e.event === 'logged' && (!filter.since || e.at > filter.since),
  );
}
