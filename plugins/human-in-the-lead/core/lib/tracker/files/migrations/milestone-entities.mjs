// Migration "milestone-entities" (design part 3.2, Milestones and releases; part 3.4).
//
// The format as built named milestones twice: a project's `milestones` list of names, and an
// item's `milestone` key naming one of them. A milestone is now its own file in the milestones
// folder, with its own ID in the shared number space. For each project, in ID order, this step:
//
//   - makes one milestone file per name (the project's list first, then any name an item uses
//     that the list lacks), unless a milestone under that project already has the name's title;
//   - lists the items that named it as its constraints, each marked `c?`: shaping links each one
//     to a done-when clause, and gives the milestone its outcome, clauses and check;
//   - removes `milestones` from the project and `milestone` from each item, editing only those
//     lines so the rest of each file is unchanged.
//
// A new milestone is a capability, Planned (Proposed or Dropped with its project), with the
// project's `created` date, and carries in its notes any list line of the project's body that
// starts with the name in bold, for shaping to work from. Numbers are allocated above every ID in
// the tracker and every number `taken` elsewhere in the clone, within the base range.

import { renderItem, slugify } from '../frontmatter.mjs';
import { idNumber } from '../tree.mjs';
import { keyOrder } from '../format.mjs';
import { list } from '../graph.mjs';
import { UNLINKED } from '../milestones.mjs';

/**
 * @typedef {import('../migrate.mjs').MigrationTree} MigrationTree
 * @typedef {import('../migrate.mjs').FileChange} FileChange
 */

/**
 * Remove a key's line, and the block-list lines under it, from a file's front matter.
 * @param {string} text @param {string} key
 */
export function dropKey(text, key) {
  const m = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return text;
  const lines = m[1].split('\n');
  /** @type {string[]} */
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    if (dropping && /^\s+-\s/.test(line)) continue;
    dropping = new RegExp(`^${key}:(\\s|$)`).test(line);
    if (!dropping) kept.push(line);
  }
  return `---\n${kept.join('\n')}\n---${m[2]}${text.slice(m[0].length)}`;
}

/** "safe-to-publish" → "Safe to publish". @param {string} name */
export const titleOf = (name) => {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {import('../migrate.mjs').Migration} */
export const milestoneEntities = {
  name: 'milestone-entities',
  summary:
    "turn each project's named milestones and each item's milestone key into milestone files, with those items as constraints to link to clauses at shaping",
  plan(tree) {
    const { layout, entries, files } = tree;
    /** @type {Map<string, string>} path to new text */
    const changed = new Map();
    const byId = new Map(entries.filter((e) => e.data?.id).map((e) => [String(e.data?.id), e]));
    const inRange = (/** @type {number} */ n) =>
      n >= tree.range.from && (tree.range.to === null || n <= tree.range.to);
    let next =
      Math.max(
        tree.range.from - 1,
        ...[...tree.taken].filter(inRange),
        ...[...byId.keys()].map(idNumber).filter(inRange),
      ) + 1;
    const projects = entries
      .filter((e) => e.data?.kind === 'project')
      .sort((a, b) => idNumber(String(a.data?.id)) - idNumber(String(b.data?.id)));
    const items = entries
      .filter((e) => ['work', 'decision', 'external'].includes(String(e.data?.kind)))
      .sort((a, b) => idNumber(String(a.data?.id)) - idNumber(String(b.data?.id)));
    const milestones = entries.filter((e) =>
      ['capability', 'learning'].includes(String(e.data?.kind)),
    );
    const milestoneDir = `${layout.workDir}/${layout.folders.milestone}`;
    for (const p of projects) {
      const pid = String(p.data?.id);
      const mine = items.filter((it) => it.data?.project === pid && it.data?.milestone);
      const names = [
        ...new Set([
          ...list(p.data?.milestones).map(String),
          ...mine.map((it) => String(it.data?.milestone)),
        ]),
      ];
      for (const name of names) {
        const constraints = mine
          .filter((it) => it.data?.milestone === name)
          .map((it) => String(it.data?.id));
        const title = titleOf(name);
        const existing = milestones.find(
          (m) => m.data?.project === pid && String(m.data?.title) === title,
        );
        if (existing) {
          // A milestone made by an earlier, partial run: add any constraint it lacks.
          const have = list(existing.data?.needs).map((s) => String(s).split(/\s+/)[0]);
          const add = constraints.filter((id) => !have.includes(id));
          if (add.length) {
            const data = { ...existing.data };
            data.needs = [...list(existing.data?.needs), ...add.map((id) => `${id} ${UNLINKED}`)];
            changed.set(
              existing.path,
              renderItem(data, keyOrder(String(data.kind), layout), existing.body),
            );
          }
          continue;
        }
        const status = String(p.data?.status);
        const id = `${layout.key}-${next++}`;
        const source = p.body
          .split('\n')
          .filter((line) =>
            new RegExp(`^\\s*[-*]\\s+\\*\\*${escapeRegExp(name)}\\*\\*`).test(line),
          );
        const body = [
          '',
          '## Notes',
          '',
          `Made by \`hitld work migrate\` (milestone-entities) from the milestone "${name}" of ${pid}. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked \`${UNLINKED}\` to a clause.`,
          ...(source.length ? ['', `From ${pid}:`, '', ...source.map((l) => l.trim())] : []),
          '',
        ].join('\n');
        const data = {
          id,
          title,
          kind: 'capability',
          status: status === 'Proposed' || status === 'Dropped' ? status : 'Planned',
          created: p.data?.created,
          project: pid,
          needs: constraints.map((c) => `${c} ${UNLINKED}`),
          reason: status === 'Dropped' ? `its project ${pid} was dropped` : undefined,
        };
        changed.set(
          `${milestoneDir}/${id}-${slugify(title)}.md`,
          renderItem(data, keyOrder('capability', layout), body),
        );
      }
      if (p.data && Object.hasOwn(p.data, 'milestones')) {
        changed.set(p.path, dropKey(/** @type {string} */ (files.get(p.path)), 'milestones'));
      }
    }
    for (const it of items) {
      if (it.data && Object.hasOwn(it.data, 'milestone')) {
        changed.set(it.path, dropKey(/** @type {string} */ (files.get(it.path)), 'milestone'));
      }
    }
    return [...changed].map(([path, text]) => ({ path, text }));
  },
};
