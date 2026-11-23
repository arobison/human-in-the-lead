// Releases (design parts 2.7, 3.2 and 16.5; HITLD-752): `hitld release propose` reads a release
// package's interface delta since its last full release and proposes the bump; `hitld release
// make` writes the release records and the tags; `hitld release migrate` moves the releases from
// before packages into the package main. The work is in core/lib/release/.

import { makeRelease } from '../../release/make.mjs';
import { applyMigration, planMigration } from '../../release/migrate.mjs';
import { proposeRelease } from '../../release/propose.mjs';
import { loadPolicy } from '../../policy/policy.mjs';
import { termsForProject } from '../../store/private-terms.mjs';
import { CodedError } from '../errors.mjs';
import { executorSignal } from '../executor.mjs';
import { open, where } from './tracker.mjs';

/** @type {import('../args.mjs').ArgSpec[]} */
const repoArg = where.filter((a) => a.name === 'repo');

/** @type {import('../args.mjs').ArgSpec} */
const preArg = {
  name: 'pre',
  type: 'string',
  description:
    'Make it a pre-release under this label, such as rc: the next <version>-rc.<n>. A pre-release is never the base of a later bump',
};

/** @type {import('../args.mjs').ArgSpec} */
const packageArg = {
  name: 'package',
  type: 'string',
  description:
    'The release package, one declared in policy.json release.packages; may be left out when exactly one is declared. A package in a lockstep group is released with its whole group',
};

/** @type {import('../args.mjs').ArgSpec} */
const trainArg = {
  name: 'train',
  type: 'string',
  description:
    "A release train: the item whose needs are several packages' release items, released together at their versions in one approval",
};

/** @type {import('../args.mjs').ArgSpec} */
const itemArg = {
  name: 'item',
  type: 'string',
  description:
    'The release item, when it is not the work item whose release key is this version: everything it needs that is not done or dropped is a gate. Its release key, if it has one, must be this version',
};

/** The top-level fields `release propose` prints, for the interface delta. */
const PROPOSAL_FIELDS = [
  'ok',
  'package',
  'group',
  'train',
  'last_tag',
  'base',
  'base_version',
  'first_release',
  'surface',
  'interface_measured',
  'interface_delta',
  'bump',
  'breaking',
  'reason',
  'version',
  'tag',
  'prerelease',
  'prerelease_rule',
  'items',
  'notes',
  'missing_release_note',
  'release_item',
  'gates',
  'milestones',
  'depends',
  'dependents',
  'releases',
  'unreleased',
  'package_version',
  'warnings',
];

