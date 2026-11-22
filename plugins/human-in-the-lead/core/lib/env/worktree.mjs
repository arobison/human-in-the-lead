// Worktrees (design part 13.2): cut from the tip of the base branch, set up as the project
// declares, and cleaned up without ever losing uncommitted work.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CodedError } from '../cli/errors.mjs';
import { checkHolder, worktreeRoot } from './config.mjs';
import { git, gitOk } from './git.mjs';
import { INCLUDE_FILE, copyIncluded } from './include.mjs';
import { findOutsideLinks, unlinkOutsideLinks } from './links.mjs';
import { logEvent, readRegistry, updateRegistry } from './registry.mjs';
import { realPath } from './fsx.mjs';
import { killTree } from './proc.mjs';
import { shellSpec, spawnOptions } from './shell.mjs';

/**
 * @typedef {import('./registry.mjs').WorktreeLease} WorktreeLease
 * @typedef {import('./registry.mjs').SetupResult} SetupResult
 * @typedef {import('./config.mjs').EnvSettings} EnvSettings
 * @typedef {object} WorktreeContext
 * @property {import('../store/store.mjs').PrivateStore} store
 * @property {string} repoRoot any directory inside the repository (or one of its worktrees)
 * @property {EnvSettings} settings
 */

/** @param {string} s */
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'work';

/**
 * @typedef {object} BranchChoice
 * @property {string} branch the name the worktree takes
 * @property {string} wanted the name asked for
 * @property {'free' | 'merged' | 'unmerged' | 'checked-out'} found what the wanted name held
 * @property {'new' | 'reuse' | 'fresh'} chose a new branch under the wanted name, the existing
 *   branch moved forward to the base's tip, or a new branch under a fresh name
 * @property {string} note what was found and chosen, in a sentence
 */

/** The branches checked out in any worktree of the repository. @param {string} repoRoot */
async function checkedOutBranches(repoRoot) {
  const out = new Set();
  for (const line of (await git(['worktree', 'list', '--porcelain'], repoRoot)).split('\n')) {
    if (line.startsWith('branch refs/heads/')) out.add(line.slice('branch refs/heads/'.length));
  }
  return out;
}

/**
 * The tips a branch name has: the local branch and any remote-tracking branch of that name. A
 * remote's name may hold a slash, so a remote-tracking ref counts when it ends in /<name>, under
 * whatever remote. That can count a tip that belongs to another name, which only makes the choice
 * stricter (a fresh name instead of a reuse); it never misses one.
 * @param {string} repoRoot @param {string} name
 */
async function tipsNamed(repoRoot, name) {
  const refs = await git(
    ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'],
    repoRoot,
  );
  /** @type {string[]} */
  const tips = [];
  for (const line of refs.split('\n')) {
    const [ref, sha] = line.split(' ');
    if (!ref || !sha) continue;
    const local = ref === `refs/heads/${name}`;
    const remote = ref.startsWith('refs/remotes/') && ref.endsWith(`/${name}`);
    if (local || remote) tips.push(sha);
  }
  return tips;
}

/**
 * Which branch a new worktree takes (HITLD-194). An item dispatched again after an abandon wants
 * the name its earlier dispatch used. When that branch exists and everything on it is already in
 * `base` (local and remote-tracking tips alike) and no worktree has it checked out, it is reused:
 * moved forward to the base's tip, which loses no commit. Otherwise (it holds unmerged commits, or
 * a kept worktree still has it) it is left exactly as it is and the worktree takes the first free
 * name of <wanted>-2, <wanted>-3, ...
 * @param {string} repoRoot @param {string} wanted @param {string} base
 * @returns {Promise<BranchChoice>}
 */
