// Making and changing precedents (design part 4.3). These are pure: they take data and return the
// new precedent; storing it, and recording that it happened, are the caller's.
//
// A precedent is created only from a generalization the decider confirmed: the offer drafted with
// the question, accepted as it stands or narrowed. Declining it ("just this one") creates nothing.

import { safePaths } from './glob.mjs';

/**
 * @typedef {Record<string, any>} Precedent
 * @typedef {import('./match.mjs').Facts} Facts
 *
 * @typedef {object} Narrowing what a decider narrowed the offer to ("only for cache keys")
 * @property {string} [text] plain words, added to the rule and to the conditions
 * @property {string[]} [areas]
 * @property {string[]} [item_kinds]
 * @property {string[]} [paths]
 * @property {string[]} [tags]
 */

const LIST_KEYS = /** @type {const} */ (['areas', 'item_kinds', 'paths', 'tags']);

/**
 * The precedent a confirmed generalization makes.
 * @param {{
 *   id: string,
 *   offer: Record<string, any>,
 *   decider: string,
 *   decisionId: string,
 *   classification: string,
 *   narrow?: Narrowing | null,
 *   policyHash: string | null,
 *   at: string,
 * }} input
 * @returns {Precedent}
 */
export function draftPrecedent({
  id,
  offer,
  decider,
  decisionId,
  classification,
  narrow,
  policyHash,
  at,
}) {
  /** @type {Record<string, any>} */
  const conditions = structuredClone(offer.conditions);
  let rule = offer.rule;
  if (narrow) {
    const unsafe = safePaths(narrow.paths ?? []).errors[0];
    if (unsafe) throw new Error(`narrowing paths: ${unsafe}`);
    for (const key of LIST_KEYS) {
      const want = narrow[key];
      if (!want?.length) continue;
      const base = conditions[key];
      if (base) {
        const both = want.filter((/** @type {string} */ x) => base.includes(x));
        if (both.length === 0) {
          throw new Error(
            `narrowing ${key} ${want.join(', ')} shares nothing with the offer's ${base.join(', ')}`,
          );
        }
        conditions[key] = both;
      } else {
        conditions[key] = [...want];
      }
    }
    if (narrow.text) {
      conditions.text = conditions.text ? `${conditions.text}; ${narrow.text}` : narrow.text;
      rule = `${rule.replace(/\.$/, '')}, only for ${narrow.text}.`;
    }
  }
  /** @type {Precedent} */
  const p = {
    schema_version: 1,
    id,
    rule,
    conditions,
    sources: [decisionId],
    scope: offer.scope ?? 'project',
    decider,
    state: 'active',
    checked: { at, ...(policyHash ? { policy_hash: policyHash } : {}) },
    classification,
  };
  if (offer.exceptions?.length) p.exceptions = structuredClone(offer.exceptions);
  return p;
}

/**
 * The exception an overrule adds by default: cases like the one the owner reversed, by the
 * structured attributes that tell it apart. Null when it has none, and then the overrule retires.
 * @param {Facts} facts the facts of the reversed application
 * @returns {Record<string, any> | null}
 */
export function exceptionFromFacts(facts) {
  /** @type {Record<string, any>} */
  const when = {};
  for (const [from, to] of /** @type {const} */ ([
    ['areas', 'areas'],
    ['item_kinds', 'item_kinds'],
    ['paths', 'paths'],
    ['tags', 'tags'],
  ])) {
    if (facts[from]?.length) when[to] = [...facts[from]];
  }
  // A path or tag or area tells cases apart; an item kind alone does not.
  return when.areas || when.paths || when.tags ? when : null;
}

/**
 * Narrow a precedent: add an exception, so it no longer covers cases like the one reversed.
 * @param {Precedent} p
 * @param {{ when: Record<string, any>, why?: string, policyHash?: string | null, at: string }} change
 * @returns {Precedent}
 */
export function narrowPrecedent(p, { when, why, policyHash, at }) {
  return {
    ...structuredClone(p),
    state: 'narrowed',
    exceptions: [...(p.exceptions ?? []), { when, ...(why ? { why } : {}) }],
    checked: { at, ...(policyHash ? { policy_hash: policyHash } : {}) },
  };
}

/**
 * Retire a precedent: it no longer resolves anything.
 * @param {Precedent} p
 * @param {{ why?: string, policyHash?: string | null, at: string }} change
 * @returns {Precedent}
 */
export function retirePrecedent(p, { why, policyHash, at }) {
  return {
    ...structuredClone(p),
    state: 'retired',
    exceptions: [...(p.exceptions ?? []), ...(why ? [`retired: ${why}`] : [])],
    checked: { at, ...(policyHash ? { policy_hash: policyHash } : {}) },
  };
}
