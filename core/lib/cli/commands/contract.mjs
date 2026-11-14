// Piece (d): the executor contract (design parts 5.2 and 15.2).

import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { checkContract } from '../../contract/check.mjs';

/** The project root: the repository containing the working directory, else the directory itself. */
const rootOf = (/** @type {import('../table.mjs').CommandContext} */ ctx) =>
  findRepoRoot(ctx.cwd) ?? ctx.cwd;

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'check contract',
    summary:
      'The executor contract block is present and current in AGENTS.md, and CLAUDE.md imports it if present',
    piece: 'd',
    run: (_input, ctx) =>
      checkContract(rootOf(ctx), undefined, loadPolicy({ cwd: ctx.cwd }).policy?.project?.key),
  },
];
