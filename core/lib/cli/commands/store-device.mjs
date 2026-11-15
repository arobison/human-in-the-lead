// Store devices (design 0003, sections 5, 6 and 9): `hitld store device init | ask | list |
// remove`. Owner only: each refuses an executor, as the other store commands do. Part of the store
// commands (store.mjs lists them).
//
// Who may read the store is the owner's own answer to a device decision, recorded inside the
// private store (devices.mjs). init makes this device's key and puts its request (name and public
// key) on the store repository's hitld-devices branch; that request is never trusted by itself.
// ask, run on a device the owner already approved, turns each request into a decision only the
// owner settles; remove asks the same for a removal. `hitld rights answer`, in the owner's own
// turn, applies the answer. The first device of an empty store asks for itself (the bootstrap).

import { hostname } from 'node:os';
import { loadPolicy } from '../../policy/policy.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { generateIdentity, parseIdentities, recipientOf } from '../../store/age.mjs';
import {
  DEVICES_BRANCH,
  DevicesError,
  IDENTITY_ENV,
  KEYCHAIN_ACCOUNT,
  PROPOSALS_DIR,
  approvedDevices,
  checkName,
  deviceKeychain,
  deviceQuestion,
  fingerprint,
  keychainService,
  nameFromHost,
  openDeviceAsks,
  pendingRequests,
  readApprovals,
  recordApproval,
  requestText,
  requestsOnBranch,
} from '../../store/devices.mjs';
import { resolveDevices } from '../../store/devices-port.mjs';
import { NO_ADDRESS, chooseRemote } from '../../store/address.mjs';
import { legacyWarnings } from '../../store/placement.mjs';
import {
  STORE_BRANCH,
  createDevicesBranch,
  createGitRemote,
  remoteDir,
} from '../../store/remote-git.mjs';
import { ensureRepo } from '../../store/git.mjs';
import { recordDevice } from '../../store/private-terms.mjs';
import { executorSignal } from '../executor.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 * @typedef {import('../../store/devices.mjs').Device} Device
 */

/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory, where the owner's device answers are recorded. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead",
};
/** @type {import('../args.mjs').ArgSpec} */
const PARENT = {
  name: 'parent',
  type: 'string',
  description:
    "The tracker project to file the device decision under. Default: the project's one open project, when there is exactly one",
};

/** @param {string} error @param {string} message @param {Record<string, unknown>} [more] @returns {Result} */
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more });

/**
 * The project: its checkout, policy, private store and the store's address.
 * @param {Record<string, unknown>} input @param {Ctx} ctx
 */
function project(input, ctx) {
  const repoRoot = ownerCheckoutOf(ctx.cwd);
  if (!repoRoot) {
    throw new DevicesError('not-a-repository', `${ctx.cwd} is not in a git repository`);
  }
  const loaded = loadPolicy({ cwd: repoRoot });
  if (!loaded.policy) {
    const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
    throw new DevicesError(
      'policy',
      `the device commands need the project's ID from a valid policy.json (${why})`,
    );
  }
  const projectId = loaded.policy.project.id;
  const storeRoot =
    typeof input.store === 'string'
      ? input.store
      : privateStorePath(projectId, { env: ctx.env, repoRoot });
  const address = chooseRemote({ store: storeRoot, projectId, env: ctx.env });
  return { repoRoot, projectId, storeRoot, address };
}

/**
 * The store repository's device requests, fetched now. No address, or a store repository that
 * cannot be read, refuses.
 * @param {ReturnType<typeof project>} p
 */
async function freshRequests(p) {
  if (!p.address) throw new DevicesError('no-remote', `${NO_ADDRESS}, so a device cannot ask`);
  ensureRepo(p.storeRoot);
  const branch = createDevicesBranch({ url: p.address.url, dir: remoteDir(p.storeRoot) });
  try {
    await branch.fetch();
  } catch (e) {
    throw new DevicesError(
      'devices-fetch-failed',
      `could not read the device requests (the ${DEVICES_BRANCH} branch) on the store repository: ${/** @type {Error} */ (e).message}`,
    );
  }
  return { branch, url: p.address.url, ...requestsOnBranch(p.storeRoot, p.address.url) };
}

/**
 * Whether this device may ask the owner for itself: no device is approved in the store it holds,
 * and the remote holds nothing (the first device of an empty store), or the remote's head opens
 * with this key and holds no approval either (a store from before device decisions). The head is
 * merged in first, so an approval another device pushed is seen. Then nothing is pushed until the
 * owner answers.
 * @param {ReturnType<typeof project>} p @param {Ctx} ctx @param {string | null} identity
 */
