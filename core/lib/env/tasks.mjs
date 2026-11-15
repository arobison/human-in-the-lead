// Secret tasks (design part 13.2). A secret is usable only through a task the owner declared in
// policy.json (env.secret_tasks): a fixed command, the roles that may run it, and the secrets it
// receives. The caller supplies a task name and nothing else:
//
//   - the command comes from the policy, never from the caller;
//   - the role comes from the dispatch record the orchestrator wrote, found by the dispatch ID in
//     HITLD_DISPATCH, never from anything the caller asserts;
//   - the child's environment is built here, from a short allowlist, so a caller cannot slip a
//     NODE_OPTIONS, LD_PRELOAD or PATH into the process that holds the secrets.
//
// What this does not stop: an agent that can read another live dispatch's ID can borrow it, and so
// borrow that role's tasks. Closing that is the harness sandbox's job (a later milestone).

import { statSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { readLedger } from '../ledger/ledger.mjs';
import { liveDispatch } from '../ledger/inflight.mjs';
import { checkHolder } from './config.mjs';
import { logEvent } from './registry.mjs';
import { belongsToPrimary } from './primary.mjs';
import { runWithSecrets } from './secrets.mjs';

/**
 * @typedef {import('./config.mjs').EnvSettings} EnvSettings
 * @typedef {import('./config.mjs').SecretTask} SecretTask
 * @typedef {import('./secrets.mjs').SecretReader} SecretReader
 */

/**
 * The live dispatch with this ID, from the ledger through the ledger module's own check: dispatched
 * by the orchestrator under the current run, accepted by the harness (claimed), and not yet
 * reported, abandoned or released.
 *
 * This trusts the ledger's dispatch records, which only the run module writes (raw appends of
 * `dispatched`, `claimed`, `run-started` and `lease-taken` are refused to everyone else).
 * @param {import('./registry.mjs').PrivateStore} store
 * @param {string | undefined} id
 * @returns {{ ok: true, dispatch: string, role: string, worktree: string | null }
 *   | { ok: false, reason: string }}
 */
export function dispatchRecord(store, id) {
  if (!id)
    return {
      ok: false,
      reason: 'HITLD_DISPATCH is not set: only a dispatched executor may use a task',
    };
  try {
    checkHolder(id);
  } catch {
    return { ok: false, reason: 'HITLD_DISPATCH is not a dispatch ID' };
  }
  const { events } = readLedger(store);
  const run = events.findLast((e) => e.event === 'run-started')?.run;
  if (!run) return { ok: false, reason: 'no run has been started' };
  const d = liveDispatch(events, id, run);
  if (!d) {
    return {
      ok: false,
      reason: `dispatch ${id} is not live in run ${run} (unknown, not yet claimed by a harness, or finished)`,
    };
  }
  if (typeof d.role !== 'string') return { ok: false, reason: `dispatch ${id} has no role` };
  return { ok: true, dispatch: id, role: d.role, worktree: d.worktree ?? null };
}

/** The variables a task's process may inherit; everything else is dropped. */
const INHERIT = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TERM'];
const SAFE_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/**
 * The environment a task's process starts with: a few harmless variables from the caller and a
 * fixed PATH. Anything that can load code into the process (NODE_OPTIONS, LD_PRELOAD,
 * DYLD_INSERT_LIBRARIES, BASH_ENV, a PATH of the caller's choosing) is not inherited.
 * @param {string} program @param {NodeJS.ProcessEnv} from
 * @returns {NodeJS.ProcessEnv}
 */
function taskEnv(program, from) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const k of INHERIT) if (from[k] !== undefined) out[k] = from[k];
  out.PATH = [dirname(program), ...SAFE_PATH].join(':');
  return out;
}

/**
 * Whether `path` is `root` or inside it, once both are resolved.
 * @param {string} root @param {string} path
 */
function isInside(root, path) {
  try {
    const p = realpathSync(path);
    return p === root || inside(root, p);
  } catch {
    return false;
  }
}

