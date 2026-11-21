// Owner-only commands refuse when the process looks like an executor's. Shared by the decision
// commands (rights.mjs) and baseline acceptance (eval.mjs).

import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DISPATCH_ID } from '../ledger/ids.mjs';

/**
 * Why this process may not take an owner's decision (record a decision, accept a baseline), or null. Two signals, either one enough: the
 * environment a dispatch sets (HITLD_ROLE, HITLD_DISPATCH), and the working directory being a linked
 * worktree, where executors work; the orchestrator works in the primary checkout. Neither is a
 * credential: a process running as the owner's user could unset the variables and change
 * directory. The plugin's guard, which reads the harness-attested agent type, is the first line;
 * signed answers (design part 22, Q21) are the strong one.
 * @param {NodeJS.ProcessEnv | undefined} env @param {string} cwd
 * @returns {string | null}
 */
export function executorSignal(env, cwd) {
  if (env?.HITLD_ROLE === 'executor' || DISPATCH_ID.test(env?.HITLD_DISPATCH ?? '')) {
    return 'this process runs for a dispatch';
  }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (lstatSync(join(top, '.git')).isFile()) return `${top} is a linked worktree`;
  } catch {
    // Not in a repository: the command fails later for want of a policy and tracker.
  }
  return null;
}
