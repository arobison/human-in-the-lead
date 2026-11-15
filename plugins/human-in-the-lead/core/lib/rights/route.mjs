// Which decider a question goes to, and by which rule (design parts 4.2, 4.4 and 4.5).
//
// The rules are data in policy.json (`rights.rules`, `rights.areas`, `rights.agent_spend_max_tokens`).
// This is a script, not a judgment: it takes a question's attributes and returns the decider and
// the rule that fired, so every call that was or was not sent to a person can be traced to a rule.

import { matchesAny, safePaths } from '../precedent/glob.mjs';

/**
 * @typedef {import('../policy/policy.mjs').Policy} Policy
 * @typedef {Record<string, any>} Question the attributes in schemas/question.schema.json
 *
 * @typedef {object} Fired one rule basis that holds for the question
 * @property {string} basis
 * @property {string} reason why it holds
 * @property {'asked' | 'checked'} source the holder said so, or the script checked it
 * @property {'owner' | 'area-owner'} decider who that rule alone sends it to
 * @property {string[]} deciders "owner", or the contributor IDs of the area owners
 * @property {string} why how the rule picked the decider
 *
 * @typedef {object} Route
 * @property {'owner' | 'area-owner' | 'system'} decider
 * @property {string[]} deciders "owner", contributor IDs, or none when the system decides
 * @property {string | null} basis the rule basis that decided it, null when the system decides
 * @property {{ id: string, basis: string | null, decider: string, owner_when: string[], why: string }} rule
 * @property {Fired[]} fired every rule basis that holds, in BASIS_ORDER
 * @property {string[]} areas the areas involved, named or found from paths
 * @property {string} reason one sentence for the digest
 * @property {string | null} addressed who a judgment conflict is also put to, besides the rule's deciders
 * @property {boolean} addressed_ignored the question named an addressee it may not
 */

/**
 * The order bases are listed and named in, strictest first. When several hold, the first whose
 * rule sends it to the owner is the rule that decided it.
 */
export const BASIS_ORDER = Object.freeze([
  'rule-change',
  'security',
  'one-way-door',
  'public-commitment',
  'budget',
  'relationship',
  'blast-radius',
  'conflicting-evidence',
  'novelty',
]);

/**
 * A question in the names before HITLD-82: `direction` is `touches_direction`. Read until the next
 * minor release, from an orchestrator that still writes the old name.
 * @param {any} q
 */
export function fromLegacyQuestion(q) {
  if (!q || typeof q !== 'object' || !Object.hasOwn(q, 'direction')) return q;
  const { direction, ...rest } = q;
  return rest.touches_direction === undefined ? { ...rest, touches_direction: direction } : rest;
}

/**
 * The question with its paths normalized (posix.normalize), or what is wrong with them. Done before
 * routing and matching, so `src/cache/../../secret` cannot be read as a cache path, and an
 * absolute path or one that leaves the repository is refused, not guessed at.
 * @param {Question} question
 * @returns {{ question: Question, errors: string[] }}
 */
export function normalizeQuestion(question) {
  if (!question.paths) return { question, errors: [] };
  const { paths, errors } = safePaths(question.paths);
  return {
    question: { ...question, paths: [...new Set(paths)] },
    errors: errors.map((e) => `paths: ${e}`),
  };
}

/**
 * The areas a question touches: those it names, and those whose path globs match its paths.
 * @param {Question} question @param {Policy} policy @returns {string[]}
 */
export function areasOf(question, policy) {
  /** @type {Set<string>} */
  const out = new Set(question.areas ?? []);
  for (const area of policy.rights?.areas ?? []) {
    const paths = /** @type {string[]} */ (question.paths ?? []);
    if (paths.some((p) => matchesAny(area.paths ?? [], p))) out.add(area.name);
  }
  return [...out].sort();
}

/**
 * Who a question is addressed to, if that is allowed: only a genuine judgment conflict, whose one
 * asserted trigger is conflicting evidence (design part 3.2, Not infallible), may be put to one
 * person. Any other question that names an addressee is routed as if it did not.
 * @param {Question} question @returns {string | null}
 */
export function addresseeOf(question) {
  const triggers = question.triggers ?? [];
  const conflictOnly =
    triggers.length > 0 &&
    triggers.every((/** @type {{ basis: string }} */ t) => t.basis === 'conflicting-evidence');
  return question.addressed_to && conflictOnly ? question.addressed_to : null;
}

/**
 * Which rule bases hold for a question.
 * @param {Question} question @param {Policy} policy @param {string[]} areas @returns {Fired[]}
 */
