// Projects in the files backend (design part 3.2, Project; part 2.3, shaping).
//
// A project being shaped is a proposed project: it carries the shaping fields, and the owner's bet
// moves it to planned. The bet is a decision item, named in `decision`; who made it (`bet_by`) is
// derived from that decision, never stored. A rejected project is dropped with a reason. The
// project holds the appetite; its milestones hold shares of it.
//
// The front matter holds strings and lists of strings only (frontmatter.mjs), so the structured
// fields are lines of text in a fixed form, and the read API returns them typed:
//
//   options:        "<label>: <trade-offs>"            one line per option, "do nothing" among them
//   value:          "<number>"                          in the project's value units
//   confidence:     "<0 to 1>"
//   cost_of_delay:  "<standard|urgent|fixed-date|intangible>[ rate=<number>][ date=<YYYY-MM-DD>]"
//   appetite_tokens: "<whole number>"
//
// `problem` is one line of text; `evidence`, `out_of_scope` and `risks` are lists of text;
// `signals` is a list of signal IDs; `decision` is the ID of the decision item that bet on it.

export const COST_OF_DELAY_PROFILES = ['standard', 'urgent', 'fixed-date', 'intangible'];

/** The shaping keys a project stores, in the order a file is written. */
export const SHAPING_KEYS = [
  'problem',
  'signals',
  'evidence',
  'options',
  'value',
  'confidence',
  'cost_of_delay',
  'appetite_tokens',
  'out_of_scope',
  'risks',
  'decision',
];

/** The shaping keys that hold a list. */
export const SHAPING_LIST_KEYS = ['signals', 'evidence', 'options', 'out_of_scope', 'risks'];

const SIGNAL = /^SIG-[1-9]\d*$/;
const ID = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d+(\.\d+)?$/;

/**
 * @typedef {{ label: string, tradeoffs: string }} Option
 * @typedef {{ profile: string, rate?: number, date?: string }} CostOfDelay
 * @typedef {{ error: string }} Bad
 */

/** @param {string} s @returns {Option | Bad} */
export function parseOption(s) {
  const m = /^([^:]+):\s+(\S.*)$/.exec(String(s).trim());
  return m
    ? { label: m[1].trim(), tradeoffs: m[2].trim() }
    : { error: `option "${s}" isn't "<label>: <trade-offs>"` };
}

/** @param {string} s @returns {CostOfDelay | Bad} */
export function parseCostOfDelay(s) {
  const words = String(s).trim().split(/\s+/);
  const bad = {
    error: `cost_of_delay "${s}" isn't "<${COST_OF_DELAY_PROFILES.join(' | ')}>[ rate=<number>][ date=<YYYY-MM-DD>]"`,
  };
  if (!COST_OF_DELAY_PROFILES.includes(words[0])) return bad;
  /** @type {CostOfDelay} */
  const out = { profile: words[0] };
  for (const w of words.slice(1)) {
    const m = /^(rate|date)=(.+)$/.exec(w);
    if (!m || Object.hasOwn(out, m[1])) return bad;
    if (m[1] === 'rate') {
      if (!NUMBER.test(m[2])) return bad;
      out.rate = Number(m[2]);
    } else {
      if (!DATE.test(m[2])) return bad;
      out.date = m[2];
    }
  }
  if (out.profile === 'fixed-date' && !out.date) {
    return { error: `cost_of_delay "${s}": a fixed-date profile needs its date (date=YYYY-MM-DD)` };
  }
  return out;
}

/** @param {unknown} v @returns {string[]} */
const strings = (v) =>
  v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

/**
 * A project's stored keys, parsed. Entries that do not parse are left out and named in `problems`.
 * @param {Record<string, unknown>} d stored keys
 */
