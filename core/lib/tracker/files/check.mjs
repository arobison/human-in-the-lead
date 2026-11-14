// The batch check (design part 3.4, "Validation"): every file matches its kind's allowed keys and
// the entity schema, every reference resolves, no dependency cycles, nothing above the
// classification ceiling, no duplicate IDs. Problems are strings, one per line, in the form
// "<path>: <what is wrong>". The messages and their order are those of the reference check,
// which this must agree with (design part 16.7).

import { existsSync } from 'node:fs';
import { judge } from '../../guard/classification.mjs';
import { schemas } from '../../schema/registry.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import {
  CODE_KEYS,
  FOLDER_GROUP,
  KINDS,
  PRIORITIES,
  STATUSES,
  allowedKeys,
  listKeys,
  toEntity,
} from './format.mjs';
import { ITEM_KINDS, buildGraph, findCycles, list } from './graph.mjs';
import { insidePath } from './safe.mjs';
import { idNumber, patterns } from './tree.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 */

/**
 * Validate loaded entries. Returns a list of problem strings.
 * @param {Entry[]} items
 * @param {Layout} layout
 * @param {{ root?: string, onMain?: boolean }} [options]
 *   root lets `plan` paths be checked for existence; onMain turns on the rule that no work item
 *   on the main branch is In progress (a claim belongs on the executor's branch).
 * @returns {string[]}
 */
