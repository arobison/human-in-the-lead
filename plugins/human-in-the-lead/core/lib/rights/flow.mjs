// The life of a question that is a decider's (design part 4): route it, try precedent, otherwise
// put it to the decider as a decision item; take the answer, with the decider's confirmation of the
// generalization, and make the precedent; list applications for the digest; take overrules.
//
// The tracker is reached only through the TrackerAdapter interface (core/lib/tracker/interface.mjs),
// so this runs against the files backend or a stand-in.
//
// Limitation (for now): the caller is trusted as the local user. `by` on an answer is whatever the
// caller says; no principal is authenticated, so "an area owner answered this" is not verified. What
// is enforced is authority by record: the route, area, basis, classification and offer are recorded
// in the private store when a question is asked, and a precedent takes its authority from that
// record, never from the decision item. Identity is an open decision for the owner (part 22, Q21).
//
// A decision item is created Planned when asked and set Done with its answer. One resolved by a
// precedent is created Planned and set Done at once, with `resolved_by_precedent` set: the
// applications of a precedent are the decisions that cite it (design part 3.2: derived, never
// counted by hand). Creating it Planned first keeps to the lifecycle every backend enforces.
//
// A backend need not hand back every field of a decision. The files backend keeps the question,
// options and offer in the body, as text, and returns only the front-matter keys. So the options
// are also kept in the private store's ask record, and an answer is read against them there when
// the item does not carry them.

import { canonicalJson } from '../policy/policy.mjs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { mayAppearIn, moreRestrictedThan } from '../precedent/classification.mjs';
import { safePaths } from '../precedent/glob.mjs';
import { matchPrecedents, resolveByPrecedent } from '../precedent/match.mjs';
import {
  draftPrecedent,
  exceptionFromFacts,
  narrowPrecedent,
  retirePrecedent,
} from '../precedent/create.mjs';
import { describeOption, formatQuestion, optionIndex, parseAnswer } from './format.mjs';
import { enforceOffer, ownerOnly } from './offer.mjs';
import { factsOf, fromLegacyQuestion, normalizeQuestion, routeQuestion } from './route.mjs';
import { UNASSIGNED, readTrustEvents, recordTrustEvent } from './trust.mjs';
import {
  LOGGED_TEXT_MAX,
  decisionTimes,
  latestAnswered,
  loggedCalls,
  recordDecisionEvent,
  recordLoggedCall,
} from './attention.mjs';

/**
 * @typedef {import('../policy/policy.mjs').Policy} Policy
 * @typedef {import('../tracker/interface.mjs').TrackerAdapter} TrackerAdapter
 * @typedef {import('../precedent/store.mjs').PrecedentStore} PrecedentStore
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../precedent/create.mjs').Narrowing} Narrowing
 *
 * @typedef {object} Deps
 * @property {Policy} policy
 * @property {string | null} [policyHash]
 * @property {TrackerAdapter} tracker
 * @property {PrecedentStore} precedents
 * @property {PrivateStore} store
 * @property {() => string} [now] ISO 8601, for tests
 *
 * @typedef {{ ok: false, error: string, message: string, [key: string]: unknown }} Failure
 * @typedef {{ ok: boolean } & Record<string, any>} Result
 */

/** The state of a decision that has been asked and not answered. */
export const OPEN_STATES = ['proposed', 'planned'];

/**
 * The authority a question was asked under, recorded in the private store when it was asked. A
 * precedent made from its answer takes its authority from this record and from nothing on the
 * decision item, whose fields anyone with tracker access can edit: who may decide, the area, the
 * rule basis, the classification, and the offer the decider was shown. The record also keeps the
 * options and the recommendation, which an answer such as "A" is read against.
 * @typedef {{ deciders: string[], area: string | null, basis: string | null, classification: string, offer: Record<string, any> | null }} Authority
 * Also kept: whether the question is a two-way door and the default it carries. A default is
 * applied only from this record, never from the decision item, so editing the item cannot make
 * one apply (design part 4.2).
 * never_default: the owner's own answer is the only way it closes; no default, and no
 * recommendation taken for one, is ever applied.
 * @typedef {Authority & { options?: Record<string, any>[], recommendation?: Record<string, any>, text?: string, reversibility?: 'two-way' | 'one-way', default_if_unanswered?: { option: string, deadline: string }, never_default?: boolean }} AskedRecord
 */

/** @param {string} id */
export const askedKey = (id) => `rights/asked/${id}.json`;

/** @param {string} text @returns {string[]} */
const splitDeciders = (text) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();

/** What the decision item says now, in the shape of the record. @param {Record<string, any>} e @returns {Authority} */
const currentAuthority = (e) => ({
  deciders: splitDeciders(String(e.decider ?? '')),
  area: e.area ?? null,
  basis: e.rights_basis ?? null,
  classification: e.classification,
  offer: e.precedent_offer ?? null,
});

