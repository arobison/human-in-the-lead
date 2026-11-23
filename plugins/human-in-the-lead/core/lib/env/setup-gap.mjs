// A fresh worktree with nothing installed (HITLD-292). The merge queue runs merge.fast_checks and
// merge.full_suite in a fresh worktree of its own, which holds only what git tracks and what
// env.worktree_setup makes. A policy that sets those checks and no setup passes every check
// policy can make, then fails its first merge on a branch that did nothing wrong. Setup and check
// time (check policy, config explain, install) warn about it; the queue stops on it before it
// checks a branch, when a lockfile shows what the worktree lacks.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The lockfiles at a repository's root, in the order they are looked for, each with the install
 * command the adopt skill would propose for it and, when the install lands inside the worktree,
 * the directory it makes there (dependencies in a shared cache, as Go's and Cargo's, have none:
 * their checks fetch on demand).
 * @type {{ file: string, install: string, dir?: string }[]}
 */
export const LOCKFILES = [
  { file: 'package-lock.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'npm-shrinkwrap.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'pnpm-lock.yaml', install: 'pnpm install --frozen-lockfile', dir: 'node_modules' },
  { file: 'yarn.lock', install: 'yarn install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lock', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lockb', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'uv.lock', install: 'uv sync --frozen', dir: '.venv' },
  { file: 'poetry.lock', install: 'poetry install' },
  { file: 'Pipfile.lock', install: 'pipenv sync' },
  { file: 'Gemfile.lock', install: 'bundle install' },
  { file: 'Cargo.lock', install: 'cargo fetch' },
  { file: 'go.sum', install: 'go mod download' },
];

/** The first lockfile at `root`, if any. @param {string | null} root */
export const lockfileAt = (root) =>
  root ? (LOCKFILES.find((l) => existsSync(join(root, l.file))) ?? null) : null;

/** @param {{ file: string, install: string }} lock */
const propose = (lock) => `${lock.file} is here: propose "${lock.install}"`;

const ALSO =
  'and any command that makes the generated, uncommitted files the checks import, not only the install';

/**
 * The warning for a policy whose merge queue runs checks in a worktree its setup leaves empty, or
 * null. Only the local queue (merge.via push) runs them in its own worktree; with pull requests
 * the checks run where the pull request's checks do.
 * @param {{ merge?: { via?: string, fast_checks?: string[], full_suite?: string[] }, env?: { worktree_setup?: string[] } } | null} policy
 *   the effective policy
 * @param {string | null} root the repository's root, where a lockfile is looked for
 * @returns {string | null}
 */
export function worktreeSetupGap(policy, root) {
  if (!policy) return null;
  const merge = policy.merge ?? {};
  if ((merge.via ?? 'push') !== 'push') return null;
  if ((policy.env?.worktree_setup ?? []).length) return null;
  const set = [
    ...((merge.fast_checks ?? []).length ? ['merge.fast_checks'] : []),
    ...((merge.full_suite ?? []).length ? ['merge.full_suite'] : []),
  ];
  if (!set.length) return null;
  const lock = lockfileAt(root);
  return (
    `${set.join(' and ')} ${set.length > 1 ? 'are' : 'is'} set but env.worktree_setup is empty: ` +
    `the merge queue runs ${set.length > 1 ? 'these' : 'it'} in a fresh worktree with nothing installed; ` +
    `set env.worktree_setup in .human-in-the-lead/policy.json${lock ? ` (${propose(lock)})` : ''}, ${ALSO}`
  );
}

/**
 * Why the queue's fresh worktree cannot run the checks, or null: no setup, and a lockfile there
 * whose install directory is missing. Without a lockfile the queue cannot tell, and goes on.
 * @param {string} dir the fresh worktree @param {string[]} setup env.worktree_setup
 * @returns {string | null}
 */
export function emptyWorktree(dir, setup) {
  if (setup.length) return null;
  const lock = LOCKFILES.find((l) => l.dir && existsSync(join(dir, l.file)));
  if (!lock?.dir || existsSync(join(dir, lock.dir))) return null;
  return (
    `the merge queue's fresh worktree has no ${lock.dir} and env.worktree_setup is empty, so the checks cannot run there; ` +
    `nothing was checked or merged, and no branch is at fault. Set env.worktree_setup in .human-in-the-lead/policy.json ` +
    `(${propose(lock)}), ${ALSO}, then run hitld merge again`
  );
}
