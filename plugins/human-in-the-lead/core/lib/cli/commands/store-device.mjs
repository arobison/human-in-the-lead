// Store devices (design 0003, sections 5, 6 and 9): `hitld store device init | list | remove`.
// Owner only: each refuses an executor, as the other store commands do. Part of the store
// commands (store.mjs lists them).
//
// init and remove change .human-in-the-lead/store-devices.json in the working tree, for the
// owner to commit; the change counts once it is on main, through the owner's merge. list reads
// main's copy.

import { hostname } from 'node:os';
import { loadPolicy } from '../../policy/policy.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { generateIdentity, parseIdentities, recipientOf } from '../../store/age.mjs';
import {
  DEVICES_PATH,
  DevicesError,
  IDENTITY_ENV,
  KEYCHAIN_ACCOUNT,
  addDevice,
  checkName,
  deviceKeychain,
  enrolledOnMain,
  keychainService,
  nameFromHost,
  readDevices,
  recordRotation,
  removeDevice,
  writeDevices,
} from '../../store/devices.mjs';
import { resolveDevices } from '../../store/devices-port.mjs';
import { executorSignal } from '../executor.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory, where removals and rotations are recorded. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead",
};

/** @param {string} error @param {string} message @param {Record<string, unknown>} [more] @returns {Result} */
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more });

/**
 * The project: its checkout, policy and private store.
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
      'no-policy',
      `the device commands need the project's ID from a valid policy.json (${why})`,
    );
  }
  const projectId = loaded.policy.project.id;
  const mainBranch = loaded.policy.merge.main_branch;
  const storeRoot =
    typeof input.store === 'string'
      ? input.store
      : privateStorePath(projectId, { env: ctx.env, repoRoot });
  return { repoRoot, projectId, mainBranch, storeRoot };
}

/** The working tree's list, refused when it fails the check. @param {string} repoRoot */
function workingList(repoRoot) {
  const read = readDevices(repoRoot);
  if (!read.file) {
    throw new DevicesError(
      'devices-invalid',
      `${DEVICES_PATH} is refused: ${read.problems.join('; ')}`,
      { problems: read.problems },
    );
  }
  return read.file;
}

/**
 * Refuse executors, then run; a known refusal becomes a result with its code.
 * @param {string} name
 * @param {(input: Record<string, unknown>, ctx: Ctx) => Result} fn
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Result}
 */
