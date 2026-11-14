// Matching a question against precedents by structured conditions (design part 4.3, Applying a
// precedent). Step 1 is a script, so it costs few tokens: it narrows the precedents to those whose
// structured conditions the question meets. Step 2, whether the plain-language conditions and
// exceptions fit, is a judgement the agent holding the question makes; the script only says which
// candidates need it.

import { matchesAny } from './glob.mjs';

/**
 * @typedef {Record<string, any>} Precedent a precedent as in schemas/precedent.schema.json
 *
 * @typedef {object} Facts a question's structured attributes, the same shape as a precedent's conditions
 * @property {string[]} [areas]
 * @property {string[]} [item_kinds] the kind of the item the question is about, one entry
 * @property {string[]} [rights_basis] every rule basis that holds for the question
 * @property {string[]} [paths]
 * @property {string[]} [tags]
 *
 * @typedef {object} Candidate
 * @property {string} id
 * @property {Precedent} precedent
 * @property {boolean} needs_judgement plain-language conditions or exceptions remain
 * @property {string[]} judge what the judgement must settle
 *
 * @typedef {object} MatchResult
 * @property {Candidate[]} candidates
 * @property {{ id: string, reason: string }[]} excluded
 * @property {string | null} blocked a rule basis no precedent may resolve, when one holds
 */

/** @param {readonly string[]} a @param {readonly string[]} b whether a is inside b */
const subset = (a, b) => a.every((x) => b.includes(x));

/**
 * Whether a question's facts meet a set of structured conditions (a precedent's conditions, or an
 * exception's "when"). Every condition present must hold. A missing fact fails its condition.
 * @param {Record<string, any>} cond @param {Facts} facts
 * @returns {{ ok: boolean, reason: string }}
 */
export function meets(cond, facts) {
  const q = {
    areas: facts.areas ?? [],
    kinds: facts.item_kinds ?? [],
    bases: facts.rights_basis ?? [],
    paths: facts.paths ?? [],
    tags: facts.tags ?? [],
  };
  if (cond.areas && !(q.areas.length > 0 && subset(q.areas, cond.areas))) {
    return {
      ok: false,
      reason: `areas ${q.areas.join(', ') || '(none)'} are not within ${cond.areas.join(', ')}`,
    };
  }
  if (cond.item_kinds && !(q.kinds.length > 0 && subset(q.kinds, cond.item_kinds))) {
    return {
      ok: false,
      reason: `item kind ${q.kinds.join(', ') || '(none)'} is not ${cond.item_kinds.join(' or ')}`,
    };
  }
  if (cond.rights_basis && !(q.bases.length > 0 && subset(q.bases, cond.rights_basis))) {
    return {
      ok: false,
      reason: `rule bases ${q.bases.join(', ') || '(none)'} are not all within ${cond.rights_basis.join(', ')}`,
    };
  }
  if (cond.paths) {
    const outside = q.paths.filter((/** @type {string} */ p) => !matchesAny(cond.paths, p));
    if (q.paths.length === 0 || outside.length) {
      return {
        ok: false,
        reason: `paths ${(outside.length ? outside : q.paths).join(', ') || '(none)'} are not covered`,
      };
    }
  }
  if (cond.tags && !subset(cond.tags, q.tags)) {
    return {
      ok: false,
      reason: `the question lacks tags ${cond.tags.filter((/** @type {string} */ t) => !q.tags.includes(t)).join(', ')}`,
    };
  }
  return { ok: true, reason: '' };
}

