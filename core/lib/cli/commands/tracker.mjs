// Piece (a): the files tracker backend (design parts 3.3 and 3.4). The commands are thin: the
// work is in core/lib/tracker/files/.
//
// Where settings live: .human-in-the-lead/policy.json (the ID key, blocks and classification
// ceiling) and .human-in-the-lead/tracker.json (paths and options), in the repository. Two
// options let a tracker be read with its settings kept elsewhere, for example to compare with
// another tool's output without writing anything into the repository:
//   --repo <dir>    the repository (default: the one containing the current directory)
//   --config <dir>  a directory holding policy.json and tracker.json (default: <repo>/.human-in-the-lead)
// --config is for read-only commands only (work check, show, query, claims, and views with --view
// or with --out outside the repository). A command that acts refuses it: settings that decide where
// the tracker writes must come from the repository itself. The files in a --config directory are
// held to the same checks as policy.json: owned by the user, not group- or world-writable, no links.

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { loadPolicy } from '../../policy/policy.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} CommandContext
 * @typedef {import('../args.mjs').ArgSpec} ArgSpec
 */

/** @type {ArgSpec[]} */
const where = [
  {
    name: 'repo',
    type: 'string',
    description: 'The repository (default: the one containing the current directory)',
  },
  {
    name: 'config',
    type: 'string',
    description:
      'A directory holding policy.json and tracker.json (default: <repo>/.human-in-the-lead)',
  },
];

/**
 * Open the tracker the command's options point at.
 * @param {Record<string, unknown>} input @param {CommandContext} ctx
 * @param {{ readOnly?: boolean }} [options] readOnly: the command changes nothing in the repository
 */
function open(input, ctx, { readOnly = false } = {}) {
  const repo = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
  const configDir = input.config ? resolve(ctx.cwd, String(input.config)) : undefined;
  if (configDir && !readOnly) {
    throw new Error(
      '--config is only for read-only commands (work check, show, query, claims, and views with --view or --out outside the repository); a command that acts takes its settings from the repository',
    );
  }
  const loaded = loadPolicy({
    // The policy file's trusted root is the config directory itself when one is given.
    cwd: configDir ?? repo,
    ...(configDir ? { path: resolve(configDir, 'policy.json') } : {}),
  });
  if (!loaded.policy) {
    throw new Error(`policy.json: ${formatErrors(loaded.errors).split('\n').join('; ')}`);
  }
  return openTracker({
    repoRoot: repo,
    policy: loaded.policy,
    configDir,
    env: ctx.env,
    block: typeof input.block === 'string' ? input.block : undefined,
  });
}

/** @param {unknown} v @returns {string[] | undefined} */
const csv = (v) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/**
 * Whether a path is inside a directory, by real path (the nearest existing ancestor, for a path
 * not yet created).
 * @param {string} dir @param {string} path
 */
function inside(dir, path) {
  let at = path;
  for (;;) {
    try {
      const rel = relative(realpathSync(dir), realpathSync(at));
      return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
    } catch {
      if (dirname(at) === at) return false;
      at = dirname(at);
    }
  }
}

/** The `id` of a positional. @param {Record<string, unknown>} input */
const idOf = (input) => String(input.id);