export async function chooseBranch(repoRoot, wanted, base) {
  const checkedOut = await checkedOutBranches(repoRoot);
  /** @param {string} name @returns {Promise<BranchChoice['found']>} */
  const state = async (name) => {
    const tips = await tipsNamed(repoRoot, name);
    if (!tips.length) return 'free';
    if (checkedOut.has(name)) return 'checked-out';
    for (const tip of tips) {
      if (!(await gitOk(['merge-base', '--is-ancestor', tip, base], repoRoot))) return 'unmerged';
    }
    return 'merged';
  };
  const found = await state(wanted);
  if (found === 'free') {
    return { branch: wanted, wanted, found, chose: 'new', note: `${wanted} is new` };
  }
  if (found === 'merged') {
    return {
      branch: wanted,
      wanted,
      found,
      chose: 'reuse',
      note: `${wanted} already exists with nothing unmerged on it; reusing it from the tip of ${base}`,
    };
  }
  const why =
    found === 'unmerged' ? `holds commits not in ${base}` : 'is checked out in another worktree';
  for (let n = 2; n < 100; n++) {
    const name = `${wanted}-${n}`;
    if ((await state(name)) === 'free') {
      return {
        branch: name,
        wanted,
        found,
        chose: 'fresh',
        note: `${wanted} ${why}, so it is left as it is; this dispatch works on ${name}`,
      };
    }
  }
  throw new CodedError(
    'branch-names-taken',
    `${wanted} ${why}, and ${wanted}-2 to ${wanted}-99 are all taken; delete the ones that are merged or not wanted`,
  );
}

/**
 * Cut a worktree from the tip of `base` (default: policy.json merge.main_branch) on a branch named
 * <branch_prefix>/<ID>-<slug>, or on `branch` when the caller names it. When that name is taken,
 * chooseBranch decides: reuse a branch with nothing unmerged, or take a fresh name. Asking again
 * for a holder that already has one returns it.
 * @param {WorktreeContext} ctx
 * @param {{ holder: string, itemId: string, slug?: string, base?: string, branch?: string,
 *   choice?: BranchChoice }} request choice: what the caller's own chooseBranch found for
 *   `branch`, logged with the event so it says why that name was taken
 * @returns {Promise<{ lease: WorktreeLease, existing: boolean, branch_choice?: BranchChoice }>}
 */
export async function createWorktree(ctx, request) {
  const holder = checkHolder(request.holder);
  checkHolder(request.itemId);
  const base = request.base ?? ctx.settings.mainBranch ?? 'main';
  const wanted =
    request.branch ??
    `${ctx.settings.branchPrefix}/${request.itemId}-${slugify(request.slug ?? 'work')}`;
  if (!(await gitOk(['check-ref-format', '--branch', wanted], ctx.repoRoot))) {
    throw new Error(`"${wanted}" is not a valid branch name`);
  }
  const path = resolve(worktreeRoot(ctx.settings, ctx.repoRoot, ctx.store.root), holder);

  return updateRegistry(ctx.store, async (registry) => {
    const have = registry.worktrees[holder];
    if (have) return { lease: have, existing: true };
    if (existsSync(path)) throw new Error(`${path} already exists and is not leased to ${holder}`);
    mkdirSync(dirname(path), { recursive: true });
    const tip = (await git(['rev-parse', '--verify', `${base}^{commit}`], ctx.repoRoot)).trim();
    const choice = await chooseBranch(ctx.repoRoot, wanted, base);
    const branch = choice.branch;
    const logged = request.choice?.branch === branch ? request.choice : choice;
    // -B only for a branch chooseBranch found fully merged: moving it to the tip loses nothing.
    await git(
      ['worktree', 'add', choice.chose === 'reuse' ? '-B' : '-b', branch, path, tip],
      ctx.repoRoot,
    );
    /** @type {WorktreeLease} */
    const lease = {
      holder,
      path: realPath(path),
      branch,
      repo_root: realPath((await git(['rev-parse', '--show-toplevel'], ctx.repoRoot)).trim()),
      base,
      adopted: false,
      state: 'ready',
      created_at: new Date().toISOString(),
    };
    registry.worktrees[holder] = lease;
    logEvent(ctx.store, 'worktree_created', {
      holder,
      branch,
      path: lease.path,
      base,
      tip,
      ...(logged.chose === 'new' ? {} : { branch_found: logged.found, branch_note: logged.note }),
    });
    return { lease, existing: false, branch_choice: choice };
  });
}

