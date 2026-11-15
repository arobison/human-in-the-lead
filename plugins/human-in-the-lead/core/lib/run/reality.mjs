// What git can say about a run's dispatches, for `hitld run resume` and `rebuild` on the command
// line. It cannot say whether an executor is still running: only the harness knows that, and the
// core never calls a harness. The orchestrator passes that in (the `live` option).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * @typedef {import('./run.mjs').Reality} Reality
 */

/**
 * @param {string} cwd a directory in the repository
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * @param {{ cwd: string, mainBranch?: string }} options mainBranch: policy.json merge.main_branch,
 *   which callers pass; 'main' only where no policy is loaded
 * @returns {Reality}
 */
export function gitReality({ cwd, mainBranch = 'main' }) {
  /** @returns {string[]} */
  const branches = () => {
    try {
      return git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  return {
    branches,
    hasCommits(entry) {
      try {
        const worktree = entry.worktree && existsSync(entry.worktree) ? entry.worktree : null;
        const ref = worktree ? 'HEAD' : entry.branch;
        if (!ref || (!worktree && !branches().includes(ref))) return false;
        return Number(git(worktree ?? cwd, ['rev-list', '--count', `${mainBranch}..${ref}`])) > 0;
      } catch {
        return false;
      }
    },
  };
}
