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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { termsForProject } from '../../store/private-terms.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import { apiResponse, fieldFilter } from '../../tracker/files/api.mjs';
import { MIGRATIONS } from '../../tracker/files/migrations/index.mjs';
import { SWEEP_KINDS, sweepTracker } from '../../tracker/files/sweep.mjs';
import { readLedger } from '../../ledger/ledger.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { CodedError } from '../errors.mjs';
import { realPath } from '../../platform/fs.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} CommandContext
 * @typedef {import('../args.mjs').ArgSpec} ArgSpec
 */

/** @type {ArgSpec[]} */
export const where = [
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
export function open(input, ctx, { readOnly = false } = {}) {
  const repo = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
  const configDir = input.config ? resolve(ctx.cwd, String(input.config)) : undefined;
  if (configDir && !readOnly) {
    throw new CodedError(
      'usage',
      '--config is only for read-only commands (work check, show, query, claims, and views with --view or --out outside the repository); a command that acts takes its settings from the repository',
    );
  }
  const loaded = loadPolicy({
    // The policy file's trusted root is the config directory itself when one is given.
    cwd: configDir ?? repo,
    ...(configDir ? { path: resolve(configDir, 'policy.json') } : {}),
  });
  if (!loaded.policy) {
    throw new CodedError(
      'policy',
      `policy.json: ${formatErrors(loaded.errors).split('\n').join('; ')}`,
    );
  }
  return openTracker({
    repoRoot: repo,
    policy: loaded.policy,
    configDir,
    env: ctx.env,
    block: typeof input.block === 'string' ? input.block : undefined,
  });
}

/**
 * The private terms `work check` checks the tree against: from the private store of the project
 * the repository's own policy names. A list that does not read fails the check.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function workCheckTerms(input, ctx) {
  const repo = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
  const loaded = loadPolicy({ cwd: repo });
  // No policy.json: no store, but the address in use is still checked and the warning says the
  // list was not (HITLD-187).
  try {
    return termsForProject({
      policy: loaded.policy,
      env: ctx.env,
      repoRoot: findRepoRoot(repo) ?? undefined,
    });
  } catch (e) {
    const err = /** @type {{ code?: unknown, message: string }} */ (e);
    if (err.code === 'private-list-invalid')
      throw new CodedError('private-list-invalid', err.message);
    throw e;
  }
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
      const rel = relative(realPath(dir), realPath(at));
      return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
    } catch {
      if (dirname(at) === at) return false;
      at = dirname(at);
    }
  }
}

/**
 * Warnings for a check that found no tracker files: where it looked, whether tracker.json is
 * there, and any tracker-shaped files elsewhere in the repository.
 * @param {ReturnType<typeof open>} t @param {Record<string, unknown>} input @param {CommandContext} ctx
 * @returns {string[]}
 */
function emptyCheckWarnings(t, input, ctx) {
  const root = t.root();
  const layout = t.layout();
  const configDir = input.config
    ? resolve(ctx.cwd, String(input.config))
    : join(root, '.human-in-the-lead');
  /** @type {string[]} */
  const out = [
    `no tracker files found in ${layout.workDir}/ (the folder this repository's settings point at)`,
  ];
  if (!existsSync(join(configDir, 'tracker.json'))) {
    out.push(
      'there is no tracker.json, so the defaults apply; if the tracker lives in another folder, set work_dir in tracker.json',
    );
  }
  try {
    const listed = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
    const dirs = new Set();
    for (const f of listed) {
      if (f === layout.workDir || f.startsWith(`${layout.workDir}/`)) continue;
      let head = '';
      try {
        head = readFileSync(join(root, f), 'utf8').slice(0, 600);
      } catch {
        continue;
      }
      if (/^---\r?\n/.test(head) && /^id:\s*\S/m.test(head) && /^(kind|state):/m.test(head)) {
        dirs.add(dirname(f) === '.' ? '.' : dirname(f));
      }
    }
    if (dirs.size) {
      out.push(
        `files that look like tracker items (front matter with id and state) are in ${[...dirs].slice(0, 5).join(', ')}; set work_dir in tracker.json to the folder that holds them`,
      );
    }
  } catch {
    // Not a git checkout the check can list; the first warning stands.
  }
  return out;
}