/**
 * Take over a worktree the harness created (Claude Code's isolation: worktree). The manager runs
 * setup in it and records it, but never removes it.
 * @param {WorktreeContext} ctx
 * @param {{ holder: string, path: string }} request
 * @returns {Promise<{ lease: WorktreeLease, existing: boolean }>}
 */
export async function adoptWorktree(ctx, request) {
  const holder = checkHolder(request.holder);
  const path = realPath(resolve(ctx.repoRoot, request.path));
  const top = realPath((await git(['rev-parse', '--show-toplevel'], path)).trim());
  if (top !== path) throw new Error(`${path} is not the top of a git worktree`);
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim();
  const common = resolve(path, (await git(['rev-parse', '--git-common-dir'], path)).trim());
  return updateRegistry(ctx.store, (registry) => {
    const have = registry.worktrees[holder];
    if (have) return { lease: have, existing: true };
    /** @type {WorktreeLease} */
    const lease = {
      holder,
      path,
      branch,
      repo_root: dirname(realPath(common)),
      base: ctx.settings.mainBranch ?? 'main',
      adopted: true,
      state: 'ready',
      created_at: new Date().toISOString(),
    };
    registry.worktrees[holder] = lease;
    logEvent(ctx.store, 'worktree_adopted', { holder, branch, path });
    return { lease, existing: false };
  });
}

const TAIL = 2000;

/**
 * Run one setup command through the shell in a directory: /bin/sh, or on Windows Git's bash
 * (shell.mjs), since the commands are written for a POSIX shell. A timeout stops the command's
 * whole process tree on Windows, where stopping the shell would leave its children running.
 *
 * Trust boundary (design parts 10 and 13.2): `command` is an entry of policy.json
 * env.worktree_setup, a key marked x-hitld-executes. The owner declares it as a shell command and
 * the manager runs it on purpose, so a shell is the declared contract. It reaches here only from a
 * policy that came through loadPolicy's trusted read (owner, mode, no link, inside the repository
 * root) in the primary checkout; runSetup takes no command from its caller.
 * @param {string} command @param {string} cwd @param {NodeJS.ProcessEnv} env @param {number} timeoutMs
 * @returns {Promise<{ exit_code: number | null, ms: number, output_tail: string }>}
 */
