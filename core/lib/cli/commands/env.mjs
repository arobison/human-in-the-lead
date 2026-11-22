// Piece (c): the environment resource manager (design part 13.2).
//
// Every command takes the dispatch that holds what it asks for (--dispatch, such as D-12), and answers in JSON. The library is
// core/lib/env/; these are thin wrappers over it.

import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { realPath } from '../../env/fsx.mjs';
import { basename, dirname, join } from 'node:path';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { POLICY_PATH, findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { loadEffectivePolicy } from '../../settings/layers.mjs';
import { readPrimaryCheckout } from '../../env/primary.mjs';
import { openEnv } from '../../env/manager.mjs';
import { splitCommand } from '../../env/secrets.mjs';
import { INCLUDE_FILE, missingIncluded } from '../../env/include.mjs';

/**
 * Open the manager for the project at the working directory.
 * @param {import('../table.mjs').CommandContext} ctx
 * @returns {{ env: ReturnType<typeof openEnv>, cwd: string } | { error: import('../table.mjs').CommandResult }}
 */
function open(ctx) {
  // Policy, tasks and scripts come from the primary checkout, which the owner controls, never from
  // the executor's worktree, whose copy of policy.json the executor could have edited.
  const repoRoot = primaryCheckout(ctx.cwd);
  if (!repoRoot) {
    return {
      error: {
        ok: false,
        error: 'not-a-repository',
        message: `${ctx.cwd} is not in a git repository`,
      },
    };
  }
  // The machine's port range, worktree root and secret provider layered over the project's
  // (design part 13.4).
  const loaded = loadEffectivePolicy({ cwd: repoRoot, env: ctx.env });
  if (!loaded.policy) {
    return {
      error: {
        ok: false,
        error: 'policy',
        message: loaded.project
          ? 'a settings file is invalid; run hitld config explain'
          : 'policy.json is missing or invalid; run hitld check policy',
        errors: loaded.errors,
      },
    };
  }
  const store = openStore(privateStorePath(loaded.policy.project.id, { env: ctx.env, repoRoot }));
  return {
    env: openEnv({
      repoRoot,
      store,
      policy: loaded.policy,
      env: ctx.env,
      capacity: loaded.layers?.machine?.capacity,
    }),
    cwd: repoRoot,
  };
}

/**
 * The primary checkout of the repository that holds `dir`: where the main worktree lives, even
 * when `dir` is inside a linked worktree.
 * @param {string} dir @returns {string | null}
 */
function primaryCheckout(dir) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (basename(common) === '.git') return dirname(common);
  } catch {
    // not a git repository
  }
  return findRepoRoot(dir);
}

/**
 * Open the manager for `env exec`, which hands out secrets and so trusts nothing the caller can
 * influence. The project comes from HITLD_PROJECT_ID (set by the orchestrator, like HITLD_DISPATCH);
 * the primary checkout's path comes from the record the orchestrator wrote in that project's
 * private store at run start; policy is loaded from that path alone and must agree with the
 * record. There is no fallback to the working directory, to findRepoRoot or to git metadata in
 * the worktree: any failure refuses.
 * @param {import('../table.mjs').CommandContext} ctx
 * @returns {{ env: ReturnType<typeof openEnv> } | { error: import('../table.mjs').CommandResult }}
 */