/** Each part of the authority, and the decision item's field that shows it. */
const AUTHORITY_FIELDS = /** @type {const} */ ([
  ['deciders', 'decider'],
  ['area', 'area'],
  ['basis', 'rights_basis'],
  ['classification', 'classification'],
  ['offer', 'precedent_offer'],
]);

/**
 * Whether the decision item shows an authority other than the one recorded at ask time. Only the
 * fields the item carries are compared: a backend that keeps no rule basis or offer on the item
 * (the files backend keeps them in the body) has nothing there to change, and the precedent takes
 * them from the record either way.
 * @param {Record<string, any>} entity @param {AskedRecord} asked
 */
function authorityChanged(entity, asked) {
  const now = currentAuthority(entity);
  return AUTHORITY_FIELDS.some(
    ([part, field]) =>
      entity[field] !== undefined &&
      canonicalJson(now[part]) !== canonicalJson(asked[part] ?? null),
  );
}

/** @param {Deps} deps */
const nowOf = (deps) => (deps.now ?? (() => new Date().toISOString()))();

/** @param {string} error @param {string} message @param {Record<string, unknown>} [more] @returns {Failure} */
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more });

/**
 * The tracker's version of an entity, for optimistic concurrency. The interface returns a version
 * from writes but offers no read of it; a backend that carries one on the entity as `_version` or
 * `version` (the files backend's blob hash; not data: never validated or written) lets callers use
 * it. Without one, no expectation is set.
 * @param {Record<string, any>} entity
 * @returns {string}
 */
const versionOf = (entity) => /** @type {string} */ (entity._version ?? entity.version);

/** @param {string[]} areas */
const areaLabel = (areas) =>
  areas.length === 0 ? null : areas.length === 1 ? areas[0] : 'cross-area';

/**
 * Check a decision draft against the decision schema, as the tracker will.
 * @param {Deps} deps @param {Record<string, any>} draft @returns {string | null} the problem
 */
function invalidDraft(deps, draft) {
  const errors = schemas().validateEntity('decision', {
    ...draft,
    id: `${deps.policy.project.key}-1`,
  });
  return errors.length ? formatErrors(errors) : null;
}

/**
 * Create the decision item. A refusal by the tracker (no project to file it under, a
 * classification its files cannot hold) is returned as a failure that says what to change.
 * @param {Deps} deps @param {Record<string, any>} draft @returns {string | Failure} the ID
 */
function create(deps, draft) {
  try {
    return deps.tracker.create(draft);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return fail(
      'not-created',
      `the tracker refused the decision item: ${why}${draft.parent ? '' : "; the question's parent names the project to file it under"}`,
    );
  }
}

/**
 * Whether the question has what a decider needs to answer from a phone.
 * @param {Record<string, any>} q @returns {string[]} what is missing
 */
export function missingFromQuestion(q) {
  /** @type {string[]} */
  const missing = [];
  if (!q.question) missing.push('question');
  if (!q.context) missing.push('context');
  if ((q.options ?? []).length < 2) missing.push('options (at least two)');
  if (!q.recommendation) missing.push('recommendation');
  else if (optionIndex({ options: q.options ?? [] }, q.recommendation.option) === null) {
    missing.push('recommendation.option (must name one of the options)');
  }
  return missing;
}

/**
 * Sentences citing candidate precedents, added to the context so the question stands alone. A
 * precedent more confidential than the decision is cited by ID only (design part 4.3).
 * @param {import('../precedent/match.mjs').Candidate[]} candidates @param {string} classification
 */
function citeCandidates(candidates, classification) {
  if (candidates.length === 0) return '';
  const parts = candidates.map((c) =>
    mayAppearIn(c.precedent.classification, classification)
      ? `${c.id} ("${c.precedent.rule}")`
      : c.id,
  );
  return ` Precedents that may apply, and did not settle it: ${parts.join('; ')}. Answering it narrows or reconciles them.`;
}

/**
 * Put a call through the rights rules and, if it is a decider's, through precedent, then to the
 * decider. Returns what became of it:
 * - system: no rule holds; the holder decides, logs it and moves on. Nothing is created.
 * - precedent: one precedent resolves it. A decision item is created Done, citing it.
 * - asked: a decision item is created Planned, and its text is the question to send. It is
 *   written to the ledger as `asked`. With `send`, the question is going to its decider now, and
 *   `sent` is written too, as an interrupt (it uses one of the person's interrupts_per_day);
 *   otherwise it waits for the next digest and `showQuestion` writes `sent` when it is shown.
 * @param {Deps} deps
 * @param {Record<string, any>} given as in schemas/question.schema.json (direction, its name before HITLD-82, is read as touches_direction)
 * @param {{ judged?: Record<string, boolean>, send?: boolean, ownerOnly?: boolean }} [options]
 *   judged: the holder's judgement, per candidate precedent ID, of whether its plain-language
 *   conditions and exceptions fit (design part 4.3, step 2). ownerOnly: a question only the
 *   owner's own answer settles (a store device's enrolment or removal, design 0003 section 6):
 *   it goes to the owner whatever the rules say about areas, no precedent resolves it, it carries
 *   no default, and the record says so, so `rights sweep` never applies one.
 * @returns {Result}
 */