function runStep(command, cwd, env, timeoutMs) {
  return new Promise((resolveStep) => {
    const started = Date.now();
    let out = '';
    // Owner-declared shell command (env.worktree_setup, x-hitld-executes); see above.
    const spec = shellSpec(command, env);
    const child = spawn(spec.file, spec.args, {
      cwd,
      ...spawnOptions(spec, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const note = spec.note ? `note: ${spec.note}\n` : '';
    /** @param {Buffer} d */
    const take = (d) => {
      out = (out + d.toString('utf8')).slice(-TAIL * 2);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) killTree(child.pid);
      else child.kill('SIGTERM');
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolveStep({ exit_code: null, ms: Date.now() - started, output_tail: note + e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveStep({
        exit_code: code,
        ms: Date.now() - started,
        output_tail: note + out.slice(-(TAIL - note.length)),
      });
    });
  });
}

/**
 * Run the project's declared setup in a holder's worktree and record the result. The first failing
 * command stops it. Setup gets no secrets: it runs with the environment it is given, which the
 * caller keeps free of them. The commands are policy's env.worktree_setup and nothing else: a
 * request cannot name its own.
 * @param {WorktreeContext} ctx
 * @param {{ holder: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} request
 * @returns {Promise<SetupResult>}
 */
export async function runSetup(ctx, request) {
  const holder = checkHolder(request.holder);
  const lease = readRegistry(ctx.store).worktrees[holder];
  if (!lease) throw new Error(`${holder} has no worktree to set up`);
  const commands = ctx.settings.worktreeSetup;
  /** @type {SetupResult} */
  const result = { ok: true, steps: [] };
  // The git-ignored files `.worktreeinclude` lists, before the commands, which may need them.
  // Paths only are recorded; a file's contents never reach the result or the log.
  try {
    result.included = await copyIncluded({ primary: lease.repo_root, worktree: lease.path });
  } catch (e) {
    result.included = {
      listed: false,
      copied: [],
      skipped: [],
      note: `the files ${INCLUDE_FILE} lists could not be copied: ${/** @type {Error} */ (e).message}`,
    };
  }
  for (const command of commands) {
    const step = await runStep(
      command,
      lease.path,
      request.env ?? process.env,
      request.timeoutMs ?? 600_000,
    );
    result.steps.push({ command, ...step });
    if (step.exit_code !== 0) {
      result.ok = false;
      break;
    }
  }
  // Flag links that point out of the worktree, so the owner sees what cleanup will meet.
  try {
    result.links_out = findOutsideLinks(lease.path);
  } catch {
    result.links_out = [];
  }
  await updateRegistry(ctx.store, (registry) => {
    const l = registry.worktrees[holder];
    if (!l) return;
    l.setup = result;
    l.state = result.ok ? 'ready' : 'setup-failed';
    logEvent(ctx.store, 'worktree_setup', {
      holder,
      ok: result.ok,
      steps: result.steps.length,
      links_out: result.links_out?.map((x) => x.path) ?? [],
      included: result.included?.copied ?? [],
    });
  });
  return result;
}

/**
 * Commit uncommitted changes to the worktree's branch so removing it loses nothing.
 * @param {WorktreeLease} lease
 * @returns {Promise<{ saved: boolean, branch: string }>}
 */
async function saveUncommitted(lease) {
  const status = await git(['status', '--porcelain'], lease.path);
  if (!status.trim()) return { saved: false, branch: lease.branch };
  let branch = lease.branch;
  if (branch === 'HEAD') {
    branch = `hitld-saved/${lease.holder}`;
    await git(['switch', '-c', branch], lease.path);
  }
  await git(['add', '-A'], lease.path);
  await git(
    [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--no-verify',
      '-m',
      `hitld: save uncommitted changes from ${lease.holder}'s worktree before removal`,
    ],
    lease.path,
  );
  return { saved: true, branch };
}

/** @param {string} p */
const realOr = (p) => {
  try {
    return realPath(p);
  } catch {
    return p;
  }
};

/**
 * Remove a worktree from disk, saving uncommitted work to its branch first. Returns what happened.
 * @param {WorktreeLease} lease
 * @param {boolean} deleteIfMerged
 * @param {{ lstat?: (path: string) => import('node:fs').Stats }} [seam] tests fake a mount point
 */
export async function removeFromDisk(lease, deleteIfMerged, seam = {}) {
  // Never the primary checkout, whatever a lease says.
  if (realOr(lease.path) === realOr(lease.repo_root)) {
    throw new Error(`not removing ${lease.path}: it is the primary checkout`);
  }
  const gone = !existsSync(lease.path);
  /** @type {{ saved: boolean, branch_deleted: boolean, branch: string, links_unlinked: string[] }} */
  const out = { saved: false, branch_deleted: false, branch: lease.branch, links_unlinked: [] };
  if (!gone) {
    const saved = await saveUncommitted(lease);
    out.saved = saved.saved;
    out.branch = saved.branch;
    // Unlink every link that points outside the worktree first, so nothing below can reach a
    // target (design 13.2). Uncommitted work is already saved, so --force only lets git remove
    // what the unlinking changed (a tracked link) and the ignored files in the tree.
    const links = unlinkOutsideLinks(lease.path, seam.lstat ? { lstat: seam.lstat } : undefined);
    if (links.mounts.length) {
      throw new Error(
        `not removing ${lease.path}: ${links.mounts.join(', ')} is a mount point (another device)`,
      );
    }
    if (links.declined.length) {
      throw new Error(
        `not removing ${lease.path}: could not safely unlink ${links.declined.map((l) => l.path).join(', ')}`,
      );
    }
    out.links_unlinked = links.unlinked.map((l) => l.path);
    await git(['worktree', 'remove', '--force', lease.path], lease.repo_root);
  } else {
    await git(['worktree', 'prune'], lease.repo_root);
  }
  if (deleteIfMerged && out.branch !== 'HEAD') {
    const merged = await gitOk(
      ['merge-base', '--is-ancestor', out.branch, lease.base],
      lease.repo_root,
    );
    if (merged) {
      await git(['branch', '-D', out.branch], lease.repo_root);
      out.branch_deleted = true;
    }
  }
  return out;
}

/**
 * Release a holder's worktree.
 * - merged: remove it and delete its branch (it is merged into the base).
 * - abandoned: remove it; the branch stays, since it holds unmerged work.
 * - failed: keep it for inspection, and remove the oldest failed ones beyond
 *   `failed_worktrees_kept`.
 * A worktree adopted from the harness is released but not removed, unless `removeAdopted` asks
 * for it once its branch has merged (teardown.mjs).
 * @param {WorktreeContext} ctx
 * @param {{ holder: string, result: 'merged' | 'abandoned' | 'failed', removeAdopted?: boolean }} request
 */
export async function releaseWorktree(ctx, request) {
  const holder = checkHolder(request.holder);
  if (!['merged', 'abandoned', 'failed'].includes(request.result)) {
    throw new Error(`result must be merged, abandoned or failed, not "${request.result}"`);
  }
  return updateRegistry(ctx.store, async (registry) => {
    const lease = registry.worktrees[holder];
    if (!lease)
      return { released: false, kept: false, removed: [], pruned: [], links_unlinked: [] };
    /** @type {string[]} */
    const pruned = [];
    if (request.result === 'failed' && !lease.adopted) {
      lease.state = 'failed';
      lease.failed_at = new Date().toISOString();
      const failed = Object.values(registry.worktrees)
        .filter((l) => l.state === 'failed' && !l.adopted)
        .sort((a, b) => String(a.failed_at).localeCompare(String(b.failed_at)));
      for (const old of failed.slice(
        0,
        Math.max(0, failed.length - ctx.settings.failedWorktreesKept),
      )) {
        await removeFromDisk(old, false);
        delete registry.worktrees[old.holder];
        pruned.push(old.holder);
        logEvent(ctx.store, 'worktree_pruned', { holder: old.holder, path: old.path });
      }
      const kept = !pruned.includes(holder);
      logEvent(ctx.store, 'worktree_released', { holder, result: 'failed', kept });
      return { released: true, kept, path: lease.path, removed: [], pruned, links_unlinked: [] };
    }
    /** @type {Awaited<ReturnType<typeof removeFromDisk>> | null} */
    let removed = null;
    const removing =
      !lease.adopted || (request.removeAdopted === true && request.result === 'merged');
    if (removing) removed = await removeFromDisk(lease, request.result === 'merged');
    delete registry.worktrees[holder];
    logEvent(ctx.store, 'worktree_released', { holder, result: request.result, ...removed });
    return {
      released: true,
      kept: !removing,
      path: lease.path,
      removed: removed ? [lease.path] : [],
      saved_uncommitted: removed?.saved ?? false,
      links_unlinked: removed?.links_unlinked ?? [],
      branch: removed?.branch ?? lease.branch,
      branch_deleted: removed?.branch_deleted ?? false,
      pruned,
    };
  });
}