function openForExec(ctx) {
  /** @param {string} error @param {string} message */
  const refuse = (error, message) => ({ error: { ok: false, error, message } });
  // HITLD_PROJECT is its name before HITLD-82, set by an orchestrator of the previous minor release.
  const projectId = ctx.env.HITLD_PROJECT_ID ?? ctx.env.HITLD_PROJECT;
  if (!projectId) {
    return refuse(
      'project-unknown',
      'HITLD_PROJECT_ID is not set: only a dispatched executor may use a task',
    );
  }
  let store;
  try {
    store = openStore(privateStorePath(projectId, { env: ctx.env }));
  } catch (e) {
    return refuse('project-unknown', `HITLD_PROJECT_ID: ${/** @type {Error} */ (e).message}`);
  }
  const record = readPrimaryCheckout(store);
  if (!record) {
    return refuse(
      'primary-unrecorded',
      `no primary checkout is recorded for ${projectId}; the orchestrator records it when it starts a run (hitld run start)`,
    );
  }
  if (record.project_id !== projectId) {
    return refuse(
      'primary-mismatch',
      `the recorded primary checkout belongs to ${record.project_id}, not ${projectId}`,
    );
  }
  const root = record.root;
  try {
    if (realPath(root) !== root || !lstatSync(join(root, '.git')).isDirectory()) {
      return refuse('primary-mismatch', `${root} is not the canonical path of a primary checkout`);
    }
  } catch {
    return refuse('primary-mismatch', `the recorded primary checkout ${root} cannot be read`);
  }
  const policyPath = join(root, POLICY_PATH);
  const loaded = loadPolicy({ path: policyPath, cwd: root });
  if (!loaded.policy) {
    return refuse(
      'policy',
      `policy.json in the primary checkout is invalid: ${loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  let policyReal;
  try {
    policyReal = realPath(policyPath);
  } catch {
    policyReal = null;
  }
  if (policyReal !== policyPath) {
    return refuse('primary-mismatch', `policy.json is not a plain file inside ${root}`);
  }
  if (loaded.policy.project.id !== projectId) {
    return refuse(
      'primary-mismatch',
      `the policy at ${root} is for project ${loaded.policy.project.id}, not ${projectId}`,
    );
  }
  const layered = loadEffectivePolicy({ env: ctx.env, policyResult: loaded });
  if (!layered.policy) {
    return refuse(
      'settings',
      `a settings file is invalid: ${layered.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  return {
    env: openEnv({
      repoRoot: root,
      store,
      policy: layered.policy,
      env: ctx.env,
      capacity: layered.layers?.machine?.capacity,
    }),
  };
}

/**
 * Wrap a command body so it gets the manager, or the error that stopped it opening.
 * @param {(input: Record<string, any>, env: ReturnType<typeof openEnv>, ctx: import('../table.mjs').CommandContext, repoRoot: string) => Promise<import('../table.mjs').CommandResult> | import('../table.mjs').CommandResult} body
 * @returns {NonNullable<import('../table.mjs').Command['run']>}
 */
const withEnv = (body) => (input, ctx) => {
  const opened = open(ctx);
  if ('error' in opened) return opened.error;
  return body(input, opened.env, ctx, opened.cwd);
};

/** @param {unknown} value @returns {string[]} */
const nameList = (value) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'env setup',
    summary:
      'Create a worktree for a holder from the tip of main (or adopt one the harness made) and run the declared setup in it',
    built_by: 'c',
    args: [
      {
        name: 'dispatch',
        type: 'string',
        required: true,
        description: 'The dispatch ID that holds the worktree, such as D-12',
      },
      {
        name: 'item',
        type: 'string',
        description:
          'The work item ID, such as W-41; names the branch. Needed unless --adopt is given',
      },
      {
        name: 'slug',
        type: 'string',
        description: 'A few words for the branch name; default "work"',
      },
      {
        name: 'base',
        type: 'string',
        description: 'The branch to cut from; default policy.json merge.main_branch',
      },
      {
        name: 'adopt',
        type: 'string',
        description:
          'The path of a worktree the harness already created: record it and set it up; it is removed only once its branch has merged',
      },
    ],
    run: withEnv(async (input, env) => {
      const holder = String(input.dispatch);
      if (!input.item && !input.adopt) {
        return {
          ok: false,
          error: 'usage',
          message:
            "give --item (to create a worktree) or --adopt <path> (to take over the harness's)",
        };
      }
      const made = input.adopt
        ? await env.adoptWorktree({ holder, path: String(input.adopt) })
        : await env.createWorktree({
            holder,
            itemId: String(input.item),
            slug: input.slug ? String(input.slug) : undefined,
            base: input.base ? String(input.base) : undefined,
          });
      const setup = await env.runSetup({ holder });
      const { lease } = made;
      return {
        ok: setup.ok,
        ...(setup.ok
          ? {}
          : {
              error: 'setup-failed',
              message:
                'worktree setup failed; the worktree is kept so the failure can be inspected',
            }),
        holder,
        path: lease.path,
        branch: lease.branch,
        existing: made.existing,
        adopted: lease.adopted,
        setup,
      };
    }),
  },
  {
    name: 'env check',
    summary:
      'Check a worktree has what it needs: each git-ignored file .worktreeinclude lists, named by path (contents are never read out)',
    built_by: 'c',
    args: [
      {
        name: 'dispatch',
        type: 'string',
        description: "The dispatch whose worktree to check; default the current directory's",
      },
    ],
    run: withEnv(async (input, env, ctx, repoRoot) => {
      let worktree;
      if (input.dispatch) {
        const lease = env.registry().worktrees[String(input.dispatch)];
        if (!lease) {
          return {
            ok: false,
            error: 'no-worktree',
            message: `${input.dispatch} holds no worktree`,
          };
        }
        worktree = lease.path;
      } else {
        worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: ctx.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      }
      const include = await missingIncluded({ primary: repoRoot, worktree });
      const ok = include.missing.length === 0;
      return {
        ok,
        ...(ok
          ? {}
          : {
              error: 'include-missing',
              message: `the worktree lacks ${include.missing.length} file(s) ${INCLUDE_FILE} lists: ${include.missing.join(', ')}; hitld env setup copies them`,
            }),
        worktree: realPath(worktree),
        include,
      };
    }),
  },
  {
    name: 'env cleanup',
    summary:
      'Release everything a holder has: its worktree, its port (stopping only a server the manager started) and its locks',
    built_by: 'c',
    args: [
      { name: 'dispatch', type: 'string', required: true, description: 'The dispatch ID' },
      {
        name: 'result',
        type: 'string',
        required: true,
        description:
          'merged (remove the worktree and its merged branch), abandoned (remove the worktree, keep the branch) or failed (keep the worktree for inspection)',
      },
    ],
    run: withEnv(async (input, env) => {
      const result = String(input.result);
      if (!['merged', 'abandoned', 'failed'].includes(result)) {
        return {
          ok: false,
          error: 'usage',
          message: '--result must be merged, abandoned or failed',
        };
      }
      const released = await env.releaseHolder({
        holder: String(input.dispatch),
        result: /** @type {'merged' | 'abandoned' | 'failed'} */ (result),
      });
      return { ok: true, holder: String(input.dispatch), ...released };
    }),
  },
  {
    name: 'env port lease',
    summary:
      'Lease a free dev-server port from the policy range, optionally starting a server on it; ports in use by anything else are skipped',
    built_by: 'c',
    args: [
      { name: 'dispatch', type: 'string', required: true, description: 'The dispatch ID' },
      {
        name: 'serve',
        type: 'string',
        description: 'A command to start as the dev server; it gets the port as PORT',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Where the server runs; default the current directory',
      },
    ],
    run: withEnv(async (input, env, ctx) => {
      const holder = String(input.dispatch);
      const leased = await env.leasePort({ holder });
      let server = leased.lease.server;
      if (input.serve) {
        server = (
          await env.startServer({
            holder,
            argv: splitCommand(String(input.serve)),
            cwd: input.cwd ? String(input.cwd) : ctx.cwd,
          })
        ).server;
      }
      return {
        ok: true,
        holder,
        port: leased.lease.port,
        existing: leased.existing,
        skipped_in_use: leased.skipped,
        server: server && { pid: server.pid, cwd: server.cwd },
      };
    }),
  },
  {
    name: 'env port free',
    summary:
      "Free a dispatch's port, stopping its server only if the manager started that exact process",
    built_by: 'c',
    args: [{ name: 'dispatch', type: 'string', required: true, description: 'The dispatch ID' }],
    run: withEnv(async (input, env) => ({
      ok: true,
      ...(await env.releasePort({ holder: String(input.dispatch) })),
    })),
  },
  {
    name: 'env lock',
    summary: 'Take a machine-wide lock on a serial resource such as gpu; with --wait, queue for it',
    built_by: 'c',
    args: [
      {
        name: 'resource',
        type: 'string',
        required: true,
        description: 'A resource named in policy env.serial_resources',
      },
      { name: 'dispatch', type: 'string', required: true, description: 'The dispatch ID' },
      {
        name: 'weight',
        type: 'integer',
        description:
          "Units of the resource's capacity to take (machine profile capacity; default 1). A resource with no capacity entry takes 1",
      },
      {
        name: 'wait',
        type: 'boolean',
        description: 'Queue behind earlier arrivals until the lock is free',
      },
      {
        name: 'timeout-seconds',
        type: 'integer',
        description: 'With --wait, give up after this long',
      },
      {
        name: 'ttl-seconds',
        type: 'integer',
        description:
          'Expiry if not renewed; default env.lock_expiry_seconds. Asking again as the holder renews',
      },
      {
        name: 'pid',
        type: 'integer',
        description:
          "The process whose life the lock follows; default the caller's parent. The lock is stale once it is gone",
      },
    ],
    run: withEnv(async (input, env) => {
      const r = await env.acquireLock({
        resource: String(input.resource),
        holder: String(input.dispatch),
        weight: typeof input.weight === 'number' ? input.weight : undefined,
        pid: typeof input.pid === 'number' ? input.pid : process.ppid,
        wait: input.wait === true,
        timeoutMs:
          typeof input['timeout-seconds'] === 'number'
            ? input['timeout-seconds'] * 1000
            : undefined,
        ttlSeconds: typeof input['ttl-seconds'] === 'number' ? input['ttl-seconds'] : undefined,
        autoRenew: false,
      });
      return r.acquired
        ? {
            ok: true,
            resource: r.record.resource,
            holder: r.record.holder,
            ...(r.record.weight === undefined ? {} : { weight: r.record.weight }),
            expires_at: r.record.expires_at,
            waited_ms: r.waited_ms,
          }
        : {
            ok: false,
            error: r.timed_out ? 'lock-timeout' : 'lock-held',
            message: `${input.resource} is held by ${r.held_by?.holder ?? 'someone else'}`,
            held_by: r.held_by?.holder ?? null,
            waited_ms: r.waited_ms,
          };
    }),
  },
  {
    name: 'env unlock',
    summary: 'Release a lock the holder has',
    built_by: 'c',
    args: [
      { name: 'resource', type: 'string', required: true, description: 'The resource' },
      {
        name: 'dispatch',
        type: 'string',
        required: true,
        description: 'The dispatch ID that holds it',
      },
    ],
    run: withEnv((input, env) => {
      const r = env.releaseLock({
        resource: String(input.resource),
        holder: String(input.dispatch),
      });
      return { ok: r.released, ...r };
    }),
  },
  {
    name: 'env status',
    summary:
      'Show the worktrees, ports and locks the manager holds, and the time spent waiting for locks',
    built_by: 'c',
    run: withEnv((_input, env) => {
      const registry = env.registry();
      return {
        ok: true,
        worktrees: Object.values(registry.worktrees),
        ports: Object.values(registry.ports),
        locks: env.lockStatus(),
        lock_waits: env.lockWaits(),
      };
    }),
  },
  {
    name: 'env exec',
    summary:
      'Run a secret task declared in policy.json with its secrets injected into its environment only; output is filtered for their values',
    built_by: 'c',
    mcp: false,
    args: [
      {
        name: 'task',
        type: 'string',
        positional: true,
        required: true,
        description:
          "The name of a task in policy env.secret_tasks. The command, the secrets and the roles allowed are the owner's, not the caller's; the role is read from the dispatch named in HITLD_DISPATCH",
      },
      {
        name: 'timeout-seconds',
        type: 'integer',
        description: 'Stop the task after this long; default 600',
      },
    ],
    run: (input, ctx) => {
      const opened = openForExec(ctx);
      if ('error' in opened) return opened.error;
      return opened.env.execTask({
        task: String(input.task),
        dispatch: ctx.env.HITLD_DISPATCH,
        callerCwd: ctx.cwd,
        timeoutMs:
          typeof input['timeout-seconds'] === 'number'
            ? input['timeout-seconds'] * 1000
            : undefined,
      });
    },
  },
];