/** @type {ArgSpec} */
const idArg = {
  name: 'id',
  type: 'string',
  description: 'The tracker ID, such as W-214',
  positional: true,
  required: true,
};

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'work new',
    summary: 'Create a tracker entity (orchestrator only; allocates the ID)',
    piece: 'a',
    args: [
      { name: 'title', type: 'string', description: 'One line', required: true },
      {
        name: 'kind',
        type: 'string',
        description: 'work (default), decision, external, project or initiative',
      },
      {
        name: 'parent',
        type: 'string',
        description: 'The project ID (for an item) or the initiative ID (for a project)',
      },
      { name: 'state', type: 'string', description: 'Planned (default) or Proposed' },
      { name: 'needs', type: 'string', description: 'Comma-separated IDs that must be Done first' },
      { name: 'priority', type: 'string', description: 'urgent, high, medium or low' },
      { name: 'milestone', type: 'string', description: "One of the project's milestones" },
      {
        name: 'milestones',
        type: 'string',
        description: "A project's milestones, comma-separated",
      },
      { name: 'decider', type: 'string', description: 'Who decides a decision (default owner)' },
      { name: 'party', type: 'string', description: 'Who an external item waits on' },
      {
        name: 'lead',
        type: 'string',
        description: 'Who leads a project or initiative (default owner)',
      },
      {
        name: 'plan',
        type: 'string',
        description: "A project's plan document, repository-relative",
      },
      {
        name: 'block',
        type: 'string',
        description:
          'The reserved ID block to allocate from (default: HITLD_ID_BLOCK, else the base range)',
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const made = t.createEntity({
        title: input.title,
        kind: input.kind ?? 'work',
        parent: input.parent,
        state: input.state,
        needs: csv(input.needs),
        priority: input.priority,
        milestone: input.milestone,
        milestones: csv(input.milestones),
        decider: input.decider,
        party: input.party,
        lead: input.lead,
        plan: input.plan,
      });
      return { ok: true, id: made.id, path: made.path, block: made.block };
    },
  },
  {
    name: 'work show',
    summary: 'Show one tracker entity',
    piece: 'a',
    args: [idArg, ...where],
    run(input, ctx) {
      return { ok: true, entity: open(input, ctx, { readOnly: true }).get(idOf(input)) };
    },
  },
  {
    name: 'work query',
    summary: 'Query tracker entities by kind, state, area, needs, parent or text',
    piece: 'a',
    args: [
      {
        name: 'kind',
        type: 'string',
        description: 'work, decision, external, project or initiative',
      },
      {
        name: 'state',
        type: 'string',
        description: 'Proposed, Planned, In progress, Done or Dropped',
      },
      { name: 'area', type: 'string', description: 'An area (needs the area key turned on)' },
      { name: 'needs', type: 'string', description: 'Entities that need this ID' },
      { name: 'parent', type: 'string', description: 'Entities under this project or initiative' },
      { name: 'text', type: 'string', description: 'Case-insensitive, in the title and body' },
      { name: 'ready', type: 'boolean', description: 'Only items that are ready to start' },
      { name: 'blocked', type: 'boolean', description: 'Only items waiting on an open need' },
      { name: 'claimed', type: 'boolean', description: 'Only items a branch has claimed' },
      { name: 'bodies', type: 'boolean', description: 'Include each body (left out by default)' },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      /** @type {Record<string, unknown>} */
      const filter = {};
      for (const k of ['kind', 'state', 'area', 'needs', 'parent', 'text']) {
        if (typeof input[k] === 'string') filter[k] = input[k];
      }
      for (const k of ['ready', 'blocked', 'claimed']) if (input[k]) filter[k] = true;
      const found = t.query(filter);
      const entities = input.bodies ? found : found.map(({ body: _, ...rest }) => rest);
      return { ok: true, count: entities.length, entities };
    },
  },
  {
    name: 'work claim',
    summary: 'Write the claim commit for an item on the executor branch',
    piece: 'a',
    args: [
      idArg,
      {
        name: 'claimant',
        type: 'string',
        description: "The executor's dispatch ID, such as D-12",
        required: true,
      },
      {
        name: 'branch',
        type: 'string',
        description: 'Refuse unless the working tree is on this branch',
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const ref = t.claim(idOf(input), String(input.claimant), String(input.branch ?? ''));
      return { ok: true, id: idOf(input), claimant: input.claimant, ...ref };
    },
  },
  {
    name: 'work release',
    summary: 'Release an abandoned claim on main, with the reason',
    piece: 'a',
    args: [
      idArg,
      { name: 'reason', type: 'string', description: 'Why the claim is released', required: true },
      { name: 'branch', type: 'string', description: 'Release only the claim on this branch' },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const done = t.release(
        idOf(input),
        String(input.reason),
        typeof input.branch === 'string' ? input.branch : undefined,
      );
      return { ok: true, id: idOf(input), ...done };
    },
  },
  {
    name: 'work close',
    summary: 'Set an item to Done in the branch that does the work',
    piece: 'a',
    args: [
      idArg,
      { name: 'no-commit', type: 'boolean', description: 'Change the file but do not commit it' },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const done = t.close(idOf(input), { commit: !input['no-commit'] });
      return { ok: true, id: idOf(input), ...done };
    },
  },
  {
    name: 'work claims',
    summary: 'List claimed items, read from local branches and fetched bundle refs',
    piece: 'a',
    args: where,
    run(input, ctx) {
      const claims = open(input, ctx, { readOnly: true }).claims();
      return {
        ok: true,
        count: claims.length,
        claims,
        note: "Claims aren't atomic: another machine's claims show only after its bundle is fetched.",
      };
    },
  },
  {
    name: 'work check',
    summary:
      'Check schema, references, cycles, classification and orphaned claims; view freshness on main',
    piece: 'a',
    args: [
      {
        name: 'branches',
        type: 'boolean',
        description:
          'Also check every worktree and branch for ID collisions, and branches for double claims',
      },
      {
        name: 'inflight',
        type: 'string',
        description:
          'Dispatch IDs without a terminal event (from the ledger), comma-separated, to match against claim branches',
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      const inflight = csv(input.inflight);
      const { problems, files } = t.check({ branches: Boolean(input.branches), inflight });
      return {
        ok: problems.length === 0,
        files,
        problems,
        summary: problems.length ? `${problems.length} problem(s)` : `${files} files, no problems`,
      };
    },
  },
  {
    name: 'work views',
    summary: 'Regenerate the views (merge queue only, on main)',
    piece: 'a',
    args: [
      {
        name: 'out',
        type: 'string',
        description:
          "Write the views to this directory instead of the tracker's views directory, touching nothing else",
      },
      {
        name: 'view',
        type: 'string',
        description:
          'Print one view as text instead of writing files: ready, blocked, decisions, projects, initiatives, critical-path, lists, items-graph or projects-graph',
      },
      {
        name: 'who',
        type: 'string',
        description: 'For the decision backlog: a decider, or all (default owner)',
      },
      ...where,
    ],
    run(input, ctx) {
      // Printing a view, or writing views outside the repository, changes nothing in it.
      const readOnly = typeof input.view === 'string' || typeof input.out === 'string';
      const t = open(input, ctx, { readOnly });
      const who = typeof input.who === 'string' ? input.who : undefined;
      if (typeof input.view === 'string') {
        const texts = t.renderViewTexts({ who });
        if (!Object.hasOwn(texts, input.view)) {
          throw new Error(`no view "${input.view}" (views: ${Object.keys(texts).join(', ')})`);
        }
        return {
          ok: true,
          view: input.view,
          text: texts[/** @type {keyof typeof texts} */ (input.view)],
        };
      }
      const out = typeof input.out === 'string' ? resolve(ctx.cwd, input.out) : undefined;
      if (input.config && out && inside(t.root(), out)) {
        throw new Error(
          '--config with --out needs --out outside the repository; views inside it are written with the repository’s own settings',
        );
      }
      return { ok: true, ...t.writeViews({ outDir: out, who }) };
    },
  },
];