export function readProject(d) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Option[]} */
  const options = [];
  for (const s of strings(d.options)) {
    const r = parseOption(s);
    if ('error' in r) problems.push(r.error);
    else options.push(r);
  }
  /** @type {CostOfDelay | undefined} */
  let costOfDelay;
  if (d.cost_of_delay !== undefined && !Array.isArray(d.cost_of_delay)) {
    const r = parseCostOfDelay(String(d.cost_of_delay));
    if ('error' in r) problems.push(r.error);
    else costOfDelay = r;
  }
  /** @param {string} key @param {(n: number) => boolean} ok @param {string} want */
  const number = (key, ok, want) => {
    if (d[key] === undefined || Array.isArray(d[key])) return undefined;
    const text = String(d[key]);
    if (NUMBER.test(text) && ok(Number(text))) return Number(text);
    problems.push(`${key} "${text}" isn't ${want}`);
    return undefined;
  };
  const value = number('value', (n) => n > 0, 'a number above 0');
  const confidence = number('confidence', (n) => n <= 1, 'a number from 0 to 1');
  const appetite = number('appetite_tokens', Number.isInteger, 'a whole number of tokens');
  const signals = strings(d.signals);
  for (const s of signals) if (!SIGNAL.test(s)) problems.push(`signals "${s}" isn't SIG-<n>`);
  if (d.decision !== undefined && !ID.test(String(d.decision))) {
    problems.push(`decision "${d.decision}" isn't an ID`);
  }
  return { options, costOfDelay, value, confidence, appetite, signals, problems };
}

/**
 * The project's shaping fields as the read API returns them, from its stored keys.
 * @param {Record<string, unknown>} d
 */
export function projectFields(d) {
  const p = readProject(d);
  /** @type {Record<string, unknown>} */
  const e = {};
  if (d.problem !== undefined) e.problem = d.problem;
  if (d.signals !== undefined) e.signals = p.signals;
  for (const k of ['evidence', 'out_of_scope', 'risks']) if (d[k] !== undefined) e[k] = d[k];
  if (d.options !== undefined) e.options = p.options;
  if (p.value !== undefined) e.value = p.value;
  if (p.confidence !== undefined) e.confidence = p.confidence;
  if (p.costOfDelay) e.cost_of_delay = p.costOfDelay;
  if (p.appetite !== undefined) e.appetite_tokens = p.appetite;
  if (d.decision !== undefined) e.decision = d.decision;
  return e;
}

/**
 * A project field's stored form, from the entity form (objects, numbers) or the stored form (text).
 * @param {string} key @param {unknown} v
 * @returns {unknown} the stored value, or the input when the key is not a structured one
 */
export function storedProjectField(key, v) {
  if (v === null || v === undefined) return v;
  if (key === 'options' && Array.isArray(v)) {
    return v.map((o) =>
      typeof o === 'object' && o !== null
        ? `${/** @type {Option} */ (o).label}: ${/** @type {Option} */ (o).tradeoffs}`
        : String(o),
    );
  }
  if (key === 'cost_of_delay' && typeof v === 'object' && !Array.isArray(v)) {
    const c = /** @type {CostOfDelay} */ (v);
    return [
      c.profile,
      ...(c.rate === undefined ? [] : [`rate=${c.rate}`]),
      ...(c.date === undefined ? [] : [`date=${c.date}`]),
    ].join(' ');
  }
  if (['value', 'confidence', 'appetite_tokens'].includes(key) && typeof v === 'number') {
    return String(v);
  }
  return v;
}

/**
 * Who made the bet that committed a project: the person who answered its decision, once that is
 * answered. Derived, never stored.
 * @param {Record<string, unknown>} d the project's stored keys
 * @param {(id: string) => Record<string, unknown> | undefined} get stored keys by ID
 * @returns {string | null}
 */
export function betBy(d, get) {
  if (d.decision === undefined) return null;
  const decision = get(String(d.decision));
  if (decision?.kind !== 'decision' || decision.state !== 'done') return null;
  return typeof decision.answered_by === 'string'
    ? decision.answered_by
    : typeof decision.decider === 'string'
      ? decision.decider
      : null;
}
