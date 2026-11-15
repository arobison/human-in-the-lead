// Milestones in the files backend (design part 3.2, Milestones and releases).
//
// A milestone is a setpoint: an outcome, "done when" clauses, constraints (`constraints`, each
// linked to a clause), contributions (`contributions`, with a value and a confidence), a share of
// its project's appetite, an optional external deadline and an independent check. There is one
// milestone kind, `milestone`. A learning milestone is one whose check is a study: derived, never
// stored. A milestone with no project is a long outcome; its constraints are other milestones. The front matter holds strings and lists of strings
// only (frontmatter.mjs), so each structured entry is one line of text in a fixed form:
//
//   done_when:     "c1: <text>"
//   constraints:   "<ID> c1"          a constraint linked to clause c1
//                  "<ID> c?"          a constraint still to be linked to a clause at shaping
//   contributions:        "<ID> value=<number above 0> confidence=<0 to 1>"
//                  value is in the project's value units (design part 2), as a project's is;
//                  1, 2, 3, 5, 8 and 13 are quick choices, not the only values
//   check:         "<demo|integration-test|study> <target>"
//   check_results: "<pass|fail|answered> <YYYY-MM-DD> <role>: <evidence>"
//   deadline:      "<YYYY-MM-DD> <source>"
//
// This module parses and writes those lines, and computes the derived fields: unmet_clauses, check_due,
// scope, tokens_spent, cost_of_delay_rate and to_shape for a milestone; constraint_of and
// contributes_to for an item. Derived fields are computed on every read and never written.

export const MILESTONE_KINDS = ['milestone'];
export const MILESTONE_STATES = ['proposed', 'planned', 'done', 'dropped'];
export const CHECK_KINDS = ['demo', 'integration-test', 'study'];
export const CHECK_RESULTS = ['pass', 'fail', 'answered'];
/** The clause marker of a constraint still to be linked at shaping. */
export const UNLINKED = 'c?';
/** The role that writes items; its runs of a check never count (design part 6.2). */
export const AUTHOR_ROLE = 'executor';

/** The milestone keys that hold one structured line each, and the lists of them. */
export const MILESTONE_LIST_KEYS = ['done_when', 'contributions', 'check_results'];

const ID = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;
const CLAUSE = /^c[1-9]\d*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * @typedef {{ id: string, text: string }} Clause
 * @typedef {{ id: string, clause: string | null }} Constraint
 * @typedef {{ id: string, value: number, confidence: number }} Contribution
 * @typedef {{ kind: string, target: string }} Check
 * @typedef {{ result: string, date: string, role: string, evidence: string }} CheckResult
 * @typedef {{ date: string, source: string }} Deadline
 * @typedef {{ error: string }} Bad
 */

/** @param {unknown} v @returns {v is Bad} */
export const isBad = (v) => typeof v === 'object' && v !== null && 'error' in v;

/** @param {string} s @returns {Clause | Bad} */
export function parseClause(s) {
  const m = /^(c[1-9]\d*):\s+(\S.*)$/.exec(String(s));
  return m ? { id: m[1], text: m[2].trim() } : { error: `"${s}" isn't "c<n>: <text>"` };
}

/** @param {string} s @returns {Constraint | Bad} */
export function parseConstraint(s) {
  const m = /^(\S+)\s+(\S+)$/.exec(String(s).trim());
  if (!m || !ID.test(m[1]) || !(CLAUSE.test(m[2]) || m[2] === UNLINKED)) {
    return { error: `"${s}" isn't "<ID> c<n>" or "<ID> ${UNLINKED}"` };
  }
  return { id: m[1], clause: m[2] === UNLINKED ? null : m[2] };
}

/** @param {string} s @returns {Contribution | Bad} */
export function parseContribution(s) {
  const m = /^(\S+)\s+value=(\S+)\s+confidence=(\S+)$/.exec(String(s).trim());
  if (!m || !ID.test(m[1])) {
    return { error: `"${s}" isn't "<ID> value=<number above 0> confidence=<0 to 1>"` };
  }
  const value = Number(m[2]);
  const confidence = Number(m[3]);
  if (!/^\d+(\.\d+)?$/.test(m[2]) || !(value > 0) || !Number.isFinite(value)) {
    return { error: `${m[1]}: value ${m[2]} isn't a number above 0` };
  }
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(m[3])) {
    return { error: `${m[1]}: confidence ${m[3]} isn't a number from 0 to 1` };
  }
  return { id: m[1], value, confidence };
}

