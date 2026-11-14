// What the manager needs from policy.json's `env` section, plus the name checks shared by its parts.

import { isAbsolute, join, resolve } from 'node:path';

/**
 * @typedef {object} SecretTask a named task, declared in the owner's policy.json
 * @property {string} task
 * @property {string[]} roles
 * @property {string[]} secrets
 * @property {string[]} [argv]
 * @property {string} [repo_script]
 * @property {'repo' | 'worktree'} [cwd]
 *
 * @typedef {object} EnvSettings
 * @property {string[]} worktreeSetup
 * @property {string} branchPrefix
 * @property {string | null} worktreeRoot
 * @property {{ min: number, max: number }} portRange
 * @property {number} failedWorktreesKept
 * @property {string[]} serialResources
 * @property {number} lockExpirySeconds
 * @property {'auto' | 'keychain' | 'env'} secretProvider
 * @property {SecretTask[]} secretTasks
 */

/**
 * The settings from a loaded (merged, validated) policy.
 * @param {Record<string, any>} policy
 * @returns {EnvSettings}
 */
export function envSettings(policy) {
  const e = policy.env ?? {};
  return {
    worktreeSetup: e.worktree_setup ?? [],
    branchPrefix: e.branch_prefix ?? 'hitld',
    worktreeRoot: e.worktree_root ?? null,
    portRange: e.port_range ?? { min: 4100, max: 4199 },
    failedWorktreesKept: e.failed_worktrees_kept ?? 3,
    serialResources: e.serial_resources ?? ['gpu', 'benchmark', 'merge-queue'],
    lockExpirySeconds: e.lock_expiry ?? 300,
    secretProvider: e.secret_provider ?? 'auto',
    secretTasks: e.secret_tasks ?? [],
  };
}

const HOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * A holder is a dispatch ID such as D-12. It becomes a directory name, so it is a safe segment.
 * @param {unknown} holder
 * @returns {string}
 */
export function checkHolder(holder) {
  if (typeof holder !== 'string' || !HOLDER.test(holder) || holder.includes('..')) {
    throw new Error(
      `holder ${JSON.stringify(holder)} is not a safe name (letters, digits, ".", "_", "-"; at most 64)`,
    );
  }
  return holder;
}

/**
 * Where worktrees live: the configured root, else under the private store.
 * @param {EnvSettings} settings @param {string} repoRoot @param {string} storeRoot
 */
export function worktreeRoot(settings, repoRoot, storeRoot) {
  if (!settings.worktreeRoot) return join(storeRoot, 'worktrees');
  return isAbsolute(settings.worktreeRoot)
    ? settings.worktreeRoot
    : resolve(repoRoot, settings.worktreeRoot);
}
