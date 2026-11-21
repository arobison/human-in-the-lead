// The environment resource manager (design part 13.2): one object over the registry, worktrees,
// ports, locks and secrets, with every allocation tied to a holder (a dispatch ID). This is the
// seam piece (h)'s dispatch planner uses.

import { realPath } from './fsx.mjs';
import { join } from 'node:path';
import { envSettings } from './config.mjs';
import { siblingEntry } from '../store/data-home.mjs';
import { acquireLock, lockStatus, releaseLock } from './locks.mjs';
import { leasePort, releasePort, startServer } from './ports.mjs';
import { logEvent, readEvents, readRegistry } from './registry.mjs';
import { secretReader, withoutSecrets } from './secrets.mjs';
import { execTask } from './tasks.mjs';
import { adoptWorktree, createWorktree, releaseWorktree, runSetup } from './worktree.mjs';

/**
 * The machine-wide directory for state shared by every project on this machine (the locks). It
 * sits beside the project stores; project IDs cannot start with an underscore, so it cannot clash.
 * @param {string} storeRoot a project's private store directory
 */
export const machineRootFor = (storeRoot) => siblingEntry(storeRoot, '_machine');

/** @param {string} p */
function realpathOr(p) {
  try {
    return realPath(p);
  } catch {
    return p;
  }
}

/**
 * @param {{ repoRoot: string, store: import('../store/store.mjs').PrivateStore,
 *   policy: Record<string, any>, env?: NodeJS.ProcessEnv, machineRoot?: string,
 *   secretReader?: import('./secrets.mjs').SecretReader,
 *   capacity?: Record<string, number> }} options
 *   capacity: the machine profile's capacity per resource (design 13.4); a resource with no
 *   entry has capacity 1
 */
export function openEnv(options) {
  const { repoRoot, store, policy } = options;
  const env = options.env ?? process.env;
  const settings = envSettings(policy);
  const wt = { store, repoRoot, settings };
  const locks = {
    machineRoot: options.machineRoot ?? machineRootFor(store.root),
    repoRoot: realpathOr(repoRoot),
    capacity: options.capacity,
    log: (/** @type {string} */ kind, /** @type {Record<string, unknown>} */ data) =>
      logEvent(store, kind, data),
  };
  const read =
    options.secretReader ??
    secretReader({ provider: settings.secretProvider, projectId: policy.project.id, env });

  /** @param {string} resource */
  const checkSerial = (resource) => {
    if (!settings.serialResources.includes(resource)) {
      throw new Error(
        `"${resource}" is not a serial resource; policy.json env.serial_resources lists: ${settings.serialResources.join(', ') || '(none)'}`,
      );
    }
  };

  return {
    settings,
    registry: () => readRegistry(store),
    events: () => readEvents(store),

    createWorktree: (/** @type {Parameters<typeof createWorktree>[1]} */ r) =>
      createWorktree(wt, r),
    adoptWorktree: (/** @type {Parameters<typeof adoptWorktree>[1]} */ r) => adoptWorktree(wt, r),
    runSetup: (/** @type {Parameters<typeof runSetup>[1]} */ r) =>
      runSetup(wt, { env: withoutSecrets(env), ...r }),
    releaseWorktree: (/** @type {Parameters<typeof releaseWorktree>[1]} */ r) =>
      releaseWorktree(wt, r),

    leasePort: (/** @type {{ holder: string }} */ r) =>
      leasePort({ store, range: settings.portRange }, r),
    startServer: (/** @type {Parameters<typeof startServer>[1]} */ r) =>
      startServer({ store }, { env: withoutSecrets(env), ...r }),
    releasePort: (/** @type {Parameters<typeof releasePort>[1]} */ r) => releasePort({ store }, r),

    /** @param {Omit<Parameters<typeof acquireLock>[1], 'ttlSeconds'> & { ttlSeconds?: number }} r */
    async acquireLock(r) {
      checkSerial(r.resource);
      return await acquireLock(locks, { ttlSeconds: settings.lockExpirySeconds, ...r });
    },
    /** @param {Parameters<typeof releaseLock>[1]} r */
    releaseLock(r) {
      checkSerial(r.resource);
      return releaseLock(locks, r);
    },
    lockStatus: () => lockStatus(locks, settings.serialResources),
    /** Time spent waiting for each serial resource, the sensor for contention (part 11.4). */
    lockWaits() {
      /** @type {Record<string, { waits: number, waited_ms: number }>} */
      const out = {};
      for (const e of readEvents(store)) {
        if (e.kind !== 'lock_wait') continue;
        const r = String(e.resource);
        out[r] ??= { waits: 0, waited_ms: 0 };
        out[r].waits++;
        out[r].waited_ms += Number(e.waited_ms) || 0;
      }
      return out;
    },

    /**
     * Run a task the owner declared in policy.json, with its secrets, for a live dispatch (see
     * tasks.mjs). The caller names the task; the command and the role are not the caller's to give.
     * @param {{ task: string, dispatch: string | undefined, callerCwd: string, timeoutMs?: number }} r
     */
    execTask: (r) => execTask({ store, settings, read, primaryRoot: repoRoot }, { env, ...r }),

    /**
     * Release everything a holder has: its worktree, its port (stopping only a server the
     * manager started), and any locks it holds.
     * @param {{ holder: string, result: 'merged' | 'abandoned' | 'failed', removeAdopted?: boolean }} r
     */
    async releaseHolder(r) {
      const worktree = await releaseWorktree(wt, r);
      const port = await releasePort({ store }, { holder: r.holder });
      const released = lockStatus(locks, settings.serialResources)
        .filter((l) => l.holders.some((h) => h.holder === r.holder))
        .map((l) => {
          releaseLock(locks, { resource: l.resource, holder: r.holder });
          return l.resource;
        });
      return { worktree, port, locks: released };
    },
  };
}
