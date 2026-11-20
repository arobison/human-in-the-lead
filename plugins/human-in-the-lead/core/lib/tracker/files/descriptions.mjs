// The description check (HITLD-75): mechanical problems in what an agent wrote into the tracker,
// reported as warnings by `hitld work check`, never as problems. The guide it enforces is the
// `describe` skill (skills/describe/SKILL.md), which says what each part of an item, project and
// milestone is for. The check is deterministic and reads text only; whether a description is
// good is graded against the skill's rubric by a model other than the writer (the eval category
// `description-quality`, core/lib/eval/description-fixtures.mjs).
//
// Only open entities are checked (proposed, planned, in progress): a done or dropped one is
// history, and rewording it helps no reader. Text inside code spans and fenced blocks is left
// out of the text rules, so a quoted setting such as `7 days` is not an estimate.
//
// Words the classification rules forbid (the private term list, design part 10.3) are already
// refused by the commit guard and by `hitld work check` over the whole tree, as problems. The
// check here applies them only when it is given the matchers (a draft outside the tree), and
// names the kind and line, never the term.

import { findTerms } from '../../guard/private-terms.mjs';

/** The rules, each with what it catches. */
export const RULES = Object.freeze({
  'missing-why': 'a work item with no Why, or an empty one',
  'missing-waiting-on': 'an external item with no Waiting on, or an empty one',
  'missing-done-when': 'a work item with no Done when, or an empty one',
  'unobservable-done-when':
    'a Done-when line, or a milestone clause, with nothing a reader could run, see or count',
  'missing-summary': 'a project with no Summary, or an empty one',
  'missing-outcome': 'a milestone with no outcome',
  'missing-clauses': 'a milestone with no done-when clauses',
  'missing-check': 'a milestone with no check',
  'time-estimate': 'a time estimate (hours, days, story points); size is in tokens, at sizing',
  'decision-history':
    'how a decision was reached (who said what, in which meeting); record the decision and its ID',
  'forbidden-word': 'a term from the private term list; refer to it by its role',
});

const OPEN = new Set(['proposed', 'planned', 'in-progress']);

/**
 * The body's `## ` sections, by lowercased heading, each with its text and the line its text
 * starts on (1-based, within the body).
 * @param {string} body @returns {Map<string, { text: string, line: number }>}
 */