const ownerOnly = (name, fn) => (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return fail(
      'not-permitted',
      `hitld ${name} is the owner's, run from the main session in the primary checkout (${why}); executors never enrol, list or remove store devices`,
    );
  }
  try {
    return fn(input, ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code;
    if (
      e instanceof Error &&
      ['DevicesError', 'AgeError'].includes(e.name) &&
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
 * Refuse a taken name before a new key is made, so a refusal leaves no orphan key behind.
 * @param {import('../../store/devices.mjs').DevicesFile} file @param {string} name
 */
function checkNameFree(file, name) {
  if (file.devices.some((d) => d.name === name)) {
    throw new DevicesError(
      'device-name-taken',
      `"${name}" is enrolled with another key; choose another name with --name, or remove "${name}" first`,
    );
  }
}

/** @type {import('../table.mjs').Command[]} */
export const deviceCommands = [
  {
    name: 'store device init',
    summary:
      "Make this device's key pair for the private store: the private key in the OS keychain (or, with --cloud, printed once for the cloud environment's HITLD_STORE_IDENTITY), the public key added to .human-in-the-lead/store-devices.json to commit (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [
      {
        name: 'name',
        type: 'string',
        description:
          "The device's name in store-devices.json: lower-case letters, digits, '.', '_' and '-'. Default: this machine's host name; required with --cloud",
      },
      {
        name: 'cloud',
        type: 'boolean',
        description: `The device is a cloud environment: write nothing to disk or the keychain, print the private key once for the owner to set as ${IDENTITY_ENV} in that environment's settings (one device per environment)`,
      },
    ],
    run: ownerOnly('store device init', (input, ctx) => {
      const p = project(input, ctx);
      const file = workingList(p.repoRoot);
      const cloud = input.cloud === true;
      const given = typeof input.name === 'string' ? input.name : null;
      const name = given ?? (cloud ? null : nameFromHost(hostname()));
      if (!name) {
        throw new DevicesError(
          'device-name-required',
          cloud
            ? 'name the cloud environment with --name, for example --name cloud-main'
            : "this machine's host name makes no device name; give one with --name",
        );
      }
      checkName(name);

      /** @type {string | null} */
      let identity = null;
      /** @type {string} */
      let recipient;
      let created = false;
      /** @type {string[]} */
      const warnings = [];
      if (cloud) {
        const existing = ctx.env[IDENTITY_ENV];
        if (existing?.trim()) {
          // This environment has its key already: enrol it, show nothing secret.
          recipient = recipientOf(firstKey(existing));
        } else {
          checkNameFree(file, name);
          ({ identity, recipient } = generateIdentity());
          created = true;
        }
      } else {
        const kc = deviceKeychain(p.projectId, { env: ctx.env });
        const stored = kc.read(KEYCHAIN_ACCOUNT);
        if (stored?.trim()) {
          recipient = recipientOf(firstKey(stored));
        } else {
          const how = `For a cloud environment, run hitld store device init --cloud --name <n> and set ${IDENTITY_ENV} in its settings`;
          if (!kc.tool) {
            throw new DevicesError(
              'device-no-keychain',
              `this machine has no keychain hitld can store the device key in (macOS security, or secret-tool on Linux). ${how}`,
            );
          }
          checkNameFree(file, name);
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
          created = true;
        }
        if (ctx.env[IDENTITY_ENV]?.trim()) {
          warnings.push(
            `${IDENTITY_ENV} is set in this shell and is used before the keychain; unset it to use this key`,
          );
        }
      }

      const added = addDevice(file, { name, recipient, added: today(ctx) });
      if (added.changed) writeDevices(p.repoRoot, added.file);
      const enrolNext = `commit ${DEVICES_PATH} and have the owner merge it to ${p.mainBranch}: this device may push once its entry is on ${p.mainBranch}, and it opens what is pushed after that`;
      return {
        ok: true,
        device: added.entry.name,
        recipient,
        entry: added.entry,
        file: DEVICES_PATH,
        changed: added.changed,
        key_created: created,
        key: cloud
          ? { where: 'environment', variable: IDENTITY_ENV }
          : { where: 'keychain', service: keychainService(p.projectId), account: KEYCHAIN_ACCOUNT },
        ...(identity
          ? {
              identity,
              message: `This is the device's private key. hitld keeps no copy and does not show it again. Set it as ${IDENTITY_ENV} in the cloud environment's settings (the owner's personal environment, one device per environment).`,
            }
          : {}),
        ...(warnings.length ? { warnings } : {}),
        next: identity ? `set ${IDENTITY_ENV} as above, then ${enrolNext}` : enrolNext,
      };
    }),
  },
  {
    name: 'store device list',
    summary:
      "The devices enrolled for the private store, as main's .human-in-the-lead/store-devices.json lists them; which one this device is; changes in the working tree not yet on main; removals whose rotation is still to come (owner only)",
    built_by: 'consumer-live',
    args: [STORE],
    run: ownerOnly('store device list', (input, ctx) => {
      const p = project(input, ctx);
      const { devices, refs } = enrolledOnMain(p.repoRoot, p.mainBranch);
      const here = resolveDevices({
        root: p.repoRoot,
        store: openStore(p.storeRoot),
        env: ctx.env,
        projectId: p.projectId,
        mainBranch: p.mainBranch,
      });
      const working = readDevices(p.repoRoot);
      const onMain = new Set(devices.map((d) => d.recipient));
      const inTree = new Set((working.file?.devices ?? []).map((d) => d.recipient));
      return {
        ok: true,
        main: p.mainBranch,
        refs,
        file: DEVICES_PATH,
        devices,
        this_device: {
          name: here.device,
          enrolled: here.enrolled,
          key_source: here.key_source,
          ...(here.problem ? { problem: here.problem } : {}),
        },
        not_on_main: working.file
          ? {
              added: working.file.devices.filter((d) => !onMain.has(d.recipient)),
              removed: devices.filter((d) => !inTree.has(d.recipient)),
            }
          : { problems: working.problems },
        rotation: {
          pending: here.rotation.pending.map((r) => ({
            name: r.name,
            recipient: r.recipient,
            removed_at: r.at,
          })),
        },
      };
    }),
  },
  {
    name: 'store device remove',
    summary:
      'Take a device out of .human-in-the-lead/store-devices.json, for the owner to commit, and record that its key must rotate out: once the removal is on main, the next push is not encrypted to it and prunes the older files it can open (owner only)',
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
      STORE,
    ],
    run: ownerOnly('store device remove', (input, ctx) => {
      const p = project(input, ctx);
      const { file, removed } = removeDevice(workingList(p.repoRoot), String(input.name));
      writeDevices(p.repoRoot, file);
      recordRotation(openStore(p.storeRoot), {
        event: 'removed',
        name: removed.name,
        recipient: removed.recipient,
        at: (ctx.now ?? (() => new Date()))().toISOString(),
      });
      return {
        ok: true,
        removed,
        file: DEVICES_PATH,
        remaining: file.devices.length,
        rotation: 'pending',
        message: `Once this is on ${p.mainBranch}, every push is encrypted only to the remaining devices, and the first push prunes the remote's older files, which ${removed.name}'s key still opens. What ${removed.name} already pulled, it keeps.`,
        ...(file.devices.length
          ? {}
          : { warnings: ['no device is left: nothing can push until one is enrolled'] }),
        next: `commit ${DEVICES_PATH} and have the owner merge it to ${p.mainBranch}`,
      };
    }),
  },
];
