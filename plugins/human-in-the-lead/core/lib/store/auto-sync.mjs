// Automatic store sync (design 0003, section 8): the one place the run commands and the harness
// hooks call to pull the private store from its remote and push it back, so no session has to
// remember to. Another step that belongs beside a pull or a push (a check, a notice) is added here,
// next to `autoPull` and `autoPush`, and the callers stay one line.
//
// Both functions answer with a report and never throw. The caller decides what a report means:
//
//   status 'done'         the pull or push ran; `result` says what it did
//   status 'skipped'      nothing to do, and not an error: no remote is configured (`no-remote`,
//                         or `remote-required` when policy.json says the project expects one),
//                         this device has no key (`no-identity`), the caller is an executor
//                         (`executor`), the project has no valid policy (`no-project`), or the
//                         store holds no text yet (`nothing-to-push`)
//   status 'unreachable'  the remote could not be reached; the local store is as it was
//   status 'failed'       the remote answered and what it holds could not be used, or a push was
//                         refused: it does not decrypt or merge, the device is not enrolled, the
//                         head is not an age file, a merge conflict
//
// Run start and resume stop on a failed pull and go on after an unreachable one. A push that is
// unreachable or failed is reported and never stops the command: the work is already in the local
// store, and the next push carries it. The hooks print the report's one line and never block.
//
// Executors never sync (the guard that keeps store commands the owner's applies here too), so the
// hooks, which run for every session, skip them.
//
// The push and pull code (and node:sqlite behind it) is loaded only once a remote is configured.

import { executorSignal } from '../cli/executor.mjs';
import { ownerCheckoutOf } from '../env/primary.mjs';
import { loadPolicy } from '../policy/policy.mjs';
import { privateStorePath } from './store.mjs';
import { NO_ADDRESS, chooseRemote } from './address.mjs';
import { UNREACHABLE_CODES, cause, causesLine, failureCauses } from './reach.mjs';
import { recordPull } from './last-pull.mjs';

/**
 * @typedef {object} SyncContext
 * @property {string} store the private store's directory
 * @property {string | null} projectId policy.json project.id; null when there is no valid policy
 * @property {boolean} remoteRequired policy.json store.remote.required
 * @property {string} checkout the project's checkout
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd where the command or hook runs, for the executor check
 * @property {() => Date} [now] for tests
 *
 * @typedef {object} SyncReport
 * @property {'pull' | 'push'} action
 * @property {'done' | 'skipped' | 'unreachable' | 'failed'} status
 * @property {string} [result] done: what happened (pull: empty, up-to-date, merged, fast-forward;
 *   push: pushed, up-to-date)
 * @property {'no-remote' | 'remote-required' | 'no-identity' | 'executor' | 'no-project' | 'nothing-to-push' | 'no-sync'} [reason]
 *   skipped: why (`no-sync`: the caller passed --no-sync; `remote-required`: no address is set,
 *   and policy.json store.remote.required is true)
 * @property {{ code: string, message: string, conflicts?: unknown }} [error] unreachable or
 *   failed: what went wrong
 * @property {import('./reach.mjs').Cause[]} [causes] unreachable, failed, or skipped for want of
 *   a key or an address: which named causes apply and what fixes each (reach.mjs)
 * @property {{ url: string, source: string }} [remote]
 * @property {string} line one line saying what happened, for a hook to print
 */

/** Remote codes that mean the remote could not be reached, as opposed to it answering badly. */
const UNREACHABLE = UNREACHABLE_CODES;

/**
 * The sync context of the project a command or hook runs in, from its policy.json.
 * @param {string} cwd @param {NodeJS.ProcessEnv} env @param {() => Date} [now]
 * @param {string} [store] a store directory the caller was given (--store), instead of the project's
 * @returns {SyncContext | null} null when there is no project here
 */
export function contextFromCwd(cwd, env, now, store) {
  const checkout = ownerCheckoutOf(cwd);
  if (!checkout) return null;
  const loaded = loadPolicy({ cwd: checkout });
  if (!loaded.policy) return null;
  const projectId = loaded.policy.project.id;
  return {
    store: store ?? privateStorePath(projectId, { env, repoRoot: checkout }),
    projectId,
    remoteRequired: loaded.policy.store?.remote?.required === true,
    checkout,
    env,
    cwd,
    ...(now ? { now } : {}),
  };
}

/**
 * @param {SyncReport['action']} action @param {NonNullable<SyncReport['reason']>} reason
 * @param {string} why
 * @param {import('./reach.mjs').Cause[]} [causes]
 * @returns {SyncReport}
 */
const skipped = (action, reason, why, causes) => ({
  action,
  status: 'skipped',
  reason,
  ...(causes ? { causes } : {}),
  line: `store ${action} skipped: ${why}`,
});

/**
 * @param {SyncReport['action']} action @param {unknown} e
 * @param {{ conflicts?: unknown, env?: NodeJS.ProcessEnv, url?: string | null, devices?: { identity: string | null, enrolled: boolean } | null }} [more]
 *   env and devices: to name the cause of an unreachable remote or a key that does not open it
 * @returns {SyncReport}
 */