/** The `id` of a positional. @param {Record<string, unknown>} input */
const idOf = (input) => String(input.id);

/** @type {ArgSpec} */
const jsonArg = {
  name: 'json',
  type: 'boolean',
  description:
    'Print the versioned read API response: api_version, the entities and the declared fields. Read the tracker through this, never through the files. Removing or retyping a field raises api_version; adding a field does not',
};

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
    built_by: 'a',
    args: [
      { name: 'title', type: 'string', description: 'One line', required: true },
      {
        name: 'kind',
        type: 'string',
        description:
          'work (default), decision, external, project or milestone (a learning milestone is one whose check is a study)',
      },
      {
        name: 'parent',
        type: 'string',
        description:
          'The project ID (for an item, or for a milestone; a milestone with none is a long outcome). A project has no parent',
      },
      {
        name: 'state',
        type: 'string',
        description:
          'planned (default) or proposed (the default for a milestone, which the owner commits)',
      },
      {
        name: 'needs',
        type: 'string',
        description:
          'Comma-separated IDs that must be done first (items and milestones). For a milestone, its constraints: each is linked to a clause in its file ("<ID> c1")',
      },
      {
        name: 'constraint-of',
        type: 'string',
        description:
          'Comma-separated milestone clauses this is a constraint of, each "<milestone ID> c<n>" (or c? to link at shaping). The link lives on the item, so filing it edits no milestone file',
      },
      {
        name: 'outcome',
        type: 'string',
        description:
          "A milestone's outcome: one sentence, the state for users or the question answered",
      },
      { name: 'decider', type: 'string', description: 'Who decides a decision (default owner)' },
      { name: 'waiting-on', type: 'string', description: 'Who an external item waits on' },
      {
        name: 'owner',
        type: 'string',
        description: 'Who is accountable for the record (default: the owner, not written)',
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
        constraint_of: csv(input['constraint-of']),
        outcome: input.outcome,
        decider: input.decider,
        waiting_on: input['waiting-on'],
        owner: input.owner,
        plan: input.plan,
      });
      return {
        ok: true,
        id: made.id,
        path: made.path,
        block: made.block,
        id_source: made.id_source,
        ...(made.warnings.length ? { warnings: made.warnings } : {}),
      };
    },
  },
  {
    name: 'work show',
    summary:
      'Show one tracker entity: an item, project or milestone, or a release record by its tag',
    built_by: 'a',
    output: ['ok', 'api_version', 'entity', 'declared_fields'],
    args: [idArg, jsonArg, ...where],
    run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      const entity = t.get(idOf(input));
      return input.json ? apiResponse(t.layout(), { entity }) : { ok: true, entity };
    },
  },
  {
    name: 'work query',
    summary: 'Query tracker entities by kind, state, area, needs, parent or text',
    built_by: 'a',
    output: ['ok', 'api_version', 'count', 'entities', 'declared_fields'],
    args: [
      {
        name: 'kind',
        type: 'string',
        description:
          'work, decision, external, project, milestone or release (release records, found by their tag)',
      },
      {
        name: 'state',
        type: 'string',
        description: 'proposed, planned, in-progress, done or dropped',
      },
      { name: 'area', type: 'string', description: 'An area (needs the area key turned on)' },
      { name: 'needs', type: 'string', description: 'Entities that need this ID' },
      { name: 'parent', type: 'string', description: 'Entities under this project' },
      { name: 'text', type: 'string', description: 'Case-insensitive, in the title and body' },
      { name: 'ready', type: 'boolean', description: 'Only items that are ready to start' },
      { name: 'blocked', type: 'boolean', description: 'Only items waiting on an open need' },
      { name: 'claimed', type: 'boolean', description: 'Only items a branch has claimed' },
      {
        name: 'field',
        type: 'string',
        repeatable: true,
        description:
          'A declared project field to match, name=value (a list field matches when it holds the value). Repeat to match several',
      },
      { name: 'bodies', type: 'boolean', description: 'Include each body (left out by default)' },
      jsonArg,
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
      if (input.field) filter.fields = fieldFilter(input.field);
      const found = t.query(filter);
      const entities = input.bodies ? found : found.map(({ body: _, ...rest }) => rest);
      return input.json
        ? apiResponse(t.layout(), { count: entities.length, entities })
        : { ok: true, count: entities.length, entities };
    },
  },
  {
    name: 'work claim',
    summary: 'Write the claim commit for an item on the executor branch',
    built_by: 'a',
    args: [
      idArg,
      {
        name: 'dispatch',
        type: 'string',
        description: "The executor's dispatch ID, such as D-12 (stored as claimed_by)",
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
      const ref = t.claim(idOf(input), String(input.dispatch), String(input.branch ?? ''));
      return { ok: true, id: idOf(input), dispatch: input.dispatch, ...ref };
    },
  },
  {
    name: 'work unclaim',
    summary: 'Give up an abandoned claim on main, with the reason (commit message unclaim:)',
    built_by: 'a',
    args: [
      idArg,
      {
        name: 'reason',
        type: 'string',
        description: 'Why the claim is given up',
        required: true,
      },
      { name: 'branch', type: 'string', description: 'Unclaim only the claim on this branch' },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const done = t.unclaim(
        idOf(input),
        String(input.reason),
        typeof input.branch === 'string' ? input.branch : undefined,
      );
      return { ok: true, id: idOf(input), ...done };
    },
  },
  {
    name: 'work close',
    summary: 'Set an item to done in the branch that does the work',
    built_by: 'a',
    args: [
      idArg,
      { name: 'no-commit', type: 'boolean', description: 'Change the file but do not commit it' },
      {
        name: 'report-file',
        type: 'string',
        description:
          "A file holding the executor's report in the fixed shape: it becomes the closing commit's message body, before its Work-Item and Dispatch trailers, so the commit is the report (HITLD-746). Its commit line names the branch, since a commit cannot name its own hash; hitld dispatch reconcile fills in the head it read",
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx);
      const file = input['report-file'];
      let report;
      if (typeof file === 'string') {
        if (input['no-commit']) {
          throw new CodedError(
            'usage',
            '--report-file goes into the closing commit: drop --no-commit',
          );
        }
        const path = isAbsolute(file) ? file : resolve(ctx.cwd, file);
        report = readFileSync(path, 'utf8');
        if (!report.trim()) throw new CodedError('usage', `${file} is empty: it holds no report`);
      }
      const done = t.close(idOf(input), {
        commit: !input['no-commit'],
        ...(report !== undefined ? { report } : {}),
      });
      return { ok: true, id: idOf(input), ...done };
    },
  },
  {
    name: 'work migrate',
    summary:
      'Apply the tracker format migrations to every file (idempotent; --dry-run shows the diff)',
    built_by: 'a',
    args: [
      {
        name: 'name',
        type: 'string',
        positional: true,
        description:
          'Run only the migration with this name, such as constraints-on-items (the same as --only)',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Show what would change, as a diff, and write nothing',
      },
      { name: 'only', type: 'string', description: 'Run only the migration with this name' },
      {
        name: 'no-commit',
        type: 'boolean',
        description: 'Write the files but do not commit them',
      },
      ...where,
    ],
    run(input, ctx) {
      const dryRun = Boolean(input['dry-run']);
      const t = open(input, ctx, { readOnly: dryRun });
      const done = t.migrate({
        dryRun,
        only:
          typeof input.name === 'string'
            ? input.name
            : typeof input.only === 'string'
              ? input.only
              : undefined,
        commit: !input['no-commit'],
      });
      return {
        ok: true,
        ...done,
        registered: MIGRATIONS.map((m) => m.name),
        summary: done.changed
          ? `${done.changed} file(s) ${dryRun ? 'would change' : 'migrated'}`
          : 'nothing to migrate',
      };
    },
  },
  {
    name: 'work claims',
    summary: 'List claimed items, read from local branches and fetched bundle refs',
    built_by: 'a',
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
      "Check schema, references, cycles, classification and orphaned claims; view freshness on main; on main, warn of an open item that a commit's Work-Item or Closes trailer names, and a done item that no commit's trailer names",
    built_by: 'a',
    args: [
      {
        name: 'branches',
        type: 'boolean',
        description:
          'Also check every worktree and branch for ID collisions, and branches for double claims',
      },
      {
        name: 'in-flight',
        type: 'string',
        description:
          'Dispatch IDs without a terminal event (from the ledger), comma-separated, to match against claim branches',
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      const inflight = csv(input['in-flight']);
      const terms = workCheckTerms(input, ctx);
      const checked = t.check({
        branches: Boolean(input.branches),
        inflight,
        terms: terms.matchers,
        consistency: true,
      });
      const { problems, files } = checked;
      const warnings = [...t.warnings(), ...terms.warnings, ...(checked.warnings ?? [])];
      if (files === 0) warnings.push(...emptyCheckWarnings(t, input, ctx));
      return {
        ok: problems.length === 0,
        files,
        problems,
        ...(warnings.length ? { warnings } : {}),
        // Warnings, never problems: the orchestrator offers the fix (design 3.4).
        ...(checked.consistency
          ? {
              mismatches: checked.consistency.mismatches,
              ...(checked.consistency.skipped.length
                ? { mismatches_skipped: checked.consistency.skipped }
                : {}),
            }
          : {}),
        summary: problems.length
          ? `${problems.length} problem(s)`
          : files === 0
            ? '0 files checked (see warnings)'
            : `${files} files, no problems`,
      };
    },
  },
  {
    name: 'work sweep',
    summary: `The stale-item sweep: ${SWEEP_KINDS.join(', ')}. Deterministic and read-only; the orchestrator plans from its findings and the digest lists them`,
    built_by: 'a',
    output: ['ok', 'count', 'counts', 'findings', 'checked', 'skipped', 'summary'],
    args: [
      {
        name: 'now',
        type: 'string',
        description: 'Judge ages at this time (a timestamp), for tests',
      },
      ...where,
    ],
    run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      let now = ctx.now ? ctx.now().getTime() : Date.now();
      if (input.now !== undefined) {
        now = Date.parse(String(input.now));
        if (Number.isNaN(now)) throw new CodedError('usage', '--now is not a timestamp');
      }
      const configDir = input.config ? resolve(ctx.cwd, String(input.config)) : undefined;
      const loaded = loadPolicy({
        cwd: configDir ?? t.root(),
        ...(configDir ? { path: resolve(configDir, 'policy.json') } : {}),
      });
      const policy = /** @type {Record<string, any>} */ (loaded.policy);
      const store = openStore(
        privateStorePath(policy.project.id, { env: ctx.env, repoRoot: t.root() }),
      );
      const ledger = readLedger(store);
      const swept = sweepTracker(t, { events: ledger.events, policy, now });
      const n = swept.findings.length;
      return {
        ok: true,
        count: n,
        ...swept,
        ...(ledger.problems.length
          ? { warnings: [`the ledger has ${ledger.problems.length} unreadable line(s)`] }
          : {}),
        summary: n
          ? `${n} finding(s): ${Object.entries(swept.counts)
              .filter(([, c]) => c > 0)
              .map(([k, c]) => `${c} ${k}`)
              .join(', ')}`
          : 'no findings',
      };
    },
  },
  {
    name: 'work views',
    summary: 'Regenerate the views (merge queue only, on main)',
    built_by: 'a',
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
          'Print one view as text instead of writing files: ready, blocked, decisions, projects, critical-path, milestones, unreleased, lists, items-graph, projects-graph or milestones-graph',
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
          throw new CodedError(
            'usage',
            `no view "${input.view}" (views: ${Object.keys(texts).join(', ')})`,
          );
        }
        return {
          ok: true,
          view: input.view,
          text: texts[/** @type {keyof typeof texts} */ (input.view)],
        };
      }
      const out = typeof input.out === 'string' ? resolve(ctx.cwd, input.out) : undefined;
      if (input.config && out && inside(t.root(), out)) {
        throw new CodedError(
          'usage',
          '--config with --out needs --out outside the repository; views inside it are written with the repository’s own settings',
        );
      }
      return { ok: true, ...t.writeViews({ outDir: out, who }) };
    },
  },
];
