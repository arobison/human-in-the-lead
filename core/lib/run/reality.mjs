// What git can say about a run's dispatches, for `hitld run resume` and `rebuild` on the command
// line. It cannot say whether an executor is still running: only the harness knows that, and the
// core never calls a harness. The orchestrator passes that in (the `live` option).
//
// Also what the watchdog samples of a running executor without asking it (design part 5.2): its
// branch and worktree, and a headless run's process and output.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {import('./run.mjs').Reality} Reality
 * @typedef {import('../ledger/inflight.mjs').InFlight} InFlight
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

/**
 * The worktree that has a branch checked out, from git's own list.
 * @param {string} cwd @param {string} branch @returns {string | null}
 */
function worktreeOf(cwd, branch) {
  try {
    /** @type {string | null} */
    let path = null;
    for (const line of git(cwd, ['worktree', 'list', '--porcelain']).split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line === `branch refs/heads/${branch}`) return path;
    }
  } catch {
    // Not a repository, or git is missing: no worktree known.
  }
  return null;
}

/**
 * What git shows of an executor's work, as a worktree progress signal (core/lib/dispatch/progress.mjs):
 * the commit its branch is at, its commits ahead of the main branch, and its uncommitted changes
 * (a hash over their paths, sizes and modification times, so further edits to a changed file are
 * seen). The worktree is the dispatch's recorded one, or whichever worktree has its branch checked
 * out (a harness that made its own); without one, the branch alone. Null when neither exists.
 * @param {InFlight} entry
 * @param {{ cwd: string, mainBranch?: string }} options cwd: the primary checkout
 * @returns {{ source: 'worktree', head: string, commits: number, dirty?: number, changed?: string } | null}
 */
export function worktreeSignal(entry, { cwd, mainBranch = 'main' }) {
  const recorded = entry.worktree && existsSync(entry.worktree) ? entry.worktree : null;
  const worktree = recorded ?? (entry.branch ? worktreeOf(cwd, entry.branch) : null);
  try {
    let ref = 'HEAD';
    if (!worktree) {
      if (!entry.branch) return null;
      ref = `refs/heads/${entry.branch}`;
      git(cwd, ['rev-parse', '--verify', '--quiet', ref]);
    }
    const at = worktree ?? cwd;
    const head = git(at, ['rev-parse', ref]);
    const commits = Number(git(at, ['rev-list', '--count', `${mainBranch}..${ref}`]));
    /** @type {{ source: 'worktree', head: string, commits: number, dirty?: number, changed?: string }} */
    const out = { source: 'worktree', head, commits };
    if (worktree) {
      const paths = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'])
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3));
      out.dirty = paths.length;
      if (paths.length) {
        const h = createHash('sha256');
        for (const p of paths.sort()) {
          let stamp = 'gone';
          try {
            const st = statSync(join(worktree, p));
            stamp = `${st.size}:${st.mtimeMs}`;
          } catch {
            // Deleted, or the old side of a rename.
          }
          h.update(`${p}\0${stamp}\n`);
        }
        out.changed = h.digest('hex');
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * A headless run's liveness and output, as a process progress signal: its process is the one whose
 * ID the run's command wrote to `pidFile`, and its output is what it has written to `outputFile`.
 * Null when there is no process ID on file (the run never started, or its command did not record one).
 * @param {{ pidFile: string, outputFile: string }} files
 * @returns {{ source: 'process', alive: boolean, output_bytes: number } | null}
 */
export function processSignal({ pidFile, outputFile }) {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 1) return null;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    // EPERM: it exists but belongs to someone else, so it is alive.
    alive = /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
  let output = 0;
  try {
    output = statSync(outputFile).size;
  } catch {
    output = 0;
  }
  return { source: 'process', alive, output_bytes: output };
}