/** @param {string} root @param {string} path */
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * The exact argv of a task, or why the declaration cannot be run.
 * @param {SecretTask} task @param {string} primaryRoot
 * @returns {{ argv: string[] } | { error: string }}
 */
function commandOf(task, primaryRoot) {
  if (task.argv && task.repo_script) return { error: 'declares both argv and repo_script' };
  if (task.argv) {
    if (!isAbsolute(task.argv[0])) {
      return { error: "argv[0] must be an absolute path, so the caller's PATH cannot redirect it" };
    }
    return { argv: task.argv };
  }
  if (task.repo_script) {
    try {
      const root = realpathSync(primaryRoot);
      const path = realpathSync(resolve(root, task.repo_script));
      if (!inside(root, path)) return { error: 'repo_script leaves the repository' };
      if (!statSync(path).isFile()) return { error: 'repo_script is not a file' };
      return { argv: [path] };
    } catch {
      return { error: 'repo_script does not exist in the primary checkout' };
    }
  }
  return { error: 'declares neither argv nor repo_script' };
}

/**
 * Run a declared task for a live dispatch.
 *
 * Refused, and logged without any value, when the task is not declared, the dispatch is missing,
 * not live or has no role, the role has no grant for the task, or the dispatch's worktree is not a
 * linked worktree of the primary checkout, or the caller is not inside it.
 * @param {{ store: import('./registry.mjs').PrivateStore, settings: EnvSettings, read: SecretReader,
 *   primaryRoot: string }} ctx
 * @param {{ task: string, dispatch: string | undefined, callerCwd: string, env: NodeJS.ProcessEnv,
 *   timeoutMs?: number }} request
 */
export async function execTask(ctx, request) {
  const { task: name, dispatch: dispatchId } = request;
  /** @param {string} error @param {string} message @param {Record<string, unknown>} [extra] */
  const refuse = (error, message, extra = {}) => {
    logEvent(ctx.store, 'secret_refused', {
      task: name,
      dispatch: dispatchId ?? null,
      reason: error,
    });
    return { ok: false, error, message, ...extra };
  };

  const task = ctx.settings.secretTasks.find((t) => t.task === name);
  if (!task) {
    return refuse(
      'task-undeclared',
      `"${name}" is not a task declared in policy.json env.secret_tasks. Only declared tasks may use secrets; ask the owner to declare one.`,
    );
  }
  const who = dispatchRecord(ctx.store, dispatchId);
  if (!who.ok) return refuse('not-a-dispatch', who.reason);
  if (!task.roles.includes(who.role)) {
    return refuse('task-not-granted', `role "${who.role}" has no grant for task "${name}"`);
  }
  // The dispatch's recorded worktree must be a real worktree of the primary checkout (judged from
  // the primary's own metadata, not the worktree's), and the caller must be running inside it. So
  // a rewritten .git file, or a borrowed dispatch ID used from elsewhere, gets nothing.
  if (!who.worktree) {
    return refuse('worktree-mismatch', `dispatch ${who.dispatch} has no recorded worktree`);
  }
  const owned = belongsToPrimary(ctx.primaryRoot, who.worktree);
  if (!owned.ok) return refuse('worktree-mismatch', owned.reason);
  if (!isInside(owned.worktree, request.callerCwd)) {
    return refuse(
      'worktree-mismatch',
      `the caller is not inside dispatch ${who.dispatch}'s worktree ${owned.worktree}`,
    );
  }
  const command = commandOf(task, ctx.primaryRoot);
  if ('error' in command) return refuse('task-invalid', `task "${name}" ${command.error}`);

  const cwd = task.cwd === 'worktree' ? owned.worktree : ctx.primaryRoot;
  return runWithSecrets(
    { store: ctx.store, read: ctx.read },
    {
      argv: command.argv,
      cwd,
      names: task.secrets,
      env: taskEnv(command.argv[0], request.env),
      timeoutMs: request.timeoutMs,
      audit: { task: name, role: who.role, dispatch: who.dispatch },
    },
  );
}