function firedBases(question, policy, areas) {
  /** @type {Map<string, { reason: string, source: 'asked' | 'checked' }>} */
  const found = new Map();
  for (const t of question.triggers ?? []) {
    if (!found.has(t.basis)) found.set(t.basis, { reason: t.reason, source: 'asked' });
  }
  /** @param {string} basis @param {string} reason */
  const check = (basis, reason) => {
    if (!found.has(basis)) found.set(basis, { reason, source: 'checked' });
  };
  if (question.reversibility === 'one-way') check('one-way-door', 'it is a one-way door');
  const max = policy.rights?.agent_spend_max_tokens;
  if (typeof question.spend_tokens === 'number' && question.spend_tokens > max) {
    check(
      'budget',
      `it commits ${question.spend_tokens} tokens beyond an approved appetite; agents may commit ${max}`,
    );
  }
  if (areas.length > 1) check('blast-radius', `it spans areas ${areas.join(', ')}`);

  return BASIS_ORDER.filter((b) => found.has(b)).map((basis) => {
    const f = /** @type {{ reason: string, source: 'asked' | 'checked' }} */ (found.get(basis));
    return { basis, ...f, ...decide(basis, question, policy, areas) };
  });
}

/**
 * Who one rule sends a question to.
 * @param {string} basis @param {Question} question @param {Policy} policy @param {string[]} areas
 * @returns {{ decider: 'owner' | 'area-owner', deciders: string[], why: string }}
 */
function decide(basis, question, policy, areas) {
  const rule = policy.rights.rules[basis];
  /** @param {string} why @returns {{ decider: 'owner', deciders: string[], why: string }} */
  const owner = (why) => ({ decider: 'owner', deciders: ['owner'], why });
  if (!rule || rule.decider === 'owner') return owner('the rule names the owner');
  const when = rule.owner_when ?? [];
  if (when.includes('cross-area') && areas.length > 1) {
    return owner(`the rule sends a call across areas (${areas.join(', ')}) to the owner`);
  }
  if (when.includes('direction') && question.touches_direction) {
    return owner('the rule sends a call that touches direction to the owner');
  }
  if (areas.length === 0) return owner('no area is identified, so there is no area owner');
  /** @type {Set<string>} */
  const owners = new Set();
  for (const name of areas) {
    const area = policy.rights.areas.find((/** @type {any} */ a) => a.name === name);
    if (!area?.owners?.length) return owner(`area ${name} has no owner`);
    if (!(area.may_decide ?? []).includes(basis)) {
      return owner(`the owners of ${name} may not decide ${basis}`);
    }
    for (const o of area.owners) owners.add(o);
  }
  return {
    decider: 'area-owner',
    deciders: [...owners].sort(),
    why: `the rule names the area owner, and ${areas.join(', ')} may decide ${basis}`,
  };
}

/**
 * Classify a call: the owner's, an area owner's, or the system's, and the rule that decided it.
 * Where no rule holds the system decides it, logs it, and moves on (design part 4.2: two-way
 * doors default to action).
 * @param {Question} raw
 * @param {Policy} policy
 * @returns {Route}
 */
export function routeQuestion(raw, policy) {
  const normalized = normalizeQuestion(raw);
  if (normalized.errors.length) throw new Error(normalized.errors.join('; '));
  const question = normalized.question;
  const areas = areasOf(question, policy);
  const fired = firedBases(question, policy, areas);

  if (fired.length === 0) {
    return {
      decider: 'system',
      deciders: [],
      basis: null,
      rule: {
        id: 'rights.default',
        basis: null,
        decider: 'system',
        owner_when: [],
        why: 'no rights rule holds, so the holder decides it, logs it, and moves on',
      },
      fired,
      areas,
      reason: 'no rights rule holds',
      addressed: null,
      addressed_ignored: Boolean(question.addressed_to),
    };
  }

  const owners = fired.filter((f) => f.decider === 'owner');
  const deciding = owners[0] ?? fired[0];
  /** @type {string[]} */
  const deciders = owners.length
    ? ['owner']
    : [...new Set(fired.flatMap((f) => f.deciders))].sort();
  const rule = policy.rights.rules[deciding.basis];
  // A judgment conflict is also put to the person whose judgment it is, as well as to whoever
  // the rules name: addressing a question adds a decider and never takes one away.
  const addressee = addresseeOf(question);
  if (addressee && !deciders.includes(addressee)) deciders.push(addressee);
  return {
    decider: deciders.includes('owner') ? 'owner' : 'area-owner',
    deciders,
    basis: deciding.basis,
    rule: {
      id: `rights.rules.${deciding.basis}`,
      basis: deciding.basis,
      decider: rule.decider,
      owner_when: rule.owner_when ?? [],
      why: deciding.why,
    },
    fired,
    areas,
    reason: `${deciding.basis}: ${deciding.reason}`,
    addressed: addressee,
    addressed_ignored: Boolean(question.addressed_to) && !addressee,
  };
}

/**
 * A question's structured attributes, the shape precedent conditions are matched against.
 * @param {Question} question @param {Route} route
 * @returns {import('../precedent/match.mjs').Facts}
 */
export function factsOf(question, route) {
  /** @type {import('../precedent/match.mjs').Facts} */
  const facts = {};
  if (route.areas.length) facts.areas = route.areas;
  if (question.item_kind) facts.item_kinds = [question.item_kind];
  if (route.fired.length) facts.rights_basis = route.fired.map((f) => f.basis);
  if (question.paths?.length) facts.paths = normalizeQuestion(question).question.paths;
  if (question.tags?.length) facts.tags = [...question.tags];
  return facts;
}