export function checkItems(items, layout, { root, onMain = false } = {}) {
  /** @type {string[]} */
  const problems = [];
  const { id: idPattern, file: filePattern } = patterns(layout.key);
  const lists = listKeys(layout);
  /** @param {Entry} it @param {string} msg */
  const say = (it, msg) => problems.push(`${it.path}: ${msg}`);
  /** @type {Set<Entry>} entries with a problem the format checks found */
  const flagged = new Set();
  for (const it of items) {
    const before = problems.length;
    for (const e of it.errors) say(it, e);
    const d = it.data;
    if (d) checkOne(it, d);
    if (problems.length > before) flagged.add(it);
  }

  /** @param {Entry} it @param {NonNullable<Entry['data']>} d */
  function checkOne(it, d) {
    for (const key of Object.keys(d)) {
      if (CODE_KEYS.includes(key)) {
        say(it, `"${key}" is a key some tools run as code; never allowed`);
      }
    }
    const kind = String(d.kind ?? '');
    if (!KINDS.includes(kind)) {
      say(it, `kind "${kind}" isn't one of ${KINDS.join(', ')}`);
      return;
    }
    const allowed = allowedKeys(kind, layout);
    for (const key of Object.keys(d)) {
      if (!allowed.includes(key) && !CODE_KEYS.includes(key)) {
        say(it, `"${key}" isn't an allowed key for a ${kind}`);
      }
      if (Array.isArray(d[key]) !== lists.has(key)) {
        say(it, `"${key}" must be ${lists.has(key) ? 'a list' : 'a single value'}`);
      }
    }
    const id = String(d.id ?? '');
    const m = it.file.match(filePattern);
    if (!idPattern.test(id)) {
      say(it, `id "${id}" isn't ${layout.key}-<n>`);
    } else if (!m || m[1] !== id) {
      say(it, `file name doesn't start with its id ${id}`);
    }
    if (!m) say(it, `file name isn't ${layout.key}-<n>-<slug>.md (lower-case slug)`);
    const folder = layout.folders[FOLDER_GROUP[/** @type {keyof typeof FOLDER_GROUP} */ (kind)]];
    if (folder !== it.folder) say(it, `a ${kind} belongs in ${folder}/, not ${it.folder}/`);
    if (!d.title) say(it, 'no title');
    const status = String(d.status ?? '');
    if (!STATUSES.includes(status)) {
      say(it, `status "${status}" isn't one of ${STATUSES.join(', ')}`);
    }
    if (d.priority !== undefined && !PRIORITIES.includes(String(d.priority))) {
      say(it, `priority "${d.priority}" isn't one of ${PRIORITIES.join(', ')}`);
    }
    if (d.created !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.created))) {
      say(it, `created "${d.created}" isn't YYYY-MM-DD`);
    }
    if (status === 'Dropped' && !d.reason) say(it, 'Dropped needs a reason');
    if (d.reason && status !== 'Dropped') say(it, 'a reason is only for Dropped');
    if (ITEM_KINDS.includes(kind)) {
      if (!d.project) say(it, 'no project');
      if (kind === 'work' && status === 'In progress' && !d.claimed) {
        say(it, 'In progress needs claimed (who has it)');
      }
      if (d.claimed && !['In progress', 'Done'].includes(status)) {
        say(it, `claimed, but ${status}`);
      }
      if (onMain && kind === 'work' && status === 'In progress') {
        say(
          it,
          `In progress on ${layout.mainBranch}; a claim belongs on the executor's branch, and ${layout.mainBranch} goes from Planned straight to Done`,
        );
      }
    }
    if (kind === 'decision' && !d['decided-by']) say(it, 'a decision needs decided-by');
    if (kind === 'external' && !d.party) say(it, 'an external item needs party (who we wait on)');
    if (['project', 'initiative'].includes(kind) && !d.lead) say(it, `a ${kind} needs a lead`);
    if (kind === 'project' && !d.initiative) say(it, 'a project needs an initiative');
    if (d.plan && root) {
      let found = false;
      try {
        found = existsSync(insidePath(root, String(d.plan)));
      } catch {
        // A plan path that leaves the repository or crosses a link is not one: never probe it.
      }
      if (!found) say(it, `plan ${d.plan} doesn't exist`);
    }
  }

  const g = buildGraph(items);
  for (const [a, b] of g.duplicates) {
    problems.push(`${a.data.id}: in both ${a.path} and ${b.path}`);
  }
  for (const it of g.all) {
    const d = it.data;
    /** @param {string} key @param {string} kind */
    const ref = (key, kind) => {
      if (!d[key]) return undefined;
      const target = g.get(/** @type {string} */ (d[key])); // a list never resolves: the format check names it
      if (!target) say(it, `${key} ${d[key]} doesn't exist`);
      else if (target.data.kind !== kind) {
        say(it, `${key} ${d[key]} is a ${target.data.kind}, not a ${kind}`);
      }
      return target;
    };
    if (ITEM_KINDS.includes(String(d.kind))) {
      const project = ref('project', 'project');
      if (d.milestone && project) {
        const ms = list(project.data.milestones);
        if (!ms.includes(String(d.milestone))) {
          say(
            it,
            `milestone "${d.milestone}" isn't one of ${project.data.id}'s (${ms.join(', ') || 'none'})`,
          );
        }
      }
      for (const n of g.needs(it)) {
        const target = g.get(n);
        if (!target) say(it, `needs ${n}, which doesn't exist`);
        else if (!g.isItem(target)) {
          say(it, `needs ${n}, a ${target.data.kind}; needs name items only`);
        } else if (target.data.status === 'Dropped' && g.isOpen(it)) {
          say(it, `needs ${n}, which was dropped; it can never be ready`);
        }
        if (n === d.id) say(it, 'needs itself');
      }
    }
    if (d.kind === 'project') ref('initiative', 'initiative');
  }
  for (const cycle of findCycles(g)) problems.push(`cycle: ${cycle.join(' → ')}`);

  // Beyond the reference check: the entity schemas and the commit guard's classification rule
  // (core/lib/guard/classification.mjs), for files the format checks above had nothing to say
  // about.
  const rules = {
    ceiling: layout.classificationCeiling,
    defaultClassification: layout.defaultClassification,
    privatePaths: layout.privatePaths ?? [],
  };
  for (const it of items) {
    if (!it.data || flagged.has(it)) continue;
    const entity = toEntity(it.data, layout);
    const errors = schemas().validateTrackerEntity(entity);
    if (errors.length) say(it, `schema: ${formatErrors(errors).split('\n').join('; ')}`);
    else {
      const declared = it.data.classification;
      const refused = judge(it.path, declared === undefined ? [] : [String(declared)], rules);
      if (refused) say(it, refused.message);
    }
  }
  return problems;
}

/**
 * Number collisions across places: one ID under two different file names (names are fixed at
 * creation, so these are two different items). The same name on two branches is one item
 * edited in two places, which is normal.
 * @param {{ where: string, items: Entry[] }[]} placed
 * @param {Layout} layout
 * @returns {{ id: string, files: { file: string, where: string[] }[] }[]}
 */
export function findCollisions(placed, layout) {
  const { file: filePattern } = patterns(layout.key);
  /** @type {Map<string, Map<string, string[]>>} */
  const names = new Map();
  for (const { where, items } of placed) {
    for (const it of items) {
      const m = it.file.match(filePattern);
      if (!m) continue;
      if (!names.has(m[1])) names.set(m[1], new Map());
      const byName = /** @type {Map<string, string[]>} */ (names.get(m[1]));
      if (!byName.has(it.file)) byName.set(it.file, []);
      /** @type {string[]} */ (byName.get(it.file)).push(where);
    }
  }
  const out = [];
  for (const [id, byName] of names) {
    if (byName.size > 1) {
      out.push({ id, files: [...byName].map(([file, where]) => ({ file, where })) });
    }
  }
  return out.sort((a, b) => idNumber(a.id) - idNumber(b.id));
}