export function askQuestion(deps, given, options = {}) {
  const raw = fromLegacyQuestion(given);
  const invalid = schemas().validate('question', raw);
  if (invalid.length) {
    return fail('invalid-question', formatErrors(invalid), { errors: invalid });
  }
  // Paths are normalized before routing and matching; one that leaves the repository is refused.
  const normalized = normalizeQuestion(raw);
  if (normalized.errors.length) {
    return fail('invalid-question', normalized.errors.join('; '), { errors: normalized.errors });
  }
  const question = normalized.question;
  const route = routeQuestion(question, deps.policy);
  if (options.ownerOnly) {
    if (route.deciders.length !== 1 || route.deciders[0] !== 'owner') {
      return fail(
        'invalid-question',
        `this question is the owner's alone, and the rules route it to ${route.deciders.join(', ') || 'the system'}`,
        { route },
      );
    }
    if (question.default_if_unanswered) {
      return fail('invalid-default', 'a question only the owner settles carries no default');
    }
  }
  if (route.decider === 'system') return { ok: true, outcome: 'system', route };

  const match = options.ownerOnly
    ? { candidates: [] }
    : matchPrecedents(factsOf(question, route), deps.precedents.list(), {
        policy: deps.policy,
        route,
      });
  const { resolved, remaining } = resolveByPrecedent(match.candidates, options.judged);
  const at = nowOf(deps);
  const classification = question.classification ?? 'internal';
  const area = areaLabel(route.areas);
  const facts = factsOf(question, route);

  if (resolved) {
    const p = resolved.precedent;
    const cites = mayAppearIn(p.classification, classification);
    /** @type {Record<string, any>} */
    const draft = {
      schema_version: 1,
      kind: 'decision',
      title: question.title ?? question.question ?? `Resolved by ${p.id}`,
      state: 'done',
      classification,
      ...(area ? { area } : {}),
      ...(question.question ? { question: question.question } : {}),
      ...(question.context ? { context: question.context } : {}),
      ...(question.options ? { options: question.options } : {}),
      ...(question.recommendation ? { recommendation: question.recommendation } : {}),
      decider: route.deciders.join(', '),
      ...(route.basis ? { rights_basis: route.basis } : {}),
      ...(question.reversibility ? { reversibility: question.reversibility } : {}),
      ...(question.opened_from ? { opened_from: question.opened_from } : {}),
      ...(question.parent ? { parent: question.parent } : {}),
    };
    /** @type {Record<string, any>} */
    const answered = {
      answer: cites ? `Resolved by precedent ${p.id}: ${p.rule}` : `Resolved by precedent ${p.id}`,
      answered_at: at,
      answered_via: 'precedent',
      resolved_by_precedent: p.id,
    };
    const problem = invalidDraft(deps, { ...draft, ...answered });
    if (problem) return fail('invalid-decision', problem);
    const made = create(deps, { ...draft, state: 'planned' });
    if (typeof made !== 'string') return made;
    const id = made;
    deps.tracker.update(id, answered, versionOf(deps.tracker.get(id)));
    deps.tracker.transition(id, 'done', `resolved by precedent ${p.id}`, {});
    recordTrustEvent(
      deps.store,
      {
        kind: 'application',
        area: area ?? UNASSIGNED,
        subject: id,
        decider: route.deciders.join(', '),
        ...(route.basis ? { basis: route.basis } : {}),
        precedent: p.id,
        facts,
      },
      at,
    );
    return {
      ok: true,
      outcome: 'precedent',
      decision: id,
      precedent: p.id,
      answer: answered.answer,
      route,
    };
  }

  const missing = missingFromQuestion(question);
  if (missing.length) {
    return fail(
      'incomplete-question',
      `a question for ${route.deciders.join(', ')} must stand alone; it lacks: ${missing.join(', ')}`,
      { missing, route },
    );
  }
  if (question.default_if_unanswered) {
    if (question.reversibility !== 'two-way') {
      return fail(
        'invalid-default',
        'default_if_unanswered is for a two-way door only: set reversibility to two-way, or leave the default out. A call that is hard to undo always waits for the owner',
      );
    }
    if (
      optionIndex({ options: question.options ?? [] }, question.default_if_unanswered.option) ===
      null
    ) {
      return fail(
        'invalid-default',
        `default_if_unanswered.option "${question.default_if_unanswered.option}" must name one of the options, by letter or label`,
      );
    }
  }
  const cite = citeCandidates(remaining, classification);
  /** @type {string[]} */
  const warnings = question.precedent_offer ? [] : ['no_precedent_offer'];
  // The offer shown and stored is the offer as it will be enforced: clamped to what the deciders
  // may make, so the decider approves exactly that.
  let offer = null;
  if (question.precedent_offer) {
    const enforced = enforceOffer(question.precedent_offer, {
      deciders: route.deciders,
      area,
      basis: route.basis,
      policy: deps.policy,
    });
    if ('error' in enforced) warnings.push(`offer-not-permitted: ${enforced.error}`);
    else offer = enforced.offer;
  }
  /** @type {Record<string, any>} */
  const draft = {
    schema_version: 1,
    kind: 'decision',
    title: question.title ?? question.question,
    state: 'planned',
    classification,
    ...(area ? { area } : {}),
    question: question.question,
    context: question.context + cite,
    options: question.options,
    recommendation: question.recommendation,
    ...(offer ? { precedent_offer: offer } : {}),
    decider: route.deciders.join(', '),
    ...(route.basis ? { rights_basis: route.basis } : {}),
    ...(question.reversibility ? { reversibility: question.reversibility } : {}),
    ...(question.default_if_unanswered
      ? { default_if_unanswered: question.default_if_unanswered }
      : {}),
    ...(question.opened_from ? { opened_from: question.opened_from } : {}),
    ...(question.parent ? { parent: question.parent } : {}),
  };
  const problem = invalidDraft(deps, draft);
  if (problem) return fail('invalid-decision', problem);
  const made = create(deps, draft);
  if (typeof made !== 'string') return made;
  const id = made;
  const text = formatQuestion({ ...draft, id }, { blocks: (question.blocks ?? []).length });
  /** @type {AskedRecord} */
  const record = {
    ...currentAuthority(draft),
    options: draft.options,
    recommendation: draft.recommendation,
    ...(draft.reversibility ? { reversibility: draft.reversibility } : {}),
    ...(draft.default_if_unanswered ? { default_if_unanswered: draft.default_if_unanswered } : {}),
    ...(options.ownerOnly ? { never_default: true } : {}),
    text,
  };
  deps.store.write(askedKey(id), canonicalJson(record) + '\n');
  for (const blocked of question.blocks ?? []) deps.tracker.link(blocked, 'needs', id);
  recordTrustEvent(
    deps.store,
    {
      kind: 'asked',
      area: area ?? UNASSIGNED,
      subject: id,
      decider: route.deciders.join(', '),
      ...(route.basis ? { basis: route.basis } : {}),
      ...(remaining.length ? { candidates: remaining.map((c) => c.id) } : {}),
      facts,
    },
    at,
  );
  recordDecisionEvent(deps.store, 'asked', id, at);
  if (options.send) recordDecisionEvent(deps.store, 'sent', id, at, { delivery: 'interrupt' });
  return {
    ok: true,
    outcome: 'asked',
    decision: id,
    route,
    candidates: remaining.map((c) => ({
      id: c.id,
      needs_judgement: c.needs_judgement,
      judge: c.judge,
    })),
    text,
    warnings,
  };
}

