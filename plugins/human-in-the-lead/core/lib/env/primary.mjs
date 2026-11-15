// The primary checkout's recorded path (design part 13.2). `hitld env exec` must read policy.json
// from the owner's primary checkout, never from an executor's worktree. Git metadata inside a
// worktree (its .git file, its common-dir pointer) is the executor's to rewrite, so it cannot say
// where the primary checkout is. This record can: it lives in the private store, outside every
// worktree, and is written when the orchestrator starts a run.
//
// The first record wins. Starting a later run from a different checkout is refused rather than
// overwritten, so a process that merely gets to call `hitld run start` cannot redirect the policy:
// the owner moves the project by deleting primary-checkout.json from the store.
//
// Limit: an executor that can write to the private store can forge this. Keeping executors out of
// the store is the harness sandbox's job (a later milestone).

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { findRepoRoot } from '../policy/policy.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {{ project_id: string, root: string, recorded_at: string }} PrimaryRecord
 */

export const PRIMARY_KEY = 'primary-checkout.json';

const NO_FOLLOW = (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/**
 * Read a small regular file in a directory another party controls (an executor's worktree) without
 * following a link at its last component or blocking on a FIFO: the type check and the read use
 * one descriptor, so the file cannot be swapped between them. Null if it is not a regular file.
 * @param {string} path @returns {string | null}
 */
function readPlainFile(path) {
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | NO_FOLLOW);
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, 'utf8') : null;
  } finally {
    closeSync(fd);
  }
}

/**
 * The canonical path of the primary checkout of the repository that holds `cwd`: where the main
 * worktree lives, found from git's common directory, and checked to be a real checkout (it has a
 * .git directory, not a .git file). Meant for the orchestrator's own working directory at run start.
 * @param {string} cwd
 * @returns {string} @throws if cwd is not in a git repository with a primary checkout
 */
export function primaryCheckoutOf(cwd) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const git = realpathSync(common);
  if (basename(git) !== '.git' || !lstatSync(git).isDirectory()) {
    throw new Error(`${cwd} is not in a repository with a primary checkout (git dir ${git})`);
  }
  return dirname(git);
}

/**
 * The checkout a command run for the owner works in: the primary checkout of the repository that
 * holds `cwd`, even from inside a linked worktree, so the policy, the tracker and main are the
 * owner's and never a branch's copy. Outside a repository with a primary checkout, the repository
 * root found from `cwd`; null when there is none.
 * @param {string} cwd
 * @returns {string | null}
 */
export function ownerCheckoutOf(cwd) {
  try {
    return primaryCheckoutOf(cwd);
  } catch {
    return findRepoRoot(cwd);
  }
}

/**
 * Record the primary checkout for a project. Called when the orchestrator starts a run.
 * @param {PrivateStore} store
 * @param {{ projectId: string, cwd: string, now?: () => Date }} options
 * @returns {{ root: string, recorded: boolean }} recorded false when the same path was already recorded
 */
export function recordPrimaryCheckout(store, options) {
  const root = primaryCheckoutOf(options.cwd);
  const existing = readPrimaryCheckout(store);
  if (existing) {
    if (existing.project_id !== options.projectId || existing.root !== root) {
      throw new Error(
        `the primary checkout of ${options.projectId} is recorded as ${existing.root}, not ${root}; if the project has moved, delete ${PRIMARY_KEY} from its private store`,
      );
    }
    return { root, recorded: false };
  }
  /** @type {PrimaryRecord} */
  const record = {
    project_id: options.projectId,
    root,
    recorded_at: (options.now?.() ?? new Date()).toISOString(),
  };
  store.write(PRIMARY_KEY, JSON.stringify(record, null, 2) + '\n');
  return { root, recorded: true };
}

/**
 * The recorded primary checkout, or null if none, or the record is unreadable or malformed.
 * @param {PrivateStore} store @returns {PrimaryRecord | null}
 */
export function readPrimaryCheckout(store) {
  const text = store.read(PRIMARY_KEY);
  if (text === null) return null;
  try {
    const r = JSON.parse(text);
    return typeof r?.project_id === 'string' && typeof r.root === 'string' ? r : null;
  } catch {
    return null;
  }
}

/**
 * Whether a worktree is genuinely a linked worktree of the primary checkout, judged without asking
 * git inside the worktree: its .git file must name an administrative directory under the primary's
 * .git/worktrees, and that directory must name the worktree's .git back. A worktree whose .git file
 * has been rewritten to point elsewhere fails.
 * @param {string} primaryRoot @param {string} worktree
 * @returns {{ ok: true, worktree: string } | { ok: false, reason: string }}
 */
export function belongsToPrimary(primaryRoot, worktree) {
  try {
    // `worktree` is the path the orchestrator recorded in the ledger (private store); the files
    // inside it are the executor's, so they are read as text only, without following a link.
    const wt = realpathSync(worktree);
    const dotgit = join(wt, '.git');
    const text = readPlainFile(dotgit)?.trim();
    if (text === undefined) return { ok: false, reason: `${wt} has no .git file` };
    const m = /^gitdir:\s*(.+)$/.exec(text);
    if (!m) return { ok: false, reason: `${dotgit} is not a gitdir pointer` };
    const admin = realpathSync(m[1]);
    const registry = realpathSync(join(primaryRoot, '.git', 'worktrees'));
    if (dirname(admin) !== registry) {
      return { ok: false, reason: `${wt} points at ${admin}, not at ${primaryRoot}'s worktrees` };
    }
    const back = readFileSync(join(admin, 'gitdir'), 'utf8').trim();
    if (realpathSync(back) !== realpathSync(dotgit)) {
      return { ok: false, reason: `${admin} does not belong to ${wt}` };
    }
    return { ok: true, worktree: wt };
  } catch (e) {
    return { ok: false, reason: `cannot verify ${worktree}: ${/** @type {Error} */ (e).message}` };
  }
}
