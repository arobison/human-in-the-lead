// Migration "constraints-on-items" (HITLD-767; decided by the owner in HITLD-784 and HITLD-785).
//
// A milestone's constraints were one `constraints` line in its own front matter, so two pull
// requests that each filed an item into the same milestone both edited that line and conflicted.
// The link now lives on the item, as `constraint_of: [<milestone ID> c<n>]`, and a milestone's
// constraints are derived from its items (graph.mjs). This step, for each milestone in ID order:
//
//   - adds each entry of its `constraints` line to the named item's (or milestone's)
//     `constraint_of`, unless that list already names the milestone: the item side wins, as it
//     does when both forms are read;
//   - removes the `constraints` line, editing only that line, or keeps only the entries it could
//     not move (one naming no item or milestone), which the check names.
//
// The derived constraints of every milestone are the same before and after. Running it again
// changes nothing. Notes about why an item joined stay where they are; new ones go on the item.

import { keyOrder } from '../format.mjs';
import { ITEM_KINDS, list } from '../graph.mjs';
import { idNumber } from '../tree.mjs';
import {
  MILESTONE_KINDS,
  formatConstraint,
  formatConstraintLink,
  isBad,
  parseConstraintLink,
  readMilestone,
} from '../milestones.mjs';
import { dropKey } from './milestone-entities.mjs';

/**
 * @typedef {import('../migrate.mjs').MigrationTree} MigrationTree
 * @typedef {import('../tree.mjs').Entry} Entry
 */

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Set a list key's line in the front matter, as an inline list, keeping every other line. A key
 * that is not there yet goes before the first key that follows it in `order`, else last.
 * @param {string} text @param {string} key @param {string[]} values @param {string[]} order
 */
export function setListLine(text, key, values, order) {
  const m = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return text;
  const line = `${key}: [${values.join(', ')}]`;
  const lines = m[1].split('\n');
  const own = new RegExp(`^${escapeRegExp(key)}:(\\s|$)`);
  const at = lines.findIndex((l) => own.test(l));
  if (at >= 0) {
    let end = at + 1;
    while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
    lines.splice(at, end - at, line);
  } else {
    const later = new Set(order.slice(order.indexOf(key) + 1));
    const before = order.includes(key)
      ? lines.findIndex((l) => later.has(/^([A-Za-z_][\w-]*):/.exec(l)?.[1] ?? ''))
      : -1;
    if (before >= 0) lines.splice(before, 0, line);
    else lines.push(line);
  }
  return `---\n${lines.join('\n')}\n---${m[2]}${text.slice(m[0].length)}`;
}

/** @type {import('../migrate.mjs').Migration} */
export const constraintsOnItems = {
  name: 'constraints-on-items',
  summary:
    "move each milestone's constraints line into its items, as constraint_of: the milestone's constraints are derived from them",
  // Both forms are read until rc.3, so a tracker not yet migrated is warned about, not refused.
  warns: true,
  plan(tree) {
    const { layout, entries, files } = tree;
    /** @type {Map<string, string>} path to new text */
    const changed = new Map();
    const text = (/** @type {Entry} */ e) => changed.get(e.path) ?? String(files.get(e.path));
    const byId = new Map(entries.filter((e) => e.data?.id).map((e) => [String(e.data?.id), e]));
    /** @type {Map<string, string[]>} an entry's constraint_of as it is being built, by ID */
    const links = new Map();
    const linksOf = (/** @type {Entry} */ e) => {
      const id = String(e.data?.id);
      if (!links.has(id)) links.set(id, list(e.data?.constraint_of).map(String));
      return /** @type {string[]} */ (links.get(id));
    };
    const names = (/** @type {string[]} */ ls, /** @type {string} */ milestone) =>
      ls.some((s) => {
        const l = parseConstraintLink(s);
        return !isBad(l) && l.milestone === milestone;
      });
    const milestones = entries
      .filter((e) => e.data && MILESTONE_KINDS.includes(String(e.data.kind)))
      .filter((e) => Object.hasOwn(/** @type {object} */ (e.data), 'constraints'))
      .sort((a, b) => idNumber(String(a.data?.id)) - idNumber(String(b.data?.id)));
    /** @type {Set<Entry>} */
    const touched = new Set();
    for (const m of milestones) {
      const id = String(m.data?.id);
      // The entries as stored before this step, for the item side to win against.
      /** @type {Map<string, boolean>} */
      const hadLink = new Map();
      /** @type {string[]} */
      const kept = [];
      for (const c of readMilestone(/** @type {Record<string, unknown>} */ (m.data)).constraints) {
        const target = byId.get(c.id);
        const kind = String(target?.data?.kind);
        if (!target || !(ITEM_KINDS.includes(kind) || MILESTONE_KINDS.includes(kind))) {
          kept.push(formatConstraint(c));
          continue;
        }
        if (!hadLink.has(c.id))
          hadLink.set(c.id, names(list(target.data?.constraint_of).map(String), id));
        if (hadLink.get(c.id)) continue;
        const ls = linksOf(target);
        const entry = formatConstraintLink({ milestone: id, clause: c.clause });
        if (!ls.includes(entry)) ls.push(entry);
        touched.add(target);
      }
      // Entries that do not parse stay too: the check names them, and nothing is lost.
      const raw = list(m.data?.constraints).map(String);
      const unparsed = raw.filter((s) => {
        const parsed = parseConstraintLink(s);
        return isBad(parsed);
      });
      const rest = [...kept, ...unparsed];
      const next = rest.length
        ? setListLine(text(m), 'constraints', rest, keyOrder('milestone', layout))
        : dropKey(text(m), 'constraints');
      if (next !== text(m)) changed.set(m.path, next);
    }
    for (const e of touched) {
      const kind = String(e.data?.kind);
      const next = setListLine(text(e), 'constraint_of', linksOf(e), keyOrder(kind, layout));
      if (next !== text(e)) changed.set(e.path, next);
    }
    return [...changed].map(([path, t]) => ({ path, text: t }));
  },
};