/** @param {string} s @returns {Check | Bad} */
export function parseCheck(s) {
  const m = /^(\S+)\s+(\S.*)$/.exec(String(s).trim());
  if (!m || !CHECK_KINDS.includes(m[1])) {
    return { error: `check "${s}" isn't "<${CHECK_KINDS.join(' | ')}> <target>"` };
  }
  return { kind: m[1], target: m[2].trim() };
}

/** @param {string} s @returns {CheckResult | Bad} */
export function parseCheckResult(s) {
  const m = /^(\S+)\s+(\S+)\s+([^:\s]+):\s+(\S.*)$/.exec(String(s).trim());
  if (!m || !CHECK_RESULTS.includes(m[1]) || !DATE.test(m[2]) || !ROLE.test(m[3])) {
    return {
      error: `"${s}" isn't "<${CHECK_RESULTS.join(' | ')}> <YYYY-MM-DD> <role>: <evidence>"`,
    };
  }
  return { result: m[1], date: m[2], role: m[3], evidence: m[4].trim() };
}

/** @param {string} s @returns {Deadline | Bad} */
export function parseDeadline(s) {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\S.*)$/.exec(String(s).trim());
  return m
    ? { date: m[1], source: m[2].trim() }
    : { error: `deadline "${s}" isn't "<YYYY-MM-DD> <source>": an external date needs its source` };
}

/**
 * Words that put a milestone in a sequence when a number follows them ("phase 3", "stage 2").
 * A milestone is named by its outcome; order comes from the graph and cost of delay.
 */
const SEQUENCE_WORDS =
  'phase|stage|step|sprint|part|wave|iteration|increment|round|batch|milestone|release|version|mvp|level|tier|slice';

/**
 * The part of a milestone's name that numbers it, or null: a code such as M1, S2 or v2 (also v0.1),
 * a sequence word with a number (phase 3, stage 2), or a bare leading number (1. Setup, #3).
 * @param {unknown} title
 * @returns {string | null}
 */
export function numberedName(title) {
  const t = String(title ?? '');
  const patterns = [
    /(?<![\w.])[A-Za-z]{1,2}\d+(?:\.\d+)*(?![\w.])/,
    new RegExp(`\\b(?:${SEQUENCE_WORDS})\\s*#?\\d+\\b`, 'i'),
    /^\s*#?\d+(?:\.\d+)*[.):]?(?=\s|$)/,
  ];
  for (const p of patterns) {
    const m = p.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

/** @param {unknown} v @returns {string[]} */
const strings = (v) =>
  v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

/**
 * A milestone's stored keys, parsed. Entries that do not parse are left out and named in
 * `problems`.
 * @param {Record<string, unknown>} d stored keys
 */
export function readMilestone(d) {
  /** @type {string[]} */
  const problems = [];
  /** @template T @param {string} key @param {(s: string) => T | Bad} parse @returns {T[]} */
  const each = (key, parse) =>
    strings(d[key]).flatMap((s) => {
      const r = parse(s);
      if (isBad(r)) {
        problems.push(`${key}: ${r.error}`);
        return [];
      }
      return [/** @type {T} */ (r)];
    });
  /** @template T @param {string} key @param {(s: string) => T | Bad} parse @returns {T | undefined} */
  const one = (key, parse) => {
    if (d[key] === undefined || Array.isArray(d[key])) return undefined;
    const r = parse(String(d[key]));
    if (isBad(r)) {
      problems.push(r.error);
      return undefined;
    }
    return /** @type {T} */ (r);
  };
  const clauses = each('done_when', parseClause);
  const constraints = each('constraints', parseConstraint);
  const contributions = each('contributions', parseContribution);
  const check = one('check', parseCheck);
  const results = each('check_results', parseCheckResult);
  const deadline = one('deadline', parseDeadline);
  /** @type {number | undefined} */
  let appetite;
  if (d.appetite_tokens !== undefined) {
    if (/^\d+$/.test(String(d.appetite_tokens))) appetite = Number(d.appetite_tokens);
    else problems.push(`appetite_tokens "${d.appetite_tokens}" isn't a whole number of tokens`);
  }
  const ids = clauses.map((c) => c.id);
  for (const [i, id] of ids.entries()) {
    if (ids.indexOf(id) !== i) problems.push(`done_when: clause ${id} appears twice`);
  }
  for (const c of constraints) {
    if (c.clause !== null && !ids.includes(c.clause)) {
      problems.push(`constraints ${c.id} names clause ${c.clause}, which done_when doesn't have`);
    }
  }
  const seen = new Set();
  for (const c of constraints) {
    const k = `${c.id} ${c.clause}`;
    if (seen.has(k)) problems.push(`constraints ${c.id} ${c.clause ?? UNLINKED} appears twice`);
    seen.add(k);
  }
  const served = contributions.map((c) => c.id);
  for (const [i, id] of served.entries()) {
    if (served.indexOf(id) !== i) problems.push(`contributions ${id} appears twice`);
    if (constraints.some((c) => c.id === id)) {
      problems.push(`${id} is both a constraint and a contribution; it is one or the other`);
    }
  }
  return {
    outcome: d.outcome === undefined ? undefined : String(d.outcome),
    clauses,
    constraints,
    contributions,
    check,
    results,
    deadline,
    appetite,
    problems,
  };
}

/** @typedef {ReturnType<typeof readMilestone>} MilestoneData */

/** Every ID a milestone's constraints name, once each. @param {MilestoneData} m */
export const constraintIds = (m) => [...new Set(m.constraints.map((c) => c.id))];

/** @param {Clause} c */
export const formatClause = (c) => `${c.id}: ${c.text}`;
/** @param {Constraint} c */
export const formatConstraint = (c) => `${c.id} ${c.clause ?? UNLINKED}`;
/** @param {Contribution} c */
export const formatContribution = (c) => `${c.id} value=${c.value} confidence=${c.confidence}`;
/** @param {Check} c */
export const formatCheck = (c) => `${c.kind} ${c.target}`;
/** @param {CheckResult} r */
export const formatCheckResult = (r) => `${r.result} ${r.date} ${r.role}: ${r.evidence}`;
/** @param {Deadline} d */
export const formatDeadline = (d) => `${d.date} ${d.source}`;

/**
 * A milestone field's stored form, from the entity form (objects) or the stored form (text).
 * @param {string} key @param {unknown} v
 * @returns {unknown} the stored value, or the input when the key is not a structured one
 */
export function storedMilestoneField(key, v) {
  /** @template T @param {(x: T) => string} f */
  const many = (f) =>
    strings(Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? f(x) : x)) : v);
  if (v === null || v === undefined) return v;
  if (key === 'done_when') return many(formatClause);
  if (key === 'constraints' && Array.isArray(v) && v.some((x) => typeof x === 'object')) {
    return many(formatConstraint);
  }
  if (key === 'contributions') return many(formatContribution);
  if (key === 'check_results') return many(formatCheckResult);
  if (key === 'check' && typeof v === 'object') return formatCheck(/** @type {Check} */ (v));
  if (key === 'deadline' && typeof v === 'object') {
    return formatDeadline(/** @type {Deadline} */ (v));
  }
  if (key === 'appetite_tokens' && typeof v === 'number') return String(v);
  return v;
}

