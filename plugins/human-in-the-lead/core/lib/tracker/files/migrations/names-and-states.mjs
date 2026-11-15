// Migration "names-and-states" (HITLD-82: consistent names and one state taxonomy).
//
// The stored lifecycle key is `state`, with lowercase kebab-case values, and the other stored
// keys take the model's names:
//
//   status: Planned          → state: planned   (Proposed, Planned, In progress, Done, Dropped →
//                                                 proposed, planned, in-progress, done, dropped)
//   claimed                  → claimed_by
//   decided-by               → decider
//   lead                     → owner            (projects and initiatives)
//   party                    → waiting_on       (external items)
//   tier_hint                → tier_override    (an optional key)
//   changelog                → release_note     (an optional key)
//   needs (on a milestone)   → constraints      (an item's needs keeps its name)
//   check_results "verdict"  → "answered"       (a learning milestone's study answered)
//
// Only a work item is ever in-progress, by its claim: a decision, external item, milestone,
// project or initiative stored `In progress` becomes planned, and a claim key on anything but a
// work item is removed. Each change edits only its own lines, so the rest of each file is
// unchanged and the commit can be reviewed line by line.

import { renderItem } from '../frontmatter.mjs';
import {
  LEGACY_MILESTONE_KINDS,
  LEGACY_STATES,
  legacyCheckResult,
  renamesFor,
} from '../legacy.mjs';
import { list } from '../graph.mjs';
import { MILESTONE_KINDS } from '../milestones.mjs';

/** The milestone kinds this step meets: the ones before HITLD-90, and the current one. */
const ANY_MILESTONE_KIND = [...LEGACY_MILESTONE_KINDS, ...MILESTONE_KINDS];

/**
 * @typedef {import('../migrate.mjs').FileChange} FileChange
 * @typedef {{ key: string, start: number, end: number }} KeyLines a key's line and its block list
 */

/**
 * The front matter's lines and, per key, where its lines are.
 * @param {string} text
 */
function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return null;
  const lines = m[1].split('\n');
  /** @type {KeyLines[]} */
  const keys = [];
  for (const [i, line] of lines.entries()) {
    const kv = line.match(/^([A-Za-z_][\w-]*):(\s|$)/);
    if (kv) keys.push({ key: kv[1], start: i, end: i + 1 });
    else if (/^\s+-\s/.test(line) && keys.length) keys[keys.length - 1].end = i + 1;
  }
  return { lines, keys, rest: `---${m[2]}${text.slice(m[0].length)}` };
}

/** One key's lines as renderItem writes them. @param {string} key @param {unknown} value */
const rendered = (key, value) =>
  renderItem({ [key]: value }, [key])
    .split('\n')
    .filter((l) => l !== '---' && l !== '');

/**
 * The file in the new names, or the same text when it is already in them.
 * @param {string} text @param {Record<string, unknown>} data the parsed front matter
 */
export function migrateText(text, data) {
  const fm = frontMatter(text);
  if (!fm) return text;
  const kind = String(data.kind ?? '');
  const renames = renamesFor(kind);
  /** @type {(string[] | null)[]} replacement lines per key entry; null keeps the lines */
  const out = fm.keys.map(() => /** @type {string[] | null} */ (null));
  const has = (/** @type {string} */ k) => Object.hasOwn(data, k);
  for (const [i, { key, start, end }] of fm.keys.entries()) {
    const to = renames[key] ?? key;
    const value = data[key];
    if (to !== key && has(to)) {
      out[i] = []; // both names: the new one is kept
      continue;
    }
    if ((to === 'claimed_by' || key === 'claimed_by') && kind !== 'work') {
      out[i] = []; // only a work item is claimed
      continue;
    }
    if (to === 'state') {
      let state = typeof value === 'string' ? (LEGACY_STATES[value] ?? value) : value;
      if (state === 'in-progress' && kind !== 'work') state = 'planned';
      if (to !== key || state !== value) out[i] = rendered('state', state);
      continue;
    }
    if (to === 'check_results' && ANY_MILESTONE_KIND.includes(kind)) {
      const lines = list(value).map(legacyCheckResult);
      if (lines.some((l, n) => l !== list(value)[n])) {
        out[i] = rendered('check_results', lines);
        continue;
      }
    }
    if (to !== key) {
      out[i] = fm.lines
        .slice(start, end)
        .map((l, n) => (n === 0 ? `${to}${l.slice(key.length)}` : l));
    }
  }
  if (out.every((o) => o === null)) return text;
  /** @type {string[]} */
  const lines = [];
  let at = 0;
  for (const [i, { start, end }] of fm.keys.entries()) {
    lines.push(...fm.lines.slice(at, start));
    lines.push(...(out[i] ?? fm.lines.slice(start, end)));
    at = end;
  }
  lines.push(...fm.lines.slice(at));
  return `---\n${lines.join('\n')}\n${fm.rest}`;
}

/** @type {import('../migrate.mjs').Migration} */
export const namesAndStates = {
  name: 'names-and-states',
  summary:
    'store the lifecycle as state with lowercase kebab-case values, and rename claimed, decided-by, lead, party, tier_hint, changelog, the needs of a milestone and the check result verdict (HITLD-82)',
  plan: ({ entries, files }) =>
    entries.flatMap((e) => {
      if (!e.data) return [];
      const text = /** @type {string} */ (files.get(e.path));
      const next = migrateText(text, e.data);
      return next === text ? [] : [{ path: e.path, text: next }];
    }),
};