/**
 * Show a question to its decider: the text to send, and `sent` in the ledger the first time, so
 * the time it waited for a digest (asked to sent) is told apart from the time the decider took
 * (sent to answered). Showing it again returns the same text and changes nothing. A question shown
 * on its own, at once, is an interrupt and uses one of the person's interrupts_per_day; one shown
 * as part of a digest is not.
 * @param {Deps} deps @param {{ decision: string, interrupt?: boolean }} input
 * @returns {Result}
 */
export function showQuestion(deps, input) {
  /** @type {Record<string, any>} */
  let entity;
  try {
    entity = deps.tracker.get(input.decision);
  } catch (e) {
    return fail('not-found', e instanceof Error ? e.message : String(e));
  }
  if (entity.kind !== 'decision')
    return fail('not-a-decision', `${input.decision} is a ${entity.kind}`);
  if (!OPEN_STATES.includes(entity.state)) {
    return fail(
      'not-open',
      `${input.decision} is ${entity.state}; only an open decision is shown to a decider`,
    );
  }
  const recorded = deps.store.read(askedKey(input.decision));
  /** @type {AskedRecord | null} */
  const asked = recorded ? JSON.parse(recorded) : null;
  /** @type {Record<string, any>} */
  const question = {
    ...entity,
    id: input.decision,
    options: entity.options ?? asked?.options,
    recommendation: entity.recommendation ?? asked?.recommendation,
  };
  if (!asked?.text && !(question.question && question.options)) {
    return fail(
      'no-question-record',
      `${input.decision} was not asked through hitld rights ask, and the tracker does not hold its question, so there is no text to show`,
    );
  }
  const at = nowOf(deps);
  // A decision asked before the ledger recorded questions still gets its `asked`, at this time.
  recordDecisionEvent(deps.store, 'asked', input.decision, at);
  const { event, appended } = recordDecisionEvent(deps.store, 'sent', input.decision, at, {
    delivery: input.interrupt ? 'interrupt' : 'digest',
  });
  return {
    ok: true,
    decision: input.decision,
    text: asked?.text ?? formatQuestion(question),
    sent_at: event.at,
    first_showing: appended,
  };
}