/**
 * The milestone's entity fields, as the read API returns them, from its stored keys.
 * @param {Record<string, unknown>} d
 */
export function milestoneFields(d) {
  const m = readMilestone(d);
  /** @type {Record<string, unknown>} */
  const e = {};
  if (m.outcome !== undefined) e.outcome = m.outcome;
  if (d.done_when !== undefined) e.done_when = m.clauses;
  if (d.constraints !== undefined) e.constraints = m.constraints;
  if (d.contributions !== undefined) e.contributions = m.contributions;
  if (m.appetite !== undefined) e.appetite_tokens = m.appetite;
  if (m.deadline) e.deadline = m.deadline;
  if (m.check) e.check = m.check;
  if (d.check_results !== undefined) e.check_results = m.results;
  return e;
}

/**
 * Whether a milestone is a learning milestone: its check is a study, so it is done when a question
 * is answered. Derived from the check, never stored.
 * @param {{ check?: Check }} m a read milestone
 */
export const isLearning = (m) => m.check?.kind === 'study';

/**
 * Whether the milestone's check has passed: its latest pass or fail is a pass; for a learning
 * milestone (its check is a study), its study is answered (has a verdict), whatever the answer. A
 * run by a role that wrote its items never counts.
 * @param {{ check?: Check, results: CheckResult[] }} m a read milestone
 * @param {Set<string>} authorRoles
 * @returns {CheckResult | null} the run that passed it
 */
export function passingCheck(m, authorRoles) {
  const independent = m.results.filter((r) => !authorRoles.has(r.role));
  if (isLearning(m)) return independent.find((r) => r.result === 'answered') ?? null;
  const last = independent.filter((r) => r.result === 'pass' || r.result === 'fail').at(-1);
  return last?.result === 'pass' ? last : null;
}

