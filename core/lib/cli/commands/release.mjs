// Releases (design parts 2.7, 3.2 and 16.5): `hitld release propose` reads the interface delta
// since the last full release and proposes the bump; `hitld release make` writes the release
// record and the tag. The work is in core/lib/release/.

import { makeRelease } from '../../release/make.mjs';
import { proposeRelease } from '../../release/propose.mjs';
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
const itemArg = {
  name: 'item',
  type: 'string',
  description:
    'The release item: its gates (milestones it needs that are not Done) are the ones that count',
};

/** The top-level fields `release propose` prints, for the interface delta. */
const PROPOSAL_FIELDS = [
  'ok',
  'last_tag',
  'base',
  'base_version',
  'initial',
  'interface_delta',
  'bump',
  'breaking',
  'basis',
  'version',
  'tag',
  'prerelease',
  'prerelease_rule',
  'items',
  'notes',
  'missing_changelog',
  'gates',
  'milestones',
  'unreleased',
  'package_version',
  'warnings',
];

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'release propose',
    summary:
      'Propose a release: the interface delta since the last full release, the bump it proposes, draft notes, missing changelog lines and unmet gates',
    piece: 'first-release',
    output: PROPOSAL_FIELDS,
    args: [
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
        pre: typeof input.pre === 'string' ? input.pre : undefined,
        item: typeof input.item === 'string' ? input.item : undefined,
      });
      return { ok: true, ...p };
    },
  },
  {
    name: 'release make',
    summary:
      "Make a release: write the release record and an annotated tag on main, never pushing (the owner's, from the main session)",
    piece: 'first-release',
    mcp: false,
    args: [
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
          error: 'not_permitted',
          message: `release make is the owner's, through the main session in the primary checkout (${why ?? 'not the human command line'}); an executor proposes a release in its report`,
        };
      }
      const t = open(input, ctx);
      const made = await makeRelease(t, {
        version: typeof input.version === 'string' ? input.version : undefined,
        pre: typeof input.pre === 'string' ? input.pre : undefined,
        decision: typeof input.decision === 'string' ? input.decision : undefined,
        item: typeof input.item === 'string' ? input.item : undefined,
      });
      return { ok: true, ...made };
    },
  },
];