export function sections(body) {
  /** @type {Map<string, { text: string, line: number }>} */
  const out = new Map();
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  /** @type {{ name: string, line: number, lines: string[] } | null} */
  let cur = null;
  const close = () => {
    if (cur && !out.has(cur.name))
      out.set(cur.name, { text: cur.lines.join('\n'), line: cur.line });
  };
  for (const [i, l] of lines.entries()) {
    const h = l.match(/^##\s+(.+?)\s*$/);
    if (h) {
      close();
      cur = { name: h[1].toLowerCase(), line: i + 2, lines: [] };
    } else if (cur) cur.lines.push(l);
  }
  close();
  return out;
}

/** Code spans and fenced blocks blanked out, line count kept. @param {string} text */
export function prose(text) {
  return text
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * The text with its HTML comments removed: each span from an opening marker to the next closing
 * one (or to the end), repeated until nothing changes, so a comment that removal leaves behind
 * ("<!<!-- x -->-- y -->") is removed too. Used only to tell an empty section from a filled one.
 * @param {string} text @returns {string}
 */
export function withoutComments(text) {
  let out = text;
  for (;;) {
    let next = '';
    let at = 0;
    for (;;) {
      const open = out.indexOf('<!--', at);
      if (open < 0) {
        next += out.slice(at);
        break;
      }
      next += out.slice(at, open);
      const close = out.indexOf('-->', open + 4);
      if (close < 0) break;
      at = close + 3;
    }
    if (next === out) return out;
    out = next;
  }
}

const DURATION = '(?:minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|sprints?)';
const AMOUNT =
  '(?:an?|one|two|three|four|five|six|a few|a couple of|half an?|\\d+(?:\\.\\d+)?(?:\\s*(?:-|to)\\s*\\d+(?:\\.\\d+)?)?)';
const ESTIMATES = [
  new RegExp(
    `\\b(?:takes?|taking|should take|will take|would take|expected to take|estimated(?: at)?|estimate(?: of)?|budget of)\\s+(?:about |around |roughly |approximately |under |over |at most |at least )?${AMOUNT}\\s*${DURATION}\\b`,
    'i',
  ),
  new RegExp(`~\\s*\\d+(?:\\.\\d+)?\\s*${DURATION}\\b`, 'i'),
  /\b(?:ETA|story points?|person-(?:hours?|days?|weeks?)|man-(?:hours?|days?)|t-shirt size)\b/,
  new RegExp(`\\b${AMOUNT}\\s*${DURATION}\\s+of (?:work|effort)\\b`, 'i'),
  /\bhalf[- ]a[- ]day\b/i,
];

const HISTORY = [
  /\bafter (?:some |much |a long |a lot of |the |our )?(?:discussion|debate|back[- ]and[- ]forth)\b/i,
  /\bwe (?:discussed|debated|talked (?:about|it over)|went back and forth|first thought|initially|originally)\b/i,
  /\b(?:was|were) (?:discussed|debated)\b/i,
  /\bas (?:we )?discussed\b/i,
  /\b(?:in|during|at) (?:the|a|our|today's|yesterday's) (?:meeting|call|standup|sync)\b/i,
  /\bon (?:the|a|our) call\b/i,
  /\b(?:initially|originally|at first),? (?:we|the owner|I)\b/i,
  /\bsomeone (?:suggested|proposed|said|asked)\b/i,
  /\bper (?:the|our) (?:discussion|conversation|chat|call|meeting)\b/i,
  /\bchanged (?:my|our|their) minds?\b/i,
];

// A Done-when line has nothing observable when it is vague (better, robust, properly) with no
// hard anchor, when it only says the work is done (implemented, handled, supported) with no hard
// anchor, or when it is under three words. A plain statement of a state ("A denial is never
// retried verbatim") is observable: a reader can look for it. The rule is kept narrow, since a
// warning that fires on good lines teaches people to ignore it.
const HARD_ANCHORS = [
  /`[^`]+`/, // a command, key or value
  /\b[\w.-]+\/[\w./*-]+/, // a path
  /\b\w[\w-]*\.(?:mjs|js|ts|json|md|py|sh|yml|yaml|txt|html|css)\b/, // a file
  /\b[A-Z][A-Z0-9]*-\d+\b/, // an ID
  /\d/, // a number
  /"[^"]+"|“[^”]+”/, // quoted words
];
const VAGUE =
  /\b(?:better|improved?|cleaner|nicer|robust|properly|correctly|as needed|where appropriate|user-friendly|intuitive|seamless(?:ly)?|etc\.?|and so on|TBD|works? well|good enough|polished|high[- ]quality)\b/i;
const OUTPUT_ONLY =
  /^(?:the |it |this |all |everything )?[\w\s'’-]{0,60}?\b(?:is|are|gets?|has been|have been|was|were)\s+(?:done|complete|completed|finished|implemented|handled|addressed|supported|fixed|working|in place|sorted(?: out)?|resolved|taken care of|delivered|shipped)\.?$/i;

/**
 * Whether a Done-when line, or a milestone clause, names something a reader could check.
 * @param {string} line @returns {boolean}
 */
export function observable(line) {
  const text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^c\d+:\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
  if (!text) return true;
  if (HARD_ANCHORS.some((re) => re.test(text))) return true;
  if (text.split(/\s+/).length < 3) return false;
  return !VAGUE.test(text) && !OUTPUT_ONLY.test(text);
}

/**
 * @typedef {{ rule: keyof typeof RULES, message: string, line?: number }} Finding
 *   line: within the body, 1-based, when the finding is on one
 */

/**
 * The description findings for one entity, open or not.
 * @param {{ data: Record<string, string | string[]>, body: string }} entity
 * @param {{ terms?: import('../../guard/private-terms.mjs').Matcher[] }} [o]
 * @returns {Finding[]}
 */
export function lintEntity({ data, body }, o = {}) {
  /** @type {Finding[]} */
  const found = [];
  const kind = String(data.kind ?? '');
  const parts = sections(body);
  const filled = (/** @type {string} */ name) => {
    const s = parts.get(name);
    return Boolean(s && withoutComments(s.text).trim());
  };
  /** @param {keyof typeof RULES} rule @param {string} message @param {number} [line] */
  const say = (rule, message, line) =>
    found.push(line === undefined ? { rule, message } : { rule, message, line });

  if (kind === 'work' && !filled('why')) {
    say('missing-why', 'no Why: say what the outcome is and who it serves');
  }
  if (kind === 'external' && !filled('waiting on') && !filled('why')) {
    say('missing-waiting-on', 'no Waiting on: say who does the work and what it is');
  }
  if (kind === 'work') {
    const dw = parts.get('done when');
    if (!filled('done when')) {
      say('missing-done-when', 'no Done when: write the exit condition as checks a reader can run');
    } else if (dw) {
      for (const [i, l] of dw.text.split('\n').entries()) {
        if (!/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(l)) continue;
        if (!observable(l)) {
          say(
            'unobservable-done-when',
            'a Done-when line with nothing to run, see or count: name the command, file, state or number that shows it',
            dw.line + i,
          );
        }
      }
    }
  }
  if (kind === 'project' && !filled('summary')) {
    say('missing-summary', 'no Summary: say the problem, in the user’s terms, and the outcome');
  }
  if (kind === 'milestone') {
    if (!String(data.outcome ?? '').trim()) {
      say('missing-outcome', 'no outcome: one sentence, the state for users');
    }
    const clauses = Array.isArray(data.done_when)
      ? data.done_when
      : data.done_when
        ? [data.done_when]
        : [];
    if (!clauses.length) say('missing-clauses', 'no done-when clauses');
    for (const c of clauses) {
      if (!observable(c)) {
        const id = c.match(/^(c\d+):/)?.[1];
        say(
          'unobservable-done-when',
          `clause ${id ?? '(no ID)'} has nothing to run, see or count: state it as an outcome a check can observe`,
        );
      }
    }
    if (!String(data.check ?? '').trim()) {
      say('missing-check', 'no check: demo, integration-test or study, and what it runs');
    }
  }

  const title = String(data.title ?? '');
  const text = prose(body);
  const outcome = String(data.outcome ?? '');
  const lines = text.split('\n');
  /** @param {RegExp[]} res @param {keyof typeof RULES} rule @param {string} message */
  const scan = (res, rule, message) => {
    for (const field of [title, outcome]) {
      if (field && res.some((re) => re.test(prose(field)))) {
        say(rule, message);
        return;
      }
    }
    for (const [i, l] of lines.entries()) {
      if (res.some((re) => re.test(l))) {
        say(rule, message, i + 1);
        return;
      }
    }
  };
  scan(
    ESTIMATES,
    'time-estimate',
    'a time estimate: leave size to sizing, which sets estimate_tokens',
  );
  if (kind !== 'decision') {
    scan(
      HISTORY,
      'decision-history',
      'how a decision was reached: state what was decided and cite the decision item',
    );
  }
  if (o.terms?.length) {
    for (const m of findTerms(`${title}\n${body}`, o.terms, { limit: 5 })) {
      say(
        'forbidden-word',
        `holds a private ${m.kind} from the private term list; refer to it by its role`,
        m.line > 1 ? m.line - 1 : undefined,
      );
    }
  }
  return found;
}

/**
 * Warnings for the open entities' descriptions, one line each:
 * "<path>: <ID> description (<rule>): <message>[, body line <n>]".
 * @param {import('./tree.mjs').Entry[]} items
 * @param {{ terms?: import('../../guard/private-terms.mjs').Matcher[] }} [o]
 * @returns {string[]}
 */
export function descriptionWarnings(items, o = {}) {
  /** @type {string[]} */
  const out = [];
  for (const it of items) {
    if (!it.data || !OPEN.has(String(it.data.state))) continue;
    for (const f of lintEntity({ data: it.data, body: it.body }, o)) {
      out.push(
        `${it.path}: ${it.data.id} description (${f.rule}): ${f.message}${f.line ? `, body line ${f.line}` : ''}`,
      );
    }
  }
  return out;
}