/** @param {string | undefined} text @returns {string[]} */
const decidersOf = (text) =>
  (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Whether a precedent's decider had authority over the new question: a precedent resolves a
 * question only if the person who made it could have decided that question. A question routed to
 * the owner needs a precedent the owner made; an area owner's precedent resolves only questions
 * routed to area owners it covers (design parts 4.3 and 4.5). Null when it has, else why not.
 * @param {Precedent} p @param {import('../rights/route.mjs').Route} route @returns {string | null}
 */
export function authorityProblem(p, route) {
  const by = decidersOf(p.decider);
  if (by.length === 0) return 'it records no decider';
  if (by.includes('owner')) return null;
  if (route.deciders.includes('owner')) {
    return "the question is the owner's, and this precedent was not made by the owner";
  }
  const missing = route.deciders.filter((d) => !by.includes(d));
  return missing.length ? `it was made by ${by.join(', ')}, not ${missing.join(', ')}` : null;
}

/**
 * Which precedents might resolve a question.
 * @param {Facts} facts the question's structured attributes
 * @param {readonly Precedent[]} precedents
 * @param {{ policy?: import('../policy/policy.mjs').Policy, route: import('../rights/route.mjs').Route }} options
 *   route: who the question goes to; a precedent made by someone with less authority is excluded.
 * @returns {MatchResult}
 */
export function matchPrecedents(facts, precedents, options) {
  /** @type {MatchResult} */
  const result = { candidates: [], excluded: [], blocked: null };
  const never = options.policy?.precedent?.not_for_bases ?? [];
  const blocked = (facts.rights_basis ?? []).find((b) => never.includes(b));
  if (blocked) {
    result.blocked = blocked;
    for (const p of precedents) {
      result.excluded.push({ id: p.id, reason: `a precedent never resolves ${blocked}` });
    }
    return result;
  }

  for (const p of precedents) {
    /** @param {string} reason */
    const out = (reason) => result.excluded.push({ id: p.id, reason });
    if (p.state === 'retired') {
      out('retired');
      continue;
    }
    const lacking = authorityProblem(p, options.route);
    if (lacking) {
      out(lacking);
      continue;
    }
    const scoped = /^area:(.+)$/.exec(p.scope ?? '');
    if (scoped && !((facts.areas ?? []).length > 0 && subset(facts.areas ?? [], [scoped[1]]))) {
      out(`scoped to area ${scoped[1]}`);
      continue;
    }
    const { text, ...structured } = p.conditions ?? {};
    const fit = meets(structured, facts);
    if (!fit.ok) {
      out(fit.reason);
      continue;
    }
    /** @type {string[]} */
    const judge = [];
    if (text) judge.push(`condition: ${text}`);
    let excepted = false;
    for (const [i, ex] of (p.exceptions ?? []).entries()) {
      if (typeof ex === 'string') {
        judge.push(`exception: ${ex}`);
        continue;
      }
      const { text: exText, ...when } = ex.when;
      if (meets(when, facts).ok) {
        if (exText) judge.push(`exception: ${exText}`);
        else {
          out(`exception ${i + 1} applies${ex.why ? `: ${ex.why}` : ''}`);
          excepted = true;
          break;
        }
      }
    }
    if (excepted) continue;
    result.candidates.push({
      id: p.id,
      precedent: p,
      needs_judgement: judge.length > 0,
      judge,
    });
  }
  return result;
}

/**
 * Decide whether the candidates resolve the question. One precedent resolves it when it is the
 * only candidate left and either needs no judgement or has been judged to fit. Any other case,
 * several candidates or an uncertain fit, goes to the decider with the candidates cited
 * (design part 4.3).
 * @param {Candidate[]} candidates
 * @param {Record<string, boolean>} [judged] the agent's judgement per precedent ID: does the plain-language fit hold?
 * @returns {{ resolved: Candidate | null, remaining: Candidate[], undecided: Candidate[] }}
 */
export function resolveByPrecedent(candidates, judged = {}) {
  const remaining = candidates.filter((c) => judged[c.id] !== false);
  const undecided = remaining.filter((c) => c.needs_judgement && judged[c.id] !== true);
  const resolved = remaining.length === 1 && undecided.length === 0 ? remaining[0] : null;
  return { resolved, remaining, undecided };
}