async function firstDevice(p, ctx, identity) {
  if (!p.address) return false;
  const store = openStore(p.storeRoot);
  if (approvedDevices(readApprovals(store)).length) return false;
  ensureRepo(p.storeRoot);
  const remote = createGitRemote({
    url: p.address.url,
    dir: remoteDir(p.storeRoot),
    branch: STORE_BRANCH,
  });
  /** @type {string | null} */
  let head;
  try {
    head = await remote.head();
  } catch {
    return false;
  }
  if (head === null) return true;
  if (!identity) return false;
  const pp = await import('../../store/push-pull.mjs');
  const devices = resolveDevices({
    store,
    env: { ...ctx.env, [IDENTITY_ENV]: identity },
    projectId: p.projectId,
  });
  try {
    const pulled = await pp.pullStore({
      root: p.storeRoot,
      projectId: p.projectId,
      remote,
      url: p.address.url,
      devices,
    });
    if (!pulled.ok) return false;
  } catch {
    return false;
  }
  return approvedDevices(readApprovals(store)).length === 0;
}

/**
 * Put a device decision to the owner, through `hitld rights ask`: owner only, no precedent, no
 * default. The decision item names the device only by its key's fingerprint; the request is
 * recorded in the private store the rights commands use, where `hitld rights answer` finds it.
 * @param {Ctx} ctx @param {'enrol' | 'remove'} action @param {Device} device
 * @param {string | undefined} parent
 */
async function askOwner(ctx, action, device, parent) {
  const [{ openDecisions }, { askQuestion }] = await Promise.all([
    import('./rights.mjs'),
    import('../../rights/flow.mjs'),
  ]);
  const o = await openDecisions(ctx);
  if (o.failure) {
    throw new DevicesError(
      'device-ask-refused',
      `the device decision could not be asked: ${JSON.stringify(o.failure)}`,
    );
  }
  const deps = /** @type {NonNullable<typeof o.deps>} */ (o.deps);
  const parentId = parent ?? soleProject(deps.tracker);
  const asked = askQuestion(deps, deviceQuestion(action, device, parentId), { ownerOnly: true });
  if (!asked.ok || asked.outcome !== 'asked') {
    throw new DevicesError(
      'device-ask-refused',
      `the device decision could not be asked (${asked.error ?? asked.outcome}): ${asked.message ?? 'only the owner may settle it'}${parentId ? '' : '; give the tracker project to file it under with --parent'}`,
    );
  }
  recordApproval(deps.store, {
    event: 'asked',
    decision: asked.decision,
    action,
    name: device.name,
    recipient: device.recipient,
    added: device.added,
    at: (ctx.now ?? (() => new Date()))().toISOString(),
  });
  return {
    decision: asked.decision,
    action,
    name: device.name,
    fingerprint: fingerprint(device.recipient),
    text: asked.text,
    answer_with: `hitld rights answer ${asked.decision} --answer A`,
  };
}

/**
 * The tracker's one open project, or undefined when there is not exactly one.
 * @param {import('../../tracker/interface.mjs').TrackerAdapter} tracker
 */
function soleProject(tracker) {
  const open = tracker
    .query({ kind: 'project' })
    .filter((i) => !['done', 'dropped'].includes(String(i.state)));
  return open.length === 1 ? String(open[0].id) : undefined;
}

/**
 * Refuse executors, then run; a known refusal becomes a result with its code.
 * @param {string} name
 * @param {(input: Record<string, unknown>, ctx: Ctx) => Promise<Result>} fn
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Promise<Result>}
 */
const ownerOnly = (name, fn) => async (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return fail(
      'not-permitted',
      `hitld ${name} is the owner's, run from the main session in the primary checkout (${why}); executors never enrol, list or remove store devices`,
    );
  }
  try {
    return await fn(input, ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code;
    if (
      e instanceof Error &&
      [
        'DevicesError',
        'AgeError',
        'StoreRemoteError',
        'StoreAddressError',
        'PrivateTermsError',
      ].includes(e.name) &&
      typeof code === 'string'
    ) {
      return fail(code, e.message);
    }
    throw e;
  }
};

/** @param {Ctx} ctx */
const today = (ctx) => (ctx.now ?? (() => new Date()))().toISOString().slice(0, 10);

