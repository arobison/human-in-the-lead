// The device port (design 0003, sections 5, 6 and 9): what `store push` and `store pull` ask about
// this device before they encrypt or open anything. Which keys a push encrypts to, which private
// key this device opens files with, whether it may push at all, and whether a removal still needs
// the remote's older files pruned.
//
// The enrolled set is what main says, never the working tree: a device enrolled on a branch, or in
// an uncommitted edit, is not enrolled. A push encrypts to main's list and nothing else, so a
// removed device opens nothing pushed after its removal reached main (milestone c3).

import { openStore } from './store.mjs';
import { parseIdentities, recipientOf } from './age.mjs';
import { findRepoRoot, loadPolicy } from '../policy/policy.mjs';
import {
  DEVICES_PATH,
  DevicesError,
  IDENTITY_ENV,
  KEYCHAIN_ACCOUNT,
  deviceKeychain,
  enrolledOnMain,
  pendingRotations,
  readRotations,
  recordRotation,
  removalsOnMain,
} from './devices.mjs';

/**
 * @typedef {object} DeviceResolution
 * @property {string[]} recipients the public keys on main's list: everything a push encrypts to
 * @property {string | null} identity this device's private key (AGE-SECRET-KEY-1...), one line:
 *   from HITLD_STORE_IDENTITY when set, else the keychain; null when there is none. A secret: never
 *   print it or put it in a result
 * @property {boolean} enrolled whether that key's public key is on main's list
 * @property {string | null} device this device's name on main's list
 * @property {'environment' | 'keychain' | null} key_source where the identity came from
 * @property {string[]} refs the copies of main the list was read from
 * @property {string | null} problem why the device is not enrolled, in words; null when it is
 * @property {{ pending: import('./devices.mjs').Removal[] }} rotation removed devices whose
 *   rotation is not done: the remote may still hold files their keys open
 */

/** The name the push and pull code uses for a resolution. @typedef {DeviceResolution} Devices */

/**
 * Resolve this device against main's list. Never throws for a device that may not push: the
 * answer says so (enrolled false, problem), and `assertEnrolled` turns it into the refusal.
 * @param {{
 *   root: string,
 *   store?: string | import('./store.mjs').PrivateStore,
 *   env?: NodeJS.ProcessEnv,
 *   keychain?: Pick<import('../env/keychain.mjs').Keychain, 'read'>,
 *   projectId?: string,
 *   mainBranch?: string,
 * }} options root is the project's checkout (any directory in it); store the private store, for
 *   the rotation records; keychain, projectId and mainBranch default to the real keychain and
 *   policy.json
 * @returns {DeviceResolution}
 */
export function resolveDevices(options) {
  const env = options.env ?? process.env;
  const repoRoot = findRepoRoot(options.root) ?? options.root;
  let { projectId, mainBranch } = options;
  if (projectId === undefined || mainBranch === undefined) {
    const policy = loadPolicy({ cwd: repoRoot }).policy;
    projectId ??= policy?.project.id;
    mainBranch ??= policy?.merge?.main_branch ?? 'main';
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

  /** @type {import('./devices.mjs').Device[]} */
  let devices = [];
  /** @type {string[]} */
  let refs = [];
  try {
    ({ devices, refs } = enrolledOnMain(repoRoot, /** @type {string} */ (mainBranch)));
  } catch (e) {
    if (!(e instanceof DevicesError)) throw e;
    problem = e.message;
  }

  /** @type {import('./devices.mjs').Device | undefined} */
  let mine;
  let identity = keys[0] ?? null;
  for (const key of keys) {
    const recipient = recipientOf(key);
    mine = devices.find((d) => d.recipient === recipient);
    if (mine) {
      identity = key;
      break;
    }
  }
  if (!mine && !problem) {
    problem = `this device's key (${recipientOf(/** @type {string} */ (identity))}) is not on ${mainBranch}'s ${DEVICES_PATH}: enrol it with hitld store device init, commit the file, and have the owner merge it`;
  }

  const recipients = devices.map((d) => d.recipient);
  const store =
    typeof options.store === 'string' ? openStore(options.store) : (options.store ?? null);
  const pending = refs.length
    ? pendingRotations({
        removals: refs.flatMap((ref) => removalsOnMain(repoRoot, ref)),
        records: store ? readRotations(store) : [],
        current: recipients,
      })
    : [];

  return {
    recipients,
    identity,
    enrolled: Boolean(mine),
    device: mine?.name ?? null,
    key_source: keySource,
    refs,
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
 * Refuse a push from a device that is not on main's list: `device-not-enrolled`. Call it before
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
 * was encrypted to main's list without it; every older file on the remote may still open with its
 * key, so all but the newest are pruned, and the rotation is recorded in the private store. Each
 * file holds the store's whole history, so pruning loses nothing. Call it after every successful
 * push; with nothing pending it does nothing.
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