/**
 * @typedef {object} MilestoneDerived
 * @property {{ clause: string | null, text: string | null, open: string[], checked: boolean }[]} unmet_clauses
 *   the unmet clauses: each with its constraints not Done, and whether the check has passed;
 *   constraints still to be linked show under clause null
 * @property {boolean} check_due every constraint is Done and the check has not passed
 * @property {{ appetite_tokens: number | null, constraint_tokens: number, fits: string[], cut: string[], unsized: string[], too_big: boolean }} scope
 *   the contributions that fit the appetite, by value times confidence per estimate token, after
 *   the constraints' estimates
 * @property {number | null} tokens_spent from the ledger, over its constraints and contributions
 * @property {number | null} cost_of_delay_rate null until a rate is known for it
 * @property {string[]} to_shape what shaping still owes it: an outcome, clauses, a check, links
 */

/**
 * The derived fields of one milestone.
 * @param {Record<string, unknown>} d the milestone's stored keys
 * @param {object} context
 * @param {(id: string) => Record<string, unknown> | undefined} context.get stored keys by ID
 * @param {Set<string>} context.authorRoles roles that wrote its items
 * @param {Map<string, number>} [context.tokens] tokens spent per item, from the ledger
 * @param {Map<string, number>} [context.rates] cost-of-delay rates known per ID
 * @returns {MilestoneDerived}
 */
export function milestoneDerived(d, { get, authorRoles, tokens, rates }) {
  const m = readMilestone(d);
  const state = String(d.state);
  const closed = state === 'done' || state === 'dropped';
  const done = (/** @type {string} */ id) => get(id)?.state === 'done';
  const passed = passingCheck(m, authorRoles) !== null;
  /** @type {MilestoneDerived['unmet_clauses']} */
  const unmet = [];
  if (!closed) {
    for (const c of m.clauses) {
      const open = m.constraints.filter((x) => x.clause === c.id && !done(x.id)).map((x) => x.id);
      if (open.length || !passed) unmet.push({ clause: c.id, text: c.text, open, checked: passed });
    }
    const unlinked = m.constraints.filter((x) => x.clause === null && !done(x.id));
    if (unlinked.length) {
      unmet.push({ clause: null, text: null, open: unlinked.map((x) => x.id), checked: passed });
    }
  }
  const allDone = constraintIds(m).every(done);
  const estimate = (/** @type {string} */ id) => {
    const n = Number(get(id)?.estimate_tokens);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const constraintTokens = constraintIds(m).reduce((sum, id) => sum + (estimate(id) ?? 0), 0);
  const appetite = m.appetite ?? null;
  const live = m.contributions.filter((c) => get(c.id)?.state !== 'dropped');
  const unsized = live.filter((c) => estimate(c.id) === null).map((c) => c.id);
  const sized = live
    .filter((c) => estimate(c.id) !== null)
    .map((c) => ({
      id: c.id,
      cost: /** @type {number} */ (estimate(c.id)),
      worth: c.value * c.confidence,
    }))
    .sort((a, b) => b.worth / b.cost - a.worth / a.cost || a.id.localeCompare(b.id));
  /** @type {string[]} */
  const fits = [];
  /** @type {string[]} */
  const cut = [];
  let left = appetite === null ? Infinity : appetite - constraintTokens;
  for (const c of sized) {
    if (c.cost <= left) {
      fits.push(c.id);
      left -= c.cost;
    } else cut.push(c.id);
  }
  const counted = [...new Set([...constraintIds(m), ...m.contributions.map((c) => c.id)])];
  const tokensSpent = tokens ? counted.reduce((sum, id) => sum + (tokens.get(id) ?? 0), 0) : null;
  /** @type {string[]} */
  const toShape = [];
  if (!closed) {
    if (!m.outcome) toShape.push('outcome');
    if (!m.clauses.length) toShape.push('done_when');
    if (!m.check) toShape.push('check');
    const unlinked = m.constraints.filter((x) => x.clause === null).map((x) => x.id);
    if (unlinked.length) toShape.push(`link ${unlinked.join(', ')} to a clause`);
  }
  return {
    unmet_clauses: unmet,
    check_due: !closed && allDone && !passed,
    scope: {
      appetite_tokens: appetite,
      constraint_tokens: constraintTokens,
      fits,
      cut,
      unsized,
      too_big: appetite !== null && constraintTokens > appetite,
    },
    tokens_spent: tokensSpent,
    cost_of_delay_rate: rates?.get(String(d.id)) ?? null,
    to_shape: toShape,
  };
}

/**
 * Tokens spent per item, from ledger events: the sum of every event's tokens on the item.
 * @param {{ item?: unknown, tokens?: unknown }[]} events
 * @returns {Map<string, number>}
 */
export function tokensByItem(events) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const e of events) {
    if (typeof e.item !== 'string' || typeof e.tokens !== 'number') continue;
    out.set(e.item, (out.get(e.item) ?? 0) + e.tokens);
  }
  return out;
}
