// Migration "tracker-structure" (HITLD-90: projects being shaped, initiatives retire, one
// milestone kind).
//
//   initiative               → a milestone with no parent, with the same ID, moved to the
//                              milestones folder. Its constraints are the milestones of the
//                              projects under it and the milestones under it, each marked `c?` for
//                              shaping to link to a clause (dropped ones are left out). A done
//                              initiative becomes planned: a milestone is done only by a passing
//                              check, which shaping gives it.
//   project `initiative`     → removed: a project has no parent.
//   capability, learning     → `kind: milestone`. A learning milestone is one whose check is a
//                              study; one without a study check gets a note asking for it.
//   milestone `initiative`   → removed: its initiative is a milestone that names it as a constraint.
//   opportunity              → a project in the projects folder: raw, shaping, shaped and parked
//                              are proposed, bet is planned, rejected is dropped; `no_gos` is
//                              `out_of_scope`, `rabbit_holes` is `risks`, `bet_decision` is
//                              `decision`, and `bet_by` goes (it is derived from the decision).
//
// Milestone and project files are edited line by line, so the rest of each file is unchanged and
// the commit can be reviewed line by line. A moved file is written whole in the current key order.

import { renderItem } from '../frontmatter.mjs';
import { keyOrder } from '../format.mjs';
import { list } from '../graph.mjs';
import {
  LEGACY_MILESTONE_KINDS,
  OPPORTUNITY_RENAMED_KEYS,
  OPPORTUNITY_STATES,
} from '../legacy.mjs';
import { UNLINKED, parseCheck } from '../milestones.mjs';
import { idNumber } from '../tree.mjs';
import { dropKey } from './milestone-entities.mjs';

/**
 * @typedef {import('../migrate.mjs').FileChange} FileChange
 * @typedef {import('../tree.mjs').Entry} Entry
 */

/** Every kind a milestone file may hold here. */
const MILESTONE_KINDS = ['milestone', ...LEGACY_MILESTONE_KINDS];

/**
 * Set a one-value key's line in the front matter, keeping every other line.
 * @param {string} text @param {string} key @param {string} value
 */
function setLine(text, key, value) {
  const m = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return text;
  const lines = m[1]
    .split('\n')
    .map((line) => (new RegExp(`^${key}:(\\s|$)`).test(line) ? `${key}: ${value}` : line));
  return `---\n${lines.join('\n')}\n---${m[2]}${text.slice(m[0].length)}`;
}

/**
 * Add a paragraph to the body's Notes section, starting one at the end when there is none.
 * @param {string} body @param {string} paragraph
 */
function addNote(body, paragraph) {
  const text = body.replace(/\n*$/, '\n');
  return /^## Notes[ \t]*$/m.test(text)
    ? `${text}\n${paragraph}\n`
    : `${text}\n## Notes\n\n${paragraph}\n`;
}

/** The body of a file's text: what follows the front matter. @param {string} text */
const bodyOf = (text) => {
  const m = text.match(/^---\n[\s\S]*?\n---(\n|$)/);
  return m ? text.slice(m[0].length) : text;
};

/** @param {Entry} a @param {Entry} b */
const byNumber = (a, b) => idNumber(String(a.data?.id)) - idNumber(String(b.data?.id));