/**
 * The first private key in a text. @param {string} text
 */
const firstKey = (text) => {
  parseIdentities(text);
  return /** @type {string} */ (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
  );
};

/**
 * Refuse a name another key uses, approved or asking, before a new key is made, so a refusal
 * leaves no orphan key behind.
 * @param {Device[]} taken @param {string} name @param {string | null} recipient this key, if known
 */
function checkNameFree(taken, name, recipient) {
  if (taken.some((d) => d.name === name && d.recipient !== recipient)) {
    throw new DevicesError(
      'device-name-taken',
      `"${name}" is used by another key; choose another name with --name, or remove "${name}" first`,
    );
  }
}

/** @type {import('../table.mjs').Command[]} */
export const deviceCommands = [
  {
    name: 'store device init',
    summary:
      "Make this device's key pair for the private store: the private key in the OS keychain (or, with --cloud, printed once for the cloud environment's HITLD_STORE_IDENTITY), and the device's request (name and public key) put on the store repository's hitld-devices branch, where it waits for the owner's approval. The first device of an empty store asks the owner itself. The device's name goes on the private term list (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [
      {
        name: 'name',
        type: 'string',
        description:
          "The device's name: lower-case letters, digits, '.', '_' and '-'. Default: this machine's host name; required with --cloud",
      },
      {
        name: 'cloud',
        type: 'boolean',
        description: `The device is a cloud environment: write nothing to disk or the keychain. With ${IDENTITY_ENV} already set, ask for that key and print nothing secret; otherwise print a new private key once for the owner to set as ${IDENTITY_ENV} in that environment's settings (one device per environment)`,
      },
      PARENT,
    ],
    run: ownerOnly('store device init', async (input, ctx) => {
      const p = project({}, ctx);
      const cloud = input.cloud === true;
      const given = typeof input.name === 'string' ? input.name : null;
      const name = given ?? (cloud ? null : nameFromHost(hostname()));
      if (!name) {
        throw new DevicesError(
          'device-name-required',
          cloud
            ? 'name the cloud environment with --name, a name of your own (not an example from the guide), such as --name example-cloud'
            : "this machine's host name makes no device name; give one with --name",
        );
      }
      checkName(name);
      // The device's name is private from here on (design 10.3, rule 7), whatever happens next.
      const terms = recordDevice(openStore(p.storeRoot), name, ctx.now).map((t) => ({
        id: t.id,
        kind: t.kind,
        added: t.added,
      }));
      const list = await freshRequests(p);
      const records = readApprovals(openStore(p.storeRoot));
      const approved = approvedDevices(records);
      const taken = [...approved, ...list.requests];

      /** @type {string | null} */
      let identity = null;
      /** @type {string | null} this device's private key, to open the remote's head with */
      let own = null;
      /** @type {string} */
      let recipient;
      let created = false;
      /** @type {string[]} */
      const warnings = [];
      if (cloud) {
        const existing = ctx.env[IDENTITY_ENV];
        if (existing?.trim()) {
          // This environment has its key already: ask for it, show nothing secret.
          own = firstKey(existing);
          recipient = recipientOf(own);
        } else {
          checkNameFree(taken, name, null);
          ({ identity, recipient } = generateIdentity());
          own = identity;
          created = true;
        }
      } else {
        const kc = deviceKeychain(p.projectId, { env: ctx.env });
        const stored = kc.read(KEYCHAIN_ACCOUNT);
        if (stored?.trim()) {
          own = firstKey(stored);
          recipient = recipientOf(own);
        } else {
          const how = `For a cloud environment, run hitld store device init --cloud --name <n> and set ${IDENTITY_ENV} in its settings`;
          if (!kc.tool) {
            throw new DevicesError(
              'device-no-keychain',
              `this machine has no keychain hitld can store the device key in (macOS security, or secret-tool on Linux). ${how}`,
            );
          }
          checkNameFree(taken, name, null);
          const made = generateIdentity();
          const w = kc.write(
            KEYCHAIN_ACCOUNT,
            made.identity,
            `hitld store device key (${p.projectId})`,
          );
          if (!w.ok) {
            throw new DevicesError(
              'device-no-keychain',
              `the device key could not be stored in the keychain with ${kc.tool} (${w.reason}). On Linux, secret-tool needs a running Secret Service (GNOME Keyring or KeePassXC, for example). ${how}`,
            );
          }
          recipient = made.recipient;
          own = made.identity;
          created = true;
        }
        if (ctx.env[IDENTITY_ENV]?.trim()) {
          warnings.push(
            `${IDENTITY_ENV} is set in this shell and is used before the keychain; unset it to use this key`,
          );
        }
      }
      warnings.push(...legacyWarnings(p.repoRoot));
      const fp = fingerprint(recipient);
      const key = cloud
        ? { where: 'environment', variable: IDENTITY_ENV }
        : { where: 'keychain', service: keychainService(p.projectId), account: KEYCHAIN_ACCOUNT };
      const secret = identity
        ? {
            identity,
            message: `This is the device's private key. hitld keeps no copy and does not show it again. Set it as ${IDENTITY_ENV} in the cloud environment's settings (the owner's personal environment, one device per environment).`,
          }
        : {};

      const mine = approved.find((d) => d.recipient === recipient);
      if (mine) {
        return {
          ok: true,
          device: mine.name,
          recipient,
          fingerprint: fp,
          remote: list.url,
          status: 'approved',
          changed: false,
          private_terms: terms,
          key_created: created,
          key,
          ...secret,
          ...(warnings.length ? { warnings } : {}),
          next: 'nothing to do: the owner has approved this key',
        };
      }
      checkNameFree(taken, name, recipient);
      /** @type {Device} */
      const device = { name, recipient, added: today(ctx) };
      const asking = list.requests.find((d) => d.recipient === recipient);
      const entry = asking ?? device;
      const request = asking
        ? { pushed: false }
        : await list.branch.propose({
            name,
            text: requestText(device),
            message: `Request for the store device ${name}`,
          });
      const open = openDeviceAsks(records).find(
        (r) => r.recipient === recipient && r.action === 'enrol',
      );
      // The first device of an empty store asks the owner itself; nothing is pushed before the
      // answer. Any other device waits for an approved device to ask (hitld store device ask).
      const decision =
        !open && (await firstDevice(p, ctx, own))
          ? await askOwner(ctx, 'enrol', entry, /** @type {string | undefined} */ (input.parent))
          : null;
      const waiting = open
        ? {
            decision: open.decision,
            answer_with: `hitld rights answer ${open.decision} --answer A`,
          }
        : null;
      const next = decision
        ? `the owner answers decision ${decision.decision} in their own turn (${decision.answer_with}), checking the fingerprint ${fp}; then a checkpoint or hitld store push makes the first push`
        : waiting
          ? `the owner answers decision ${waiting.decision} (${waiting.answer_with}), checking the fingerprint ${fp}`
          : `on a device the owner already approved, hitld store device ask puts this request to the owner; once the owner has answered there and that device has pushed, hitld store pull here opens the store. The fingerprint to check is ${fp}`;
      return {
        ok: true,
        device: entry.name,
        recipient,
        fingerprint: fp,
        remote: list.url,
        status: 'requested',
        changed: !asking,
        request: {
          branch: DEVICES_BRANCH,
          file: `${PROPOSALS_DIR}/${entry.name}.json`,
          pushed: request.pushed,
        },
        decision: decision ?? waiting,
        private_terms: terms,
        key_created: created,
        key,
        ...(identity ? { identity: secret.identity, message: secret.message } : {}),
        ...(warnings.length ? { warnings } : {}),
        next: identity ? `set ${IDENTITY_ENV} as above; then ${next}` : next,
      };
    }),
  },
  {
    name: 'store device ask',
    summary:
      "Put each device request waiting on the store repository's hitld-devices branch to the owner, as a decision only the owner's own answer settles (no default, no precedent); run on a device the owner already approved (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [PARENT],
    run: ownerOnly('store device ask', async (input, ctx) => {
      const p = project({}, ctx);
      const list = await freshRequests(p);
      const store = openStore(p.storeRoot);
      const here = resolveDevices({ store, env: ctx.env, projectId: p.projectId });
      if (!here.enrolled && !(await firstDevice(p, ctx, here.identity))) {
        throw new DevicesError(
          'device-not-enrolled',
          `only a device the owner already approved puts device requests to the owner, because the answer is recorded in the store it pushes: ${here.problem}`,
        );
      }
      const records = readApprovals(store);
      const asked = new Set(openDeviceAsks(records).map((r) => r.recipient));
      const waiting = pendingRequests(list.requests, records).filter(
        (d) => !asked.has(d.recipient),
      );
      const out = [];
      for (const d of waiting) {
        out.push(await askOwner(ctx, 'enrol', d, /** @type {string | undefined} */ (input.parent)));
      }
      return {
        ok: true,
        asked: out,
        waiting_for_owner: openDeviceAsks(readApprovals(store)).map((r) => ({
          decision: r.decision,
          action: r.action,
          name: r.name,
          fingerprint: fingerprint(r.recipient),
        })),
        ...(list.problems.length ? { request_problems: list.problems } : {}),
        next: out.length
          ? 'send each question to the owner as usual (hitld rights show <decision>); only their own answer, recorded with hitld rights answer, approves a device'
          : 'no device request is waiting',
      };
    }),
  },
  {
    name: 'store device list',
    summary:
      "The devices the owner approved (from the private store), the requests waiting on the store repository's hitld-devices branch, and the device decisions waiting for the owner's answer, each marked; which one this device is; removals whose rotation is still to come (owner only)",
    built_by: 'consumer-live',
    args: [STORE],
    run: ownerOnly('store device list', async (input, ctx) => {
      const p = project(input, ctx);
      const pp = await import('../../store/push-pull.mjs');
      const fetched = await pp.fetchRequests(p.storeRoot, p.address?.url ?? null);
      const own = resolveDevices({
        store: openStore(p.storeRoot),
        env: ctx.env,
        projectId: p.projectId,
      });
      // The remote's head decides whether this device is enrolled: its own copy of the approvals
      // may be from before the owner removed it.
      const access = p.address
        ? await pp.headAccess({
            remote: pp.openRemote(p.storeRoot, p.address).remote,
            devices: own,
          })
        : { opens: null, problem: null };
      const here = pp.seenFromRemote(own, access);
      const warnings = [
        ...(p.address ? [] : [`${NO_ADDRESS}, so no device request can be read`]),
        ...legacyWarnings(p.repoRoot),
      ];
      return {
        ok: true,
        remote: p.address?.url ?? null,
        ...pp.deviceSummary(p.storeRoot, here, fetched.requests, fetched.error),
        this_device: {
          name: here.device,
          enrolled: here.enrolled,
          opens_remote: access.opens,
          key_source: here.key_source,
          ...(here.recipient ? { fingerprint: fingerprint(here.recipient) } : {}),
          ...(here.problem ? { problem: here.problem } : {}),
        },
        rotation: {
          pending: here.rotation.pending.map((r) => ({
            name: r.name,
            recipient: r.recipient,
            removed_at: r.at,
          })),
        },
        ...(warnings.length ? { warnings } : {}),
      };
    }),
  },
  {
    name: 'store device remove',
    summary:
      "Ask the owner to remove a device: a decision only the owner's own answer settles. Once they approve it, the next push is not encrypted to the device and prunes the older files its key opens (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [
      {
        name: 'name',
        type: 'string',
        positional: true,
        required: true,
        description: "The device's name, as hitld store device list shows it",
      },
      PARENT,
    ],
    run: ownerOnly('store device remove', async (input, ctx) => {
      const p = project({}, ctx);
      const name = checkName(String(input.name));
      const store = openStore(p.storeRoot);
      const records = readApprovals(store);
      const device = approvedDevices(records).find((d) => d.name === name);
      if (!device) {
        throw new DevicesError(
          'device-unknown',
          `no approved device is named "${name}"; hitld store device list shows them`,
        );
      }
      const open = openDeviceAsks(records).find(
        (r) => r.recipient === device.recipient && r.action === 'remove',
      );
      const decision = open
        ? {
            decision: open.decision,
            action: open.action,
            name,
            fingerprint: fingerprint(device.recipient),
            answer_with: `hitld rights answer ${open.decision} --answer A`,
          }
        : await askOwner(ctx, 'remove', device, /** @type {string | undefined} */ (input.parent));
      const left = approvedDevices(records).length - 1;
      return {
        ok: true,
        device: name,
        fingerprint: fingerprint(device.recipient),
        decision,
        rotation: 'once approved',
        message: `Once the owner approves the removal, every push is encrypted only to the remaining devices, and the first push prunes the remote's older files, which ${name}'s key still opens. What ${name} already pulled, it keeps.`,
        ...(left
          ? {}
          : { warnings: ['no device would be left: nothing could push until one is approved'] }),
        next: `the owner answers decision ${decision.decision} in their own turn (${decision.answer_with}); then push from a device that stays (a checkpoint does it)`,
      };
    }),
  },
];