/**
 * Take the answer to a decision item. The answer covers the case; the generalization is a
 * separate thing the decider confirms ("yes"), narrows ("only for cache keys") or declines ("just
 * this one"). Only a confirmed or narrowed generalization makes a precedent; saying nothing makes
 * none (design part 4.3 and the answer to Q3).
 * @param {Deps} deps
 * @param {{
 *   decision: string,
 *   answer: string,
 *   via?: string,
 *   by?: string,
 *   worth_asking?: boolean,
 *   agrees_with?: string[],
 *   narrow?: Narrowing,
 * }} input
 *   answer: as the decider gave it ("A", "A yes", "B just this one", or free text).
 *   narrow: structured narrowing, when the decider's words are not enough.
 *   by: who answered, "owner" or a contributor ID; it must be one of the decision's deciders, or the owner.
 * @returns {Result}
 */
export function answerDecision(deps, input) {
  /** @type {Record<string, any>} */
  let entity;
  try {
    entity = deps.tracker.get(input.decision);
  } catch (e) {
    return fail('not-found', e instanceof Error ? e.message : String(e));
  }
  if (entity.kind !== 'decision')
    return fail('not-a-decision', `${input.decision} is a ${entity.kind}`);
  if (!OPEN_STATES.includes(entity.state)) {
    return fail(
      'not-open',
      `${input.decision} is ${entity.state}; only an open decision takes an answer`,
    );
  }

  // The authority comes from what was recorded at ask time. The item's own fields are checked
  // against it, and a precedent is refused if they differ.
  const recorded = deps.store.read(askedKey(input.decision));
  /** @type {AskedRecord | null} */
  const asked = recorded ? JSON.parse(recorded) : null;
  const deciders = asked ? asked.deciders : splitDeciders(String(entity.decider ?? ''));
  const changed = asked !== null && authorityChanged(entity, asked);
  // The options an answer such as "A" names: the item's own, or, where the backend keeps them as
  // text (the files backend), the ones recorded at ask time.
  const question = {
    ...entity,
    options: entity.options ?? asked?.options,
    recommendation: entity.recommendation ?? asked?.recommendation,
  };
  if (input.by && input.by !== 'owner' && !deciders.includes(input.by)) {
    return fail(
      'not-a-decider',
      `${input.by} is not among the deciders of ${input.decision} (${deciders.join(', ')})`,
    );
  }
  const parsed = parseAnswer(input.answer, question);
  const at = nowOf(deps);
  const answerText =
    parsed.option === null
      ? parsed.text
      : describeOption(question.options[parsed.option], parsed.option);
  /** @type {'yes' | 'narrowed' | 'just-this-one' | 'none-given'} */
  let generalization = parsed.generalization ?? 'none-given';
  const narrow =
    generalization === 'narrowed' || input.narrow
      ? { ...input.narrow, ...(parsed.narrowing ? { text: parsed.narrowing } : {}) }
      : null;
  if (input.narrow && generalization !== 'just-this-one') generalization = 'narrowed';

  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, any> | null} */
  let precedent = null;
  /** @type {import('./offer.mjs').Enforced} */
  let enforced;
  if (generalization === 'yes' || generalization === 'narrowed') {
    const offer = asked?.offer;
    if (!asked) {
      warnings.push(
        'no_route_record: this decision was not asked through hitld rights ask, so nothing was generalized',
      );
    } else if (changed) {
      warnings.push(
        'decision_changed: its decider, area, rule basis, classification or offer differ from what was asked, so nothing was generalized',
      );
    } else if (!offer) {
      warnings.push('no_precedent_offer: the question made none, so nothing was generalized');
    } else if ((deps.policy.precedent?.not_for_bases ?? []).includes(asked.basis ?? '')) {
      warnings.push(
        `a precedent never resolves ${asked.basis}: the answer stands for this case only`,
      );
    } else if (
      'error' in
      (enforced = enforceOffer(offer, {
        deciders,
        area: asked.area,
        basis: asked.basis,
        policy: deps.policy,
      }))
    ) {
      warnings.push(`offer-not-permitted: ${enforced.error}`);
    } else {
      // Re-clamped here from the recorded authority as well as at ask time.
      try {
        precedent = draftPrecedent({
          id: deps.precedents.nextId(),
          offer: enforced.offer,
          decider: ownerOnly(deciders) ? 'owner' : (input.by ?? enforced.decider),
          decisionId: input.decision,
          classification: asked.classification,
          narrow,
          policyHash: deps.policyHash ?? null,
          at,
        });
      } catch (e) {
        return fail('bad-narrowing', e instanceof Error ? e.message : String(e));
      }
      const errors = schemas().validateEntity('precedent', precedent);
      if (errors.length) return fail('invalid-precedent', formatErrors(errors));
    }
  }

  /** @type {Record<string, any>} */
  const patch = {
    answer: answerText,
    answered_at: at,
    answered_via: input.via ?? 'main-session',
    // Answers come only from the owner's own turns (Q21); an area owner's ID, once signed answers
    // exist, is checked against the deciders above.
    answered_by: input.by ?? 'owner',
    ...(parsed.rationale && parsed.option !== null ? { rationale: parsed.rationale } : {}),
    ...(precedent ? { precedent: precedent.id } : {}),
  };
  const area = entity.area ?? asked?.area ?? UNASSIGNED;
  // How long the decider took: from the question being shown, else from its being asked (the
  // ledger first, then the trust record, which an earlier version wrote alone).
  const times = decisionTimes(deps.store, input.decision);
  const startedAt =
    times.sent ??
    times.asked ??
    readTrustEvents(deps.store).find((e) => e.kind === 'asked' && e.subject === input.decision)
      ?.at ??
    null;
  const waited = startedAt === null ? NaN : Date.parse(at) - Date.parse(startedAt);
  const latency = Number.isFinite(waited) ? Math.max(0, waited) : null;
  const recommended = question.recommendation
    ? optionIndex({ options: question.options ?? [] }, question.recommendation.option)
    : null;
  /** @type {boolean | null} */
  const tookRecommendation =
    recommended === null || parsed.option === null ? null : parsed.option === recommended;
  deps.tracker.update(input.decision, patch, versionOf(entity));
  deps.tracker.transition(
    input.decision,
    'done',
    `answered by ${entity.decider ?? 'the decider'}`,
    {},
  );
  /** @type {string | null} */
  let place = null;
  if (precedent) place = deps.precedents.put(precedent);

  recordTrustEvent(
    deps.store,
    {
      kind: 'answered',
      area,
      subject: input.decision,
      ...(entity.decider ? { decider: entity.decider } : {}),
      ...((entity.rights_basis ?? asked?.basis)
        ? { basis: entity.rights_basis ?? asked?.basis }
        : {}),
      generalization,
      ...(input.agrees_with?.length ? { agrees_with: input.agrees_with } : {}),
      ...(tookRecommendation === null ? {} : { took_recommendation: tookRecommendation }),
      ...(latency === null ? {} : { latency_ms: latency }),
    },
    at,
  );
  recordDecisionEvent(deps.store, 'answered', input.decision, at);
  if (typeof input.worth_asking === 'boolean') {
    recordTrustEvent(
      deps.store,
      { kind: 'worth-asking', area, subject: input.decision, worth_asking: input.worth_asking },
      at,
    );
  }
  if (precedent) {
    recordTrustEvent(
      deps.store,
      { kind: 'precedent-created', area, subject: precedent.id, precedent: precedent.id },
      at,
    );
  }
  return {
    ok: true,
    decision: input.decision,
    answer: answerText,
    option: parsed.letter,
    took_recommendation: tookRecommendation,
    latency_ms: latency,
    generalization,
    precedent: precedent ? { id: precedent.id, rule: precedent.rule, stored_in: place } : null,
    warnings,
  };
}