/** The top-level fields `release migrate` prints. */
const MIGRATE_FIELDS = [
  'ok',
  'needed',
  'applied',
  'declared',
  'package',
  'policy',
  'moves',
  'tags_kept',
  'problems',
  'commit',
  'private_terms_checked',
  'warnings',
  'next',
];

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'release propose',
    summary:
      'Propose a release of a package: the interface delta from its surface file since its last full release, the bump it proposes, draft notes, missing changelog lines, dependency pins, the packages that depend on a breaking change, and unmet gates',
    built_by: 'first-release',
    output: PROPOSAL_FIELDS,
    args: [
      packageArg,
      trainArg,
      preArg,
      itemArg,
      {
        name: 'json',
        type: 'boolean',
        description:
          'Print the proposal as JSON (every command does; kept for the documented form)',
      },
      ...repoArg,
    ],
    async run(input, ctx) {
      const t = open(input, ctx, { readOnly: true });
      const p = await proposeRelease(t, {
        package: typeof input.package === 'string' ? input.package : undefined,
        train: typeof input.train === 'string' ? input.train : undefined,
        pre: typeof input.pre === 'string' ? input.pre : undefined,
        item: typeof input.item === 'string' ? input.item : undefined,
      });
      return { ok: true, ...p };
    },
  },
  {
    name: 'release make',
    summary:
      "Make a release of a package (with its lockstep group) or a release train: write the release records and annotated tags on main, or with --branch one record alone on a release branch; never pushing (the owner's, from the main session)",
    built_by: 'first-release',
    mcp: false,
    args: [
      packageArg,
      trainArg,
      {
        name: 'version',
        type: 'string',
        description:
          'The version to make, such as 0.1.0 or 0.1.0-rc.1 (default: the proposed one). Never below what the interface delta proposes',
      },
      preArg,
      {
        name: 'decision',
        type: 'string',
        description:
          'The decision or precedent the release is made under: a decision ID or a precedent ID (default owner, made directly in this turn)',
      },
      itemArg,
      {
        name: 'branch',
        type: 'string',
        description:
          'Put the record on this new branch, made from main, for a release pull request, and tag nothing: merging the pull request is the release, and the release workflow tags it',
      },
      ...repoArg,
    ],
    async run(input, ctx) {
      // A release is a public commitment, the owner's (design part 3.2): the same guard as a
      // decision answer. Only the human command line sets `interactive`, and an executor's
      // process (a dispatch, or a linked worktree) is refused.
      const why = executorSignal(ctx.env, ctx.cwd);
      if (why || ctx.interactive !== true) {
        return {
          ok: false,
          error: 'not-permitted',
          message: `release make is the owner's, through the main session in the primary checkout (${why ?? 'not the human command line'}); an executor proposes a release in its report`,
        };
      }
      const t = open(input, ctx);
      const made = await makeRelease(t, {
        package: typeof input.package === 'string' ? input.package : undefined,
        train: typeof input.train === 'string' ? input.train : undefined,
        version: typeof input.version === 'string' ? input.version : undefined,
        pre: typeof input.pre === 'string' ? input.pre : undefined,
        decision: typeof input.decision === 'string' ? input.decision : undefined,
        item: typeof input.item === 'string' ? input.item : undefined,
        branch: typeof input.branch === 'string' ? input.branch : undefined,
      });
      return { ok: true, ...made };
    },
  },
  {
    name: 'release migrate',
    summary:
      "Move the releases from before release packages into a package named main: report the plan, or with --apply (the owner's, from the main session) declare main in policy.json and move the records, keeping every tag as it is",
    built_by: 'first-release',
    mcp: false,
    output: MIGRATE_FIELDS,
    args: [
      {
        name: 'surface',
        type: 'string',
        description: 'The committed surface file to declare for main, when there is one',
      },
      {
        name: 'apply',
        type: 'boolean',
        description:
          "Write policy.json and the moved records in one commit (the owner's, in the main session); without it nothing is written",
      },
      ...repoArg,
    ],
    async run(input, ctx) {
      const apply = input.apply === true;
      if (apply) {
        // Changing how every release is found is the owner's, as making one is.
        const why = executorSignal(ctx.env, ctx.cwd);
        if (why || ctx.interactive !== true) {
          return {
            ok: false,
            error: 'not-permitted',
            message: `release migrate --apply is the owner's, through the main session in the primary checkout (${why ?? 'not the human command line'}); without --apply it only reports the plan`,
          };
        }
      }
      const t = open(input, ctx, { readOnly: !apply });
      const plan = planMigration(t, {
        surface: typeof input.surface === 'string' ? input.surface : undefined,
      });
      if (!apply || !plan.needed) {
        return {
          ok: true,
          ...plan,
          applied: false,
          commit: null,
          next: plan.needed
            ? plan.problems.length
              ? `Fix the problems first; then the owner runs hitld release migrate${typeof input.surface === 'string' ? ` --surface ${input.surface}` : ''} --apply`
              : `Nothing was written. The owner runs hitld release migrate${typeof input.surface === 'string' ? ` --surface ${input.surface}` : ''} --apply in the main session to make this change`
            : 'Nothing to migrate: a release package is declared and no record from before packages is left',
        };
      }
      // The commit guard's private term check runs on the change before it is committed, as the
      // hooks would (HITLD-899); a list that does not read refuses.
      const loaded = loadPolicy({ cwd: t.root() });
      let terms;
      try {
        terms = termsForProject({ policy: loaded.policy, env: ctx.env, repoRoot: t.root() });
      } catch (e) {
        const err = /** @type {{ code?: unknown, message: string }} */ (e);
        if (err.code === 'private-list-invalid') {
          throw new CodedError('private-list-invalid', `${err.message}; nothing was migrated`);
        }
        throw e;
      }
      const done = applyMigration(t, plan, { terms: terms.matchers });
      return {
        ok: true,
        ...plan,
        applied: true,
        commit: done.commit,
        private_terms_checked: terms.list_found,
        ...(terms.warnings.length ? { warnings: terms.warnings } : {}),
        next: 'Nothing was pushed. Check the commit (hitld work check), then push it or open a pull request from it',
      };
    },
  },
];