function problem(action, e, more = {}) {
  const code =
    typeof (/** @type {any} */ (e)?.code) === 'string' ? /** @type {any} */ (e).code : 'failed';
  const message = e instanceof Error ? e.message : String(e);
  const unreachable = UNREACHABLE.has(code);
  const causes = more.env
    ? failureCauses(
        { code, message },
        { env: more.env, url: more.url ?? null, devices: more.devices ?? null },
      )
    : [];
  const named = causes.length ? `${causesLine(causes)}. ` : '';
  return {
    action,
    status: unreachable ? 'unreachable' : 'failed',
    error: { code, message, ...(more.conflicts ? { conflicts: more.conflicts } : {}) },
    ...(causes.length ? { causes } : {}),
    line: unreachable
      ? `store ${action}: the remote could not be reached (${causes[0]?.cause ?? message}). ${named}Working on the local store`
      : `store ${action} failed (${code}): ${message}${named ? `. ${named.trimEnd()}` : ''}`,
  };
}

/**
 * A pull or push that came back not ok (a merge conflict): a failure with the conflict's paths.
 * @param {SyncReport['action']} action @param {Record<string, any>} result
 * @param {SyncContext} c
 */
const refused = (action, result, c) =>
  problem(
    action,
    Object.assign(new Error(String(result.message)), { code: String(result.error) }),
    { conflicts: result.conflicts, env: c.env },
  );

/**
 * What both directions share: whether this caller may sync at all, and the remote and this
 * device's key. Returns a skip report, or what the move needs.
 * @param {SyncReport['action']} action @param {SyncContext} c
 */
async function prepare(action, c) {
  const why = executorSignal(c.env, c.cwd);
  if (why) return { skip: skipped(action, 'executor', `${why}; executors never sync the store`) };
  if (!c.projectId) {
    return { skip: skipped(action, 'no-project', 'there is no valid policy.json here') };
  }
  const address = chooseRemote({ store: c.store, projectId: c.projectId, env: c.env });
  if (!address) {
    return {
      skip: c.remoteRequired
        ? skipped(
            action,
            'remote-required',
            `policy.json store.remote.required is true, and ${NO_ADDRESS}`,
            [cause('no-remote')],
          )
        : skipped(action, 'no-remote', 'no store remote is configured'),
    };
  }
  const pp = await import('./push-pull.mjs');
  const lookup = { store: c.store, env: c.env, projectId: c.projectId };
  // A device with no key at all is not an error: a machine that never enrolled still works on its
  // own store. A key that is set but broken is, and the pull or push says so.
  const here = pp.devicesHere(lookup);
  if (!here.identity && !here.key_source) {
    return {
      skip: skipped(
        action,
        'no-identity',
        'this device has no key (hitld store device init, or HITLD_STORE_IDENTITY)',
        [cause('device-no-key')],
      ),
    };
  }
  const { remote, url, source } = pp.openRemote(c.store, address);
  return { pp, lookup, here, remote, url, source, projectId: c.projectId };
}

/**
 * Pull the remote's head into the store and merge it, before a run reads its state.
 * @param {SyncContext} c
 * @returns {Promise<SyncReport>}
 */
export async function autoPull(c) {
  /** @type {{ identity: string | null, enrolled: boolean } | null} */
  let devices = null;
  /** @type {string | null} */
  let remoteUrl = null;
  try {
    const p = await prepare('pull', c);
    if (p.skip) return p.skip;
    devices = p.here;
    remoteUrl = p.url;
    const { pp, here, remote, url, source, projectId } = p;
    const result = /** @type {Record<string, any>} */ (
      await pp.pullStore({ root: c.store, projectId, remote, url, devices: here })
    );
    if (!result.ok) {
      return refused('pull', result, c);
    }
    const what = String(result.result);
    return {
      action: 'pull',
      status: 'done',
      result: what,
      remote: { url, source },
      line: `store pull: ${
        what === 'empty'
          ? 'the remote is empty'
          : what === 'up-to-date'
            ? 'up to date with the remote'
            : 'merged the remote into the local store'
      }`,
    };
  } catch (e) {
    // A pull that stopped before it reached pullStore (the address or this device's key would not
    // open) is recorded too, so an older `done` does not stand for it.
    const code =
      typeof (/** @type {any} */ (e)?.code) === 'string'
        ? String(/** @type {any} */ (e).code)
        : 'failed';
    recordPull(c.store, {
      status: UNREACHABLE_CODES.has(code) ? 'unreachable' : 'failed',
      ...(remoteUrl ? { url: remoteUrl } : {}),
      code,
      message: e instanceof Error ? e.message : String(e),
    });
    return problem('pull', e, { env: c.env, url: remoteUrl, devices });
  }
}

/**
 * Push the store to the remote, encrypted to the devices the owner approved. The remote's head is
 * brought in first, so a device the owner removed elsewhere is not sealed to.
 * @param {SyncContext} c
 * @returns {Promise<SyncReport>}
 */