/**
 * The owner reverses an application of a precedent (design part 4.3, Overrules). The precedent is
 * narrowed by an exception, by default to cases like the one reversed, or retired when nothing
 * tells those cases apart or the owner says so. The reversal is recorded.
 * @param {Deps} deps
 * @param {{
 *   decision: string,
 *   why: string,
 *   when?: Record<string, any>,
 *   retire?: boolean,
 * }} input
 *   decision: the decision item the precedent resolved.
 *   when: structured conditions for the exception, instead of the reversed case's attributes.
 * @returns {Result}
 */
export function overrule(deps, input) {
  const events = readTrustEvents(deps.store);
  const application = events.find((e) => e.kind === 'application' && e.subject === input.decision);
  if (!application) {
    return fail(
      'not-an-application',
      `${input.decision} was not resolved by a precedent, so there is nothing to overrule`,
    );
  }
  if (events.some((e) => e.kind === 'overrule' && e.subject === input.decision)) {
    return fail('already-overruled', `${input.decision} was already overruled`);
  }
  const p = deps.precedents.get(application.precedent);
  if (!p) return fail('no-precedent', `precedent ${application.precedent} is not in the store`);
  const at = nowOf(deps);
  const policyHash = deps.policyHash ?? null;
  // A decision more confidential than the precedent must not leak into it: neither its attributes
  // (the exception derived from its facts) nor the owner's reason. The precedent is public to
  // whoever may read it; the reversal and its reason are kept in the private trust record.
  /** @type {Record<string, any>} */
  let reversed;
  try {
    reversed = deps.tracker.get(input.decision);
  } catch (e) {
    return fail('not-found', e instanceof Error ? e.message : String(e));
  }
  const unsafe = safePaths(input.when?.paths ?? []).errors[0];
  if (unsafe) return fail('invalid-exception', `when.paths: ${unsafe}`);
  const sensitive = moreRestrictedThan(reversed.classification, p.classification);
  if (sensitive && input.when === undefined && input.retire !== true) {
    return fail(
      'sensitive-exception',
      `${input.decision} is ${reversed.classification} and ${p.id} is ${p.classification}, so the exception is not derived from the reversed case. Give --when with attributes fit for ${p.id}, or --retire`,
    );
  }
  const when = input.when ?? (sensitive ? null : exceptionFromFacts(application.facts ?? {}));
  const retire = input.retire === true || when === null;
  const publicWhy = sensitive ? undefined : input.why;
  const changed = retire
    ? retirePrecedent(p, { why: publicWhy, policyHash, at })
    : narrowPrecedent(p, {
        when: /** @type {Record<string, any>} */ (when),
        why: publicWhy,
        policyHash,
        at,
      });
  const errors = schemas().validateEntity('precedent', changed);
  if (errors.length) return fail('invalid-precedent', formatErrors(errors));
  deps.precedents.put(changed);
  recordTrustEvent(
    deps.store,
    {
      kind: 'overrule',
      area: application.area,
      subject: input.decision,
      precedent: p.id,
      note: input.why,
    },
    at,
  );
  recordTrustEvent(
    deps.store,
    {
      kind: retire ? 'precedent-retired' : 'precedent-narrowed',
      area: application.area,
      subject: p.id,
      precedent: p.id,
      note: input.why,
    },
    at,
  );
  return {
    ok: true,
    precedent: p.id,
    action: retire ? 'retired' : 'narrowed',
    ...(retire ? {} : { exception: { when, why: input.why } }),
    state: changed.state,
  };
}

