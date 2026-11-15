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

/** An answer counts as quick when it comes this soon after the question was shown (policy trust.rubber_stamp_seconds). */
export const DEFAULT_RUBBER_STAMP_SECONDS = 60;

/** @param {number} n @param {number} d */
const share = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

/**
 * The counts per area (design part 2.15):
 * - escalation worth: of the questions rated, the share rated worth asking;
 * - precedent-match accuracy: of precedent applications, the share not overruled; and of questions
 *   sent despite candidate precedents, the share answered as a candidate would have;
 * - overturn: reversals and overrules, as counts;
 * - defaults: decisions that took their default with no one answering, and the share of them the
 *   owner reversed (a default is not an answer, so it is in none of the answer counts);
 * - auto-resolution: the share of questions that precedent resolved, the Goodhart pair of the
 *   overrule share (design part 11.3);
 * - rubber stamp: of the answers that record both whether the recommendation was taken and how
 *   long the decider took, the share that took it within `rubberStampSeconds`. Answers without
 *   both are left out of the share, not counted as no. It is the cheapest sign that the decider is
 *   not reading, and also what good recommendations look like, so it is a prompt to look, never a
 *   finding. Its pair is the overturn count: a decider who stamps and later reverses is not reading.
 * A decision rated more than once counts once, by its latest rating.
 * @param {readonly TrustEvent[]} events
 * @param {{ rubberStampSeconds?: number }} [options]
 * @returns {Record<string, Record<string, any>>} by area
 */
export function trustSummary(events, options = {}) {
  const quickMs = (options.rubberStampSeconds ?? DEFAULT_RUBBER_STAMP_SECONDS) * 1000;
  /** @type {Record<string, Record<string, any>>} */
  const areas = {};
  /** @param {string} name */
  const of = (name) =>
    (areas[name] ??= {
      asked: 0,
      answered: 0,
      rated: 0,
      worth_asking: 0,
      recommendation_known: 0,
      recommendation_taken: 0,
      stamp_known: 0,
      stamped: 0,
      applications: 0,
      overrules: 0,
      reversals: 0,
      defaults: 0,
      defaults_reversed: 0,
      asked_with_candidates: 0,
      answered_as_candidate: 0,
      generalizations: { yes: 0, narrowed: 0, 'just-this-one': 0, 'none-given': 0 },
      precedents_created: 0,
    });
  /** @type {Map<string, TrustEvent>} */
  const latestRating = new Map();
  for (const e of events) if (e.kind === 'worth-asking') latestRating.set(e.subject, e);
  /** @type {Set<string>} */
  const overruled = new Set();
  /** @type {Set<string>} candidates cited, by decision */
  const cited = new Set();
  for (const e of events) {
    // Merge approvals and reverts have their own summary (approvalSummary in merge/owner.mjs).
    if (e.kind === 'merge-approval' || e.kind === 'merge-reverted') continue;
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
      if (typeof e.took_recommendation === 'boolean') {
        a.recommendation_known++;
        if (e.took_recommendation) a.recommendation_taken++;
        if (typeof e.latency_ms === 'number') {
          a.stamp_known++;
          if (e.took_recommendation && e.latency_ms <= quickMs) a.stamped++;
        }
      }
    } else if (e.kind === 'worth-asking') {
      if (latestRating.get(e.subject) !== e) continue;
      a.rated++;
      if (e.worth_asking) a.worth_asking++;
    } else if (e.kind === 'application') {
      a.applications++;
    } else if (e.kind === 'overrule') {
      if (!overruled.has(e.subject)) a.overrules++;
      overruled.add(e.subject);
    } else if (e.kind === 'reversal') {
      a.reversals++;
      if (e.subject_kind === 'default') a.defaults_reversed++;
    } else if (e.kind === 'default') {
      a.defaults++;
    } else if (e.kind === 'precedent-created') {
      a.precedents_created++;
    }
  }
  for (const a of Object.values(areas)) {
    a.escalation_worth = share(a.worth_asking, a.rated);
    a.precedent_match_accuracy = share(a.applications - a.overrules, a.applications);
    a.candidate_agreement = share(a.answered_as_candidate, a.asked_with_candidates);
    a.overrule_rate = share(a.overrules, a.applications);
    a.recommendation_taken_rate = share(a.recommendation_taken, a.recommendation_known);
    a.rubber_stamp_rate = share(a.stamped, a.stamp_known);
    a.default_reversal_rate = share(a.defaults_reversed, a.defaults);
    a.auto_resolution_rate = share(a.applications, a.applications + a.asked);
  }
  return areas;
}

/**
 * The rubber-stamp indicator per area, for the digest: the areas with answers to count, the
 * highest share first. It says where to look, not what is wrong (see trustSummary).
 * @param {readonly TrustEvent[]} events
 * @param {{ rubberStampSeconds?: number }} [options]
 */
export function rubberStamps(events, options = {}) {
  const quickSeconds = options.rubberStampSeconds ?? DEFAULT_RUBBER_STAMP_SECONDS;
  return Object.entries(trustSummary(events, options))
    .filter(([, a]) => a.stamp_known > 0)
    .map(([area, a]) => ({
      area,
      rubber_stamp_rate: a.rubber_stamp_rate,
      quick_and_agreeing: a.stamped,
      answers: a.stamp_known,
      quick_seconds: quickSeconds,
      recommendation_taken_rate: a.recommendation_taken_rate,
    }))
    .sort((x, y) => y.rubber_stamp_rate - x.rubber_stamp_rate || x.area.localeCompare(y.area));
}
