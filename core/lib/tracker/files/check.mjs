// The batch check (design part 3.4, "Validation"): every file matches its kind's allowed keys and
// the entity schema, every reference resolves, no dependency cycles (through items and
// milestones), nothing above the classification ceiling, no duplicate IDs. For milestones (design
// part 3.2): every constraint names a clause that exists, every contribution has a value and a
// confidence, done only with a recorded passing check by a role other than its items' authors, and
// a name that is an outcome, never a number. For projects (design part 3.2): the shaping fields
// parse, the bet names an answered decision, and the milestones' shares fit the appetite. A key, a
// state value or a kind in the formats before HITLD-82 and HITLD-90 is named with the migration
// that moves it.
// Problems are strings, one per line, in the form
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
  RETIRED_KEYS,
  STATES,
  allowedKeys,
  fieldProblems,
  listKeys,
  toEntity,
} from './format.mjs';
import { ITEM_KINDS, buildGraph, findCycles } from './graph.mjs';
import { LEGACY_KINDS, LEGACY_KIND_NOTES, LEGACY_STATES, renamesFor } from './legacy.mjs';
import {
  AUTHOR_ROLE,
  MILESTONE_KINDS,
  isLearning,
  numberedName,
  passingCheck,
  readMilestone,
} from './milestones.mjs';
import { readProject } from './projects.mjs';
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
 * @param {{ root?: string, onMain?: boolean, authorRoles?: (ids: string[]) => Set<string> }} [options]
 *   root lets `plan` paths be checked for existence; onMain turns on the rule that no work item
 *   on the main branch is in-progress (a claim belongs on the executor's branch); authorRoles
 *   gives the roles that wrote the named items (from their commits' Agent-Role trailers), whose
 *   runs of a milestone's check do not count (default: the executor role only).
 * @returns {string[]}
 */
export function checkItems(items, layout, { root, onMain = false, authorRoles } = {}) {
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
    if (Object.hasOwn(LEGACY_KINDS, kind)) {
      say(
        it,
        `kind "${kind}" is now "${LEGACY_KINDS[kind]}" (${LEGACY_KIND_NOTES[kind]}); run hitld work migrate`,
      );
      return;
    }
    if (!KINDS.includes(kind)) {
      say(it, `kind "${kind}" isn't one of ${KINDS.join(', ')}`);
      return;
    }
    const allowed = allowedKeys(kind, layout);
    const renamed = renamesFor(kind);
    for (const key of Object.keys(d)) {
      if (Object.hasOwn(RETIRED_KEYS, key) && !allowed.includes(key)) {
        say(it, `"${key}" is retired: ${RETIRED_KEYS[key]}; run hitld work migrate`);
        continue;
      } else if (Object.hasOwn(renamed, key) && !allowed.includes(key)) {
        say(it, `"${key}" is now "${renamed[key]}"; run hitld work migrate`);
        continue;
      } else if (!allowed.includes(key) && !CODE_KEYS.includes(key)) {
        say(it, `"${key}" isn't an allowed key for a ${kind}`);
      }
      if (Array.isArray(d[key]) !== lists.has(key)) {
        say(it, `"${key}" must be ${lists.has(key) ? 'a list' : 'a single value'}`);
      }
    }
    for (const p of fieldProblems(d, layout)) say(it, p);
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
    const state = String(d.state ?? d.status ?? '');
    if (!STATES.includes(state)) {
      say(
        it,
        Object.hasOwn(LEGACY_STATES, state)
          ? `state "${state}" is now "${LEGACY_STATES[state]}"; run hitld work migrate`
          : `state "${state}" isn't one of ${STATES.join(', ')}`,
      );
    }
    if (d.created !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.created))) {
      say(it, `created "${d.created}" isn't YYYY-MM-DD`);
    }
    if (state === 'dropped' && !d.reason) say(it, 'dropped needs a reason');
    if (d.reason && state !== 'dropped') say(it, 'a reason is only for dropped');
    if (ITEM_KINDS.includes(kind)) {
      if (!d.project) say(it, 'no project');
      if (kind === 'work' && state === 'in-progress' && !d.claimed_by) {
        say(it, 'in-progress needs claimed_by (who has it)');
      }
      if (d.claimed_by && !['in-progress', 'done'].includes(state)) {
        say(it, `claimed_by, but ${state}`);
      }
      if (onMain && kind === 'work' && state === 'in-progress') {
        say(
          it,
          `in-progress on ${layout.mainBranch}; a claim belongs on the executor's branch, and ${layout.mainBranch} goes from planned straight to done`,
        );
      }
    }
    if (kind !== 'work' && state === 'in-progress') {
      say(it, `a ${kind} is never in-progress: only work items are claimed`);
    }
    if (kind === 'decision' && !d.decider) say(it, 'a decision needs a decider');
    if (kind === 'external' && !d.waiting_on) {
      say(it, 'an external item needs waiting_on (who we wait on)');
    }
    if (kind === 'project') for (const p of readProject(d).problems) say(it, p);
    if (MILESTONE_KINDS.includes(kind)) {
      for (const p of readMilestone(d).problems) say(it, p);
      const numbered = numberedName(d.title);
      if (numbered) {
        say(
          it,
          `the name numbers the milestone ("${numbered}"); name it by its outcome, and let the graph give the order`,
        );
      }
    }
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
    const milestone = g.isMilestone(it);
    if (ITEM_KINDS.includes(String(d.kind)) || milestone) {
      ref('project', 'project');
      for (const n of g.needs(it)) {
        const target = g.get(n);
        if (!target) say(it, `needs ${n}, which doesn't exist`);
        else if (!g.isItem(target) && !g.isMilestone(target)) {
          say(it, `needs ${n}, a ${target.data.kind}; needs name items and milestones only`);
        } else if (target.data.state === 'dropped' && g.isOpen(it)) {
          say(it, `needs ${n}, which was dropped; it can never be ${milestone ? 'met' : 'ready'}`);
        }
        if (n === d.id) say(it, 'needs itself');
      }
    }
    if (milestone) {
      const m = readMilestone(d);
      for (const c of m.contributions) {
        const target = g.get(c.id);
        if (!target) say(it, `contributions ${c.id}, which doesn't exist`);
        else if (!g.isItem(target)) {
          say(it, `contributions ${c.id}, a ${target.data.kind}; contributions are items`);
        }
      }
      if (d.state === 'done') {
        const ids = [...g.needs(it), ...m.contributions.map((c) => c.id)];
        const roles = authorRoles ? authorRoles(ids) : new Set([AUTHOR_ROLE]);
        if (!passingCheck(m, roles)) {
          say(
            it,
            isLearning(m)
              ? 'done needs its study answered, recorded in check_results as answered'
              : `done needs a passing check in check_results, run by a role other than its items' authors (${[...roles].join(', ')})`,
          );
        }
      }
    }
    if (d.kind === 'project') {
      const decision = ref('decision', 'decision');
      if (decision && ['planned', 'done'].includes(String(d.state))) {
        if (decision.data.state !== 'done') {
          say(
            it,
            `decision ${d.decision} isn't answered; a project is planned only by the owner's bet, the answer to its decision`,
          );
        }
      }
      // The project holds the appetite; its milestones hold shares of it.
      const shares = g
        .milestonesOf(String(d.id))
        .filter((m) => m.data.state !== 'dropped')
        .map((m) => ({ id: String(m.data.id), tokens: readMilestone(m.data).appetite }))
        .filter((s) => s.tokens !== undefined);
      const shared = shares.reduce((sum, s) => sum + Number(s.tokens), 0);
      const appetite = readProject(d).appetite;
      const each = shares.map((s) => `${s.id} ${s.tokens}`).join(', ');
      if (shares.length && appetite === undefined) {
        say(
          it,
          `its milestones hold shares of an appetite (${each}) it doesn't set; give it appetite_tokens`,
        );
      } else if (appetite !== undefined && shared > appetite) {
        say(
          it,
          `its milestones' shares of the appetite (${shared} tokens: ${each}) exceed its appetite_tokens ${appetite}`,
        );
      }
    }
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
    // Declared fields are checked against their own types above, not by the entity schema.
    const model = { ...entity };
    for (const f of layout.fields) delete model[f.name];
    const errors = schemas().validateTrackerEntity(model);
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