/**
 * Record that the owner reversed a call the system made without a precedent: a logged call, a
 * triage route, a controller move. A reversal can become precedent like any other answer; that is
 * a question to ask, not something recorded here.
 *
 * A subject that is the ID of a logged call in the ledger (the one the digest lists) is a reversal
 * of that call: its kind and area are the call's, and it can be reversed once. A subject that is a
 * decision that took its default is a reversal of that default, on the same terms: the owner's
 * note says what they want instead, and the orchestrator undoes what the default started and
 * applies it.
 * @param {Deps} deps
 * @param {{ subject: string, subject_kind?: 'logged-call' | 'triage-route' | 'controller-move' | 'default' | 'other', area?: string, note?: string }} input
 * @returns {Result}
 */
export function recordReversal(deps, input) {
  const call = loggedCalls(deps.store).find((e) => e.id === input.subject);
  const trust = readTrustEvents(deps.store);
  const defaulted = trust.find((e) => e.kind === 'default' && e.subject === input.subject);
  const target = call?.id ?? (defaulted ? input.subject : null);
  if (target && trust.some((e) => e.kind === 'reversal' && e.subject === target)) {
    return fail('already-reversed', `${target} was already reversed`);
  }
  const line = recordTrustEvent(
    deps.store,
    {
      kind: 'reversal',
      area: input.area ?? call?.area ?? defaulted?.area ?? UNASSIGNED,
      subject: input.subject,
      subject_kind: input.subject_kind ?? (call ? 'logged-call' : defaulted ? 'default' : 'other'),
      ...(input.note ? { note: input.note } : {}),
    },
    nowOf(deps),
  );
  return {
    ok: true,
    recorded: line,
    ...(call ? { logged_call: call.text } : {}),
    ...(defaulted
      ? {
          default_reversed: input.subject,
          next: `${input.subject} took its default with no one answering. Undo what that default started and apply the owner's choice${input.note ? ` (their note: ${input.note})` : ''}`,
        }
      : {}),
  };
}

/**
 * Record a call made without asking (design part 4.2): a ledger event the digest lists with the
 * way to reverse it. The holder decides a two-way door that is in no way the owner's, logs it and
 * moves on; this is the log.
 * @param {Deps} deps @param {{ text: string, item?: string, dispatch?: string, area?: string }} input
 * @returns {Result}
 */
