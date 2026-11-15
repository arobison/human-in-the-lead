// Trust-calibration data (design parts 2.15 and 21): the facts counted per area from the first run,
// so the record exists when autonomy proposals arrive (the milestone Trust calibration). Recording is all this does.
// Nothing here changes who decides what; the system never grants itself autonomy (design part 4.6).
//
// Events are appended to trust/events.jsonl in the private store. The counts a rate needs from
// elsewhere, such as how many logged calls the orchestrator made, come from the ledger in Trust calibration;
// a rate that would need them is not computed here.

import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} TrustEvent
 */

/** The private store key of the trust-calibration record. */
export const TRUST_KEY = 'trust/events.jsonl';

/** The area counted when none applies. */
export const UNASSIGNED = 'unassigned';

/**
 * Append one event. It is validated first, so the record never holds a line that cannot be read.
 * @param {PrivateStore} store
 * @param {TrustEvent} event everything but schema_version and at
 * @param {string} at
 * @returns {TrustEvent} the line written
 */
export function recordTrustEvent(store, event, at) {
  const line = { schema_version: 1, ...event, at };
  const errors = schemas().validateEntity('trust-event', line);
  if (errors.length) throw new Error(`trust event is invalid: ${formatErrors(errors)}`);
  store.append(TRUST_KEY, JSON.stringify(line) + '\n');
  return line;
}

/**
 * Every event recorded, oldest first.
 * @param {PrivateStore} store @returns {TrustEvent[]}
 */
export function readTrustEvents(store) {
  return (store.read(TRUST_KEY) ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => fromLegacyTrustEvent(JSON.parse(l)));
}

/**
 * A trust event in the names before HITLD-82 (`worth`, `what`), read as `worth_asking` and
 * `subject_kind`. The log is append-only, so this is read permanently.
 * @param {any} e
 */
export function fromLegacyTrustEvent(e) {
  if (!e || typeof e !== 'object' || !('worth' in e || 'what' in e)) return e;
  const { worth, what, ...rest } = e;
  return {
    ...rest,
    ...(worth !== undefined && rest.worth_asking === undefined ? { worth_asking: worth } : {}),
    ...(what !== undefined && rest.subject_kind === undefined ? { subject_kind: what } : {}),
  };
}

/** @param {number} n @param {number} d */
const share = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

/**
 * The counts per area (design part 2.15):
 * - escalation worth: of the questions rated, the share rated worth asking;
 * - precedent-match accuracy: of precedent applications, the share not overruled; and of questions
 *   sent despite candidate precedents, the share answered as a candidate would have;
 * - overturn: reversals and overrules, as counts;
 * - auto-resolution: the share of questions that precedent resolved, the Goodhart pair of the
 *   overrule share (design part 11.3).
 * @param {readonly TrustEvent[]} events
 * @returns {Record<string, Record<string, any>>} by area
 */
export function trustSummary(events) {
  /** @type {Record<string, Record<string, any>>} */
  const areas = {};
  /** @param {string} name */
  const of = (name) =>
    (areas[name] ??= {
      asked: 0,
      answered: 0,
      rated: 0,
      worth_asking: 0,
      applications: 0,
      overrules: 0,
      reversals: 0,
      asked_with_candidates: 0,
      answered_as_candidate: 0,
      generalizations: { yes: 0, narrowed: 0, 'just-this-one': 0, 'none-given': 0 },
      precedents_created: 0,
    });
  /** @type {Set<string>} */
  const overruled = new Set();
  /** @type {Set<string>} candidates cited, by decision */
  const cited = new Set();
  for (const e of events) {
    const a = of(e.area);
    if (e.kind === 'asked') {
      a.asked++;
      if (e.candidates?.length) {
        a.asked_with_candidates++;
        cited.add(e.subject);
      }
    } else if (e.kind === 'answered') {
      a.answered++;
      if (e.generalization) a.generalizations[e.generalization]++;
      if (cited.has(e.subject) && e.agrees_with?.length) a.answered_as_candidate++;
    } else if (e.kind === 'worth-asking') {
      a.rated++;
      if (e.worth_asking) a.worth_asking++;
    } else if (e.kind === 'application') {
      a.applications++;
    } else if (e.kind === 'overrule') {
      if (!overruled.has(e.subject)) a.overrules++;
      overruled.add(e.subject);
    } else if (e.kind === 'reversal') {
      a.reversals++;
    } else if (e.kind === 'precedent-created') {
      a.precedents_created++;
    }
  }
  for (const a of Object.values(areas)) {
    a.escalation_worth = share(a.worth_asking, a.rated);
    a.precedent_match_accuracy = share(a.applications - a.overrules, a.applications);
    a.candidate_agreement = share(a.answered_as_candidate, a.asked_with_candidates);
    a.overrule_rate = share(a.overrules, a.applications);
    a.auto_resolution_rate = share(a.applications, a.applications + a.asked);
  }
  return areas;
}
