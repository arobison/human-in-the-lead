// What a precedent offer may promise (design parts 4.3 and 4.5). The offer rides in the question, so
// the decider sees it and confirms it; what they confirm must be what is enforced. This clamps the
// offer to what its decider has the authority to make, once at ask time (the clamped offer is what
// the question shows and stores) and again at answer time (so an edited decision cannot widen it).
//
// An area owner's precedent never reaches past their area: its scope is that area, its conditions
// name that area, and its rule bases lie inside the area's may_decide. Only the owner may make a
// project-wide precedent, or one the owner's questions can be resolved by.

import { safePaths } from '../precedent/glob.mjs';

/**
 * @typedef {Record<string, any>} Offer a decision's precedent_offer
 * @typedef {{ offer: Offer, decider: string } | { error: string }} Enforced
 */

/** The owner alone decides: the offer stands as written. @param {readonly string[]} deciders */
export const ownerOnly = (deciders) => deciders.length === 1 && deciders[0] === 'owner';

/**
 * Clamp an offer to what the deciders may make.
 * @param {Offer} offer
 * @param {{
 *   deciders: readonly string[],
 *   area?: string | null,
 *   basis?: string | null,
 *   policy: import('../policy/policy.mjs').Policy,
 * }} context
 *   area: the single area of the decision, or null/undefined when none or several.
 * @returns {Enforced}
 */
export function enforceOffer(offer, { deciders, area, basis, policy }) {
  /** @type {Offer} */
  const out = structuredClone(offer);
  const paths = safePaths(out.conditions?.paths ?? []);
  const bad = paths.errors[0];
  if (bad) return { error: `conditions.paths: ${bad}` };
  if (out.conditions?.paths) out.conditions.paths = paths.paths;
  for (const ex of out.exceptions ?? []) {
    const when = typeof ex === 'string' ? null : ex.when;
    const problem = safePaths(when?.paths ?? []).errors[0];
    if (problem) return { error: `exceptions: ${problem}` };
  }
  if (ownerOnly(deciders)) return { offer: out, decider: 'owner' };

  const nonOwner = deciders.filter((d) => d !== 'owner');
  if (!area || area === 'cross-area' || area === 'unassigned') {
    return {
      error:
        'an area owner may only generalize inside one area, and this question has none or several',
    };
  }
  const known = (policy.rights?.areas ?? []).find(
    (/** @type {{ name: string }} */ a) => a.name === area,
  );
  if (!known) return { error: `area ${area} is not in policy.rights.areas` };
  /** @type {string[]} */
  const may = known.may_decide ?? [];
  const asked = /** @type {string[]} */ (out.conditions?.rights_basis ?? (basis ? [basis] : []));
  const bases = asked.filter((b) => may.includes(b));
  if (bases.length === 0 || bases.length !== asked.length) {
    return {
      error: `the owners of ${area} may decide ${may.join(', ') || 'nothing'}, which does not cover ${asked.join(', ') || 'this question'}`,
    };
  }
  out.conditions = { ...out.conditions, areas: [area], rights_basis: bases };
  out.scope = `area:${area}`;
  return { offer: out, decider: nonOwner.join(', ') };
}

/**
 * The offer in words, built from the structured conditions, scope and rule and from nothing else,
 * so the decider reads exactly what they would approve. The summary is the asker's phrase and is
 * shown beside it, never instead of it.
 * @param {Offer} offer @param {string} decider @returns {string[]} lines
 */
export function describeOffer(offer, decider) {
  const c = offer.conditions ?? {};
  /** @type {string[]} */
  const applies = [];
  if (c.areas?.length) applies.push(`areas ${c.areas.join(', ')}`);
  if (c.item_kinds?.length) applies.push(`item kinds ${c.item_kinds.join(', ')}`);
  if (c.rights_basis?.length) applies.push(`rule bases ${c.rights_basis.join(', ')}`);
  if (c.paths?.length) applies.push(`paths ${c.paths.join(', ')}`);
  if (c.tags?.length) applies.push(`tags ${c.tags.join(', ')}`);
  if (c.text) applies.push(`and, in words: ${c.text}`);
  const except = (offer.exceptions ?? []).map((/** @type {any} */ e) =>
    typeof e === 'string'
      ? e
      : `${Object.entries(e.when)
          .map(([k, v]) => `${k} ${[v].flat().join(', ')}`)
          .join('; ')}${e.why ? ` (${e.why})` : ''}`,
  );
  return [
    `  If yes, this becomes a precedent: "${offer.rule}"`,
    `  It applies when: ${applies.length ? applies.join('; ') : 'nothing narrows it'}.`,
    ...(except.length ? [`  Except: ${except.join('; ')}.`] : []),
    `  Scope: ${offer.scope ?? 'project'}. Made by: ${decider || 'the decider'}.`,
  ];
}