export async function autoPush(c) {
  /** @type {{ identity: string | null, enrolled: boolean } | null} */
  let devices = null;
  /** @type {string | null} */
  let remoteUrl = null;
  try {
    const p = await prepare('push', c);
    if (p.skip) return p.skip;
    devices = p.here;
    remoteUrl = p.url;
    const { pp, lookup, remote, url, source, projectId } = p;
    const result = /** @type {Record<string, any>} */ (
      await pp.pushStore({
        root: c.store,
        projectId,
        remote,
        url,
        devices: pp.devicesForPush(lookup),
        refresh: () => pp.devicesHere(lookup),
        ...(c.now ? { now: c.now } : {}),
      })
    );
    if (!result.ok) {
      return refused('push', result, c);
    }
    const what = String(result.result);
    return {
      action: 'push',
      status: 'done',
      result: what,
      remote: { url, source },
      line: `store push: ${what === 'up-to-date' ? 'the remote is up to date' : 'pushed the store to the remote'}`,
    };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'nothing-to-push') {
      return skipped('push', 'nothing-to-push', 'the store holds no text yet');
    }
    return problem('push', e, { env: c.env, url: remoteUrl, devices });
  }
}

/**
 * Reasons nothing is said for: the project does not use a remote here, or the caller is not the
 * owner's. A command leaves them out of its result, and a hook prints nothing.
 */
const QUIET = new Set(['no-remote', 'executor', 'no-project']);

/**
 * The report a command puts in its result, or null when it has nothing to say.
 * @param {SyncReport | null} report
 * @returns {SyncReport | null}
 */
export const visible = (report) =>
  report && report.status === 'skipped' && report.reason && QUIET.has(report.reason)
    ? null
    : report;

/**
 * `run start` and `run resume` stopped on a pull: the remote answered, but what it holds does not
 * open or merge. Starting would build on a store that is missing what the remote has, and the next
 * push would then collide with it. An unreachable remote is not this: the run goes on locally.
 */
export class SyncRefused extends Error {
  /** @param {string} command @param {SyncReport} report */
  constructor(command, report) {
    const e = report.error ?? { code: 'failed', message: 'the pull failed' };
    const named = report.causes?.length ? ` (${causesLine(report.causes)})` : '';
    super(
      `hitld ${command} stopped: the store remote answered, but its head could not be used (${e.code}): ${e.message}${named}. Fix that and run it again, or pass --no-sync to go on with the local store`,
    );
    this.name = 'SyncRefused';
    this.code = 'store-pull-refused';
    this.report = report;
  }
}

/**
 * The pull `run start` and `run resume` begin with. Returns the report to show, or null when there
 * is nothing to say. Throws `SyncRefused` when the remote answered and its head cannot be used.
 * @param {string} command `run start` or `run resume`
 * @param {Record<string, unknown>} input
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, now?: () => Date }} ctx
 * @returns {Promise<SyncReport | null>}
 */
export async function pullBeforeRun(command, input, ctx) {
  if (input['no-sync'] === true) {
    return {
      action: 'pull',
      status: 'skipped',
      reason: 'no-sync',
      line: 'store pull skipped: --no-sync',
    };
  }
  const c = contextFromCwd(
    ctx.cwd,
    ctx.env,
    ctx.now,
    /** @type {string | undefined} */ (input.store),
  );
  if (!c) return null;
  const report = await autoPull(c);
  if (report.status === 'failed') throw new SyncRefused(command, report);
  return visible(report);
}

/**
 * Wrap a command so that, once it has run, it pushes the store and says so in its result under
 * `store_sync.push`. A command that refused (its result has an `error`) pushes nothing. A push that
 * could not be made is in the result and never changes the command's own outcome.
 * @param {NonNullable<import('../cli/table.mjs').Command['run']>} run
 * @returns {NonNullable<import('../cli/table.mjs').Command['run']>}
 */
export function pushAfter(run) {
  return async (input, ctx) => {
    const result = await run(input, ctx);
    if (!result || typeof result !== 'object' || 'error' in result) return result;
    const c = contextFromCwd(
      ctx.cwd,
      ctx.env,
      ctx.now,
      /** @type {string | undefined} */ (input.store),
    );
    const push = c ? visible(await autoPush(c)) : null;
    if (!push) return result;
    const before = /** @type {Record<string, unknown> | undefined} */ (result.store_sync);
    return { ...result, store_sync: { ...before, push } };
  };
}

/**
 * The command table with `pushAfter` applied to the named commands.
 * @param {import('../cli/table.mjs').Command[]} commands @param {string[]} names
 * @returns {import('../cli/table.mjs').Command[]}
 */
export const pushingAfter = (commands, names) =>
  commands.map((c) => (c.run && names.includes(c.name) ? { ...c, run: pushAfter(c.run) } : c));

/**
 * What a harness hook does: sync in one direction and return the one line to print, or null when
 * there is nothing to say. Never throws.
 * @param {'pull' | 'push'} action
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} where
 * @returns {Promise<string | null>}
 */
export async function hookSync(action, where) {
  try {
    const c = contextFromCwd(where.cwd, where.env);
    if (!c) return null;
    const r = await (action === 'pull' ? autoPull(c) : autoPush(c));
    return visible(r) ? r.line : null;
  } catch (e) {
    return `store ${action} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
