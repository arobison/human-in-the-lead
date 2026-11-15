// The device port (design 0003, sections 5, 6 and 9): what `store push` and `store pull` ask about
// this device before they encrypt or open anything. Which keys a push encrypts to, which private
// key this device opens files with, whether it may push at all, and whether a removal still needs
// the remote's older files pruned.
//
// The approved set comes from one place, `approvedList`: the owner's answers to device decisions,
// recorded inside the private store (devices.mjs). A request on the store repository's branch, or
// anything in the project's repository, is never part of it. A push brings in the remote's head
// first (push-pull.mjs), so the set it encrypts to holds every answer any device has pushed: a
// removed device opens nothing pushed after its removal (milestone c3).

import { openStore } from './store.mjs';
import { parseIdentities, recipientOf } from './age.mjs';
import { findRepoRoot, loadPolicy } from '../policy/policy.mjs';
import {
  DevicesError,
  IDENTITY_ENV,
  KEYCHAIN_ACCOUNT,
  approvedDevices,
  deviceKeychain,
  deviceRemovals,
  fingerprint,
  pendingRotations,
  readApprovals,
  readRotations,
  recordRotation,
} from './devices.mjs';

/**
 * @typedef {object} DeviceResolution
 * @property {string[]} recipients the approved public keys: everything a push encrypts to
 * @property {string | null} identity this device's private key (AGE-SECRET-KEY-1...), one line:
 *   from HITLD_STORE_IDENTITY when set, else the keychain; null when there is none. A secret: never
 *   print it or put it in a result
 * @property {string | null} recipient this device's public key, when it has one
 * @property {boolean} enrolled whether the owner has approved that key
 * @property {string | null} device this device's name in the approved set
 * @property {'environment' | 'keychain' | null} key_source where the identity came from
 * @property {import('./devices.mjs').Device[]} approved the approved set
 * @property {string | null} problem why the device is not enrolled, in words; null when it is
 * @property {{ pending: import('./devices.mjs').Removal[] }} rotation removed devices whose
 *   rotation is not done: the remote may still hold files their keys open
 */

/** The name the push and pull code uses for a resolution. @typedef {DeviceResolution} Devices */

/**
 * The approved set and the removals the owner's answers made: the one source of who may read the
 * store. Another source would be plugged in here.
 * @param {import('./store.mjs').PrivateStore} store
 */
export function approvedList(store) {
  const records = readApprovals(store);
  return { devices: approvedDevices(records), removals: deviceRemovals(records) };
}

/**
 * Resolve this device against the approved set. Never throws for a device that may not push: the
 * answer says so (enrolled false, problem), and `assertEnrolled` turns it into the refusal.
 * @param {{
 *   store: string | import('./store.mjs').PrivateStore,
 *   env?: NodeJS.ProcessEnv,
 *   keychain?: Pick<import('../env/keychain.mjs').Keychain, 'read'>,
 *   projectId?: string,
 *   root?: string,
 * }} options store is the private store, whose records hold the approvals and the rotations;
 *   keychain and projectId default to the real keychain and policy.json found from root
 * @returns {DeviceResolution}
 */
export function resolveDevices(options) {
  const env = options.env ?? process.env;
  const store = typeof options.store === 'string' ? openStore(options.store) : options.store;
  let { projectId } = options;
  if (projectId === undefined && options.root) {
    const repoRoot = findRepoRoot(options.root) ?? options.root;
    projectId = loadPolicy({ cwd: repoRoot }).policy?.project.id;
  }

  // This device's private keys: the environment first (a cloud environment), then the keychain.
  /** @type {DeviceResolution['key_source']} */
  let keySource = null;
  /** @type {string[]} */
  let keys = [];
  /** @type {string | null} */
  let problem = null;
  const fromEnv = env[IDENTITY_ENV];
  if (fromEnv?.trim()) {
    keySource = 'environment';
    keys = identityLines(fromEnv);
    if (!keys.length) problem = `${IDENTITY_ENV} does not hold an age private key`;
  } else {
    const kc = options.keychain ?? (projectId ? deviceKeychain(projectId, { env }) : null);
    const stored = kc?.read(KEYCHAIN_ACCOUNT);
    if (stored?.trim()) {
      keySource = 'keychain';
      keys = identityLines(stored);
      if (!keys.length) problem = "the keychain's device key is not an age private key";
    } else {
      problem = `this device has no key: run hitld store device init (a local machine), or set ${IDENTITY_ENV} (a cloud environment)`;
    }
  }

  const { devices, removals } = approvedList(store);
  /** @type {import('./devices.mjs').Device | undefined} */
  let mine;
  let identity = keys[0] ?? null;
  for (const key of keys) {
    mine = devices.find((d) => d.recipient === recipientOf(key));
    if (mine) {
      identity = key;
      break;
    }
  }
  const recipient = identity ? recipientOf(identity) : null;
  if (!mine && !problem) {
    problem = `the owner has not approved this device's key (fingerprint ${fingerprint(/** @type {string} */ (recipient))}) in the store this device holds: run hitld store device init, and the owner answers the device decision; a device that is new here pulls once an approved device has pushed the answer`;
  }

  const recipients = devices.map((d) => d.recipient);
  const pending = pendingRotations({
    removals,
    records: readRotations(store),
    current: recipients,
  });

  return {
    recipients,
    identity,
    recipient,
    enrolled: Boolean(mine),
    device: mine?.name ?? null,
    key_source: keySource,
    approved: devices,
    problem: mine ? null : problem,
    rotation: { pending },
  };
}

/**
 * The private keys in a text, one per line, each checked; none when any line is not a key.
 * @param {string} text
 */
function identityLines(text) {
  try {
    parseIdentities(text);
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Refuse a push from a device that is not approved: `device-not-enrolled`. Call it before
 * anything is encrypted or sent.
 * @param {DeviceResolution} resolution
 * @returns {DeviceResolution & { identity: string, device: string }}
 */
export function assertEnrolled(resolution) {
  if (!resolution.enrolled || !resolution.identity || !resolution.device) {
    throw new DevicesError(
      'device-not-enrolled',
      `this device may not push the store: ${resolution.problem ?? 'it is not enrolled'}`,
    );
  }
  return /** @type {DeviceResolution & { identity: string, device: string }} */ (resolution);
}

/**
 * Finish a rotation after a push. When a removed device's rotation is pending, the push just made
 * was encrypted to the approved set without it; every older file on the remote may still open
 * with its key, so all but the newest are pruned, and the rotation is recorded in the private
 * store. Each file holds the store's whole history, so pruning loses nothing. Call it after every
 * successful push; with nothing pending it does nothing.
 * @param {{
 *   remote: Pick<import('./remote.mjs').StoreRemote, 'prune'>,
 *   store: import('./store.mjs').PrivateStore,
 *   resolution: DeviceResolution,
 *   version: string | null,
 *   now?: () => Date,
 * }} options version is the id the push returned
 * @returns {Promise<{ rotated: string[], removed: string[] }>} the devices rotated out, and the
 *   versions pruned
 */
export async function completeRotation(options) {
  const { pending } = options.resolution.rotation;
  if (!pending.length) return { rotated: [], removed: [] };
  const { removed } = await options.remote.prune({ keep: 1 });
  const at = (options.now ?? (() => new Date()))().toISOString();
  for (const r of pending) {
    recordRotation(options.store, {
      event: 'rotated',
      name: r.name,
      recipient: r.recipient,
      at,
      version: options.version,
    });
  }
  return { rotated: pending.map((r) => r.name), removed };
}