export function logCall(deps, input) {
  const text = String(input.text ?? '').trim();
  if (text === '') return fail('invalid-call', 'a logged call needs its text: what was decided');
  if (text.length > LOGGED_TEXT_MAX) {
    return fail(
      'invalid-call',
      `a logged call is a sentence, at most ${LOGGED_TEXT_MAX} characters; this one is ${text.length}`,
    );
  }
  try {
    const event = recordLoggedCall(deps.store, { ...input, text }, nowOf(deps));
    return { ok: true, id: event.id, event, reverse_with: reverseCommand(event.id) };
  } catch (e) {
    return fail('invalid-call', e instanceof Error ? e.message : String(e));
  }
}

/** @param {string} id */
const reverseCommand = (id) => `hitld rights reverse ${id}`;

/**
 * The logged calls for the digest, each with whether the owner has reversed it and the command
 * that reverses it.
 * @param {Deps} deps @param {{ since?: string | null }} [filter] since: only those logged after it
 */
export function listLoggedCalls(deps, filter = {}) {
  const reversed = new Set(
    readTrustEvents(deps.store)
      .filter((e) => e.kind === 'reversal')
      .map((e) => e.subject),
  );
  return loggedCalls(deps.store, filter).map((e) => ({
    id: e.id,
    text: e.text,
    ...(e.item ? { item: e.item } : {}),
    ...(e.dispatch ? { dispatch: e.dispatch } : {}),
    area: e.area ?? UNASSIGNED,
    at: e.at,
    reversed: reversed.has(e.id),
    ...(reversed.has(e.id) ? {} : { reverse_with: reverseCommand(e.id) }),
  }));
}

/**
 * Record the one-tap "worth asking?" rating of an answered question, offered with each question
 * and never required. Without a decision it rates the one answered last, so "that was not worth
 * asking" right after an answer is a rating of that answer. A later rating of the same decision
 * replaces the earlier one in the counts.
 * @param {Deps} deps @param {{ decision?: string, worth: boolean }} input
 */
export function rateWorthAsking(deps, input) {
  const decision = input.decision ?? latestAnswered(deps.store);
  if (!decision) {
    return fail(
      'nothing-to-rate',
      'no decision has been answered yet, so there is nothing to rate',
    );
  }
  /** @type {Record<string, any>} */
  let entity;
  try {
    entity = deps.tracker.get(decision);
  } catch (e) {
    return fail('not-found', e instanceof Error ? e.message : String(e));
  }
  const line = recordTrustEvent(
    deps.store,
    {
      kind: 'worth-asking',
      area: entity.area ?? UNASSIGNED,
      subject: decision,
      worth_asking: input.worth,
    },
    nowOf(deps),
  );
  return { ok: true, decision, recorded: line };
}

/**
 * The applications of precedent: the decisions that cite one (derived, design part 3.2), with
 * whether the owner has since overruled each.
 * @param {Deps} deps
 * @param {{ since?: string | null, precedent?: string }} [filter] since: only those answered after it
 */
export function listApplications(deps, filter = {}) {
  const overruled = new Set(
    readTrustEvents(deps.store)
      .filter((e) => e.kind === 'overrule')
      .map((e) => e.subject),
  );
  const rules = new Map(deps.precedents.list().map((p) => [p.id, p]));
  return deps.tracker
    .query({ kind: 'decision', state: 'done' })
    .filter((d) => typeof d.resolved_by_precedent === 'string')
    .filter((d) => !filter.precedent || d.resolved_by_precedent === filter.precedent)
    .filter((d) => !filter.since || String(d.answered_at) > filter.since)
    .map((d) => {
      const p = rules.get(/** @type {string} */ (d.resolved_by_precedent));
      const cites = p && mayAppearIn(p.classification, d.classification);
      return {
        decision: d.id,
        title: d.title,
        precedent: d.resolved_by_precedent,
        ...(cites && p ? { rule: p.rule } : {}),
        answer: d.answer,
        at: d.answered_at,
        area: d.area ?? UNASSIGNED,
        overruled: overruled.has(d.id),
      };
    });
}

/**
 * Per precedent: applications, overrules, and the share overruled; flagged for the owner's review
 * when the share is above precedent.overrule_max with enough applications to mean something
 * (design part 4.3, Strength).
 * @param {Deps} deps
 */
export function precedentHealth(deps) {
  const { overrule_max: max = 0.2, review_min_applications: min = 3 } = deps.policy.precedent ?? {};
  const events = readTrustEvents(deps.store);
  const apps = listApplications(deps);
  return deps.precedents.list().map((p) => {
    const applications = apps.filter((a) => a.precedent === p.id).length;
    const overrules = new Set(
      events.filter((e) => e.kind === 'overrule' && e.precedent === p.id).map((e) => e.subject),
    ).size;
    const share = applications === 0 ? null : Math.round((overrules / applications) * 1000) / 1000;
    return {
      precedent: p.id,
      state: p.state,
      applications,
      overrules,
      overrule_share: share,
      needs_review: p.state !== 'retired' && applications >= min && share !== null && share > max,
    };
  });
}