/** @type {import('../migrate.mjs').Migration} */
export const trackerStructure = {
  name: 'tracker-structure',
  summary:
    'move each initiative into a milestone with no parent whose constraints are its milestones, give every milestone kind milestone, remove a project parent, and turn opportunities into proposed projects (HITLD-90)',
  plan(tree) {
    const { layout, entries, files } = tree;
    /** @type {Map<string, string | null>} path to new text; null deletes */
    const changed = new Map();
    const text = (/** @type {Entry} */ e) => changed.get(e.path) ?? String(files.get(e.path));
    const of = (/** @type {string} */ kind) =>
      entries.filter((e) => String(e.data?.kind) === kind).sort(byNumber);
    const milestones = entries.filter((e) => MILESTONE_KINDS.includes(String(e.data?.kind)));
    const projects = of('project');
    const milestoneDir = `${layout.workDir}/${layout.folders.milestone}`;
    const projectDir = `${layout.workDir}/${layout.folders.project}`;

    for (const m of milestones) {
      const d = /** @type {Record<string, unknown>} */ (m.data);
      let next = text(m);
      if (d.kind !== 'milestone') next = setLine(next, 'kind', 'milestone');
      if (Object.hasOwn(d, 'initiative')) next = dropKey(next, 'initiative');
      const check = d.check === undefined ? null : parseCheck(String(d.check));
      if (d.kind === 'learning' && !(check && 'kind' in check && check.kind === 'study')) {
        const head = next.slice(0, next.length - bodyOf(next).length);
        next = `${head}${addNote(
          bodyOf(next),
          'This was a learning milestone. A learning milestone is one whose check is a study: give it the study whose verdict answers its question as its check (`check: study <ID>`).',
        )}`;
      }
      if (next !== text(m)) changed.set(m.path, next);
    }

    for (const p of projects) {
      if (Object.hasOwn(/** @type {object} */ (p.data), 'initiative')) {
        changed.set(p.path, dropKey(text(p), 'initiative'));
      }
    }

    for (const o of of('opportunity')) {
      const d = /** @type {Record<string, unknown>} */ (o.data);
      /** @type {Record<string, unknown>} */
      const data = {};
      for (const [k, v] of Object.entries(d)) {
        if (k === 'bet_by') continue;
        const to = OPPORTUNITY_RENAMED_KEYS[k] ?? k;
        if (to !== k && Object.hasOwn(d, to)) continue;
        data[to] = v;
      }
      data.kind = 'project';
      const state = OPPORTUNITY_STATES[String(d.state)] ?? d.state;
      data.state = state;
      if (state === 'dropped' && !data.reason) data.reason = 'rejected as an opportunity';
      const path = `${projectDir}/${o.file}`;
      if (path !== o.path) {
        if (files.has(path)) throw new Error(`tracker-structure: ${path} exists already`);
        changed.set(o.path, null);
      }
      changed.set(path, renderItem(data, keyOrder('project', layout), o.body));
    }

    for (const ini of of('initiative')) {
      const d = /** @type {Record<string, unknown>} */ (ini.data);
      const id = String(d.id);
      const under = new Set(
        projects.filter((p) => p.data?.initiative === id).map((p) => String(p.data?.id)),
      );
      const constraints = milestones
        .filter(
          (m) =>
            (under.has(String(m.data?.project)) || m.data?.initiative === id) &&
            m.data?.state !== 'dropped',
        )
        .sort(byNumber)
        .map((m) => `${m.data?.id} ${UNLINKED}`);
      const done = d.state === 'done';
      /** @type {Record<string, unknown>} */
      const data = {
        ...d,
        kind: 'milestone',
        state: done ? 'planned' : d.state,
        constraints: [...new Set([...list(d.constraints).map(String), ...constraints])],
      };
      const note = [
        `Made by \`hitld work migrate\` (tracker-structure) from the initiative ${id}: a long outcome is a milestone with no parent.`,
        `Its constraints are the milestones of the projects that were under it, marked \`${UNLINKED}\`; shaping gives it an outcome, done-when clauses and a check, and links each constraint to a clause.`,
        ...(done ? ['The initiative was done. A milestone is done only by a passing check.'] : []),
      ].join(' ');
      const path = `${milestoneDir}/${ini.file}`;
      if (path !== ini.path) {
        if (files.has(path)) throw new Error(`tracker-structure: ${path} exists already`);
        changed.set(ini.path, null);
      }
      changed.set(path, renderItem(data, keyOrder('milestone', layout), addNote(ini.body, note)));
    }
    return [...changed].map(([path, t]) => ({ path, text: t }));
  },
};
