// Where the store remote's address and device list live (design 0003, sections 6 and 8): never in
// the project's repository, which may be public. Naming the private store's repository, or the
// devices that can read it, tells anyone where the store is and how many keys open it.
//
//   the address  HITLD_STORE_REMOTE (a cloud environment), else the person file, keyed by project
//                ID (a local machine), else this machine's override in the store
//
// This module holds the names and the messages that say where each goes, for the policy check, the
// commit guard and the commands. It imports nothing of hitld's, so any of them may use it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The environment variable a cloud environment gives the store's address in. */
export const REMOTE_ENV = 'HITLD_STORE_REMOTE';

/** Why store.remote.url is refused in policy.json, and where the address goes. */
export const ADDRESS_MOVED = `the store's address does not go in policy.json, which is committed and may be public: set ${REMOTE_ENV} in the cloud environment, or run hitld store remote set <url> on a machine (it writes the person file), then take store.remote.url out of policy.json. store.remote.required (true or false) is the only store setting policy.json keeps`;

// The device list. Who may read the store is the owner's answer to a decision, recorded inside the
// encrypted store (devices.mjs). A new device's request travels through the store repository's
// hitld-devices branch, which anyone who can write that repository could change, so a request is
// never trusted by itself. None of it is ever in the project's repository.

/** The store repository's branch where a new device puts its request (its name and public key). */
export const DEVICES_BRANCH = 'hitld-devices';
/** The folder on that branch with one request per device. */
export const PROPOSALS_DIR = 'proposals';
/** Where the device list was kept before; it never goes in the project's repository. */
export const LEGACY_DEVICES_PATH = '.human-in-the-lead/store-devices.json';

/** Why .human-in-the-lead/store-devices.json is refused, and how to move off it. */
export const DEVICES_MOVED = `the device list does not go in the project's repository, which may be public: who may read the store is the owner's answer to a device decision, kept inside the encrypted store. On each device, run hitld store device init (it asks again for the key it already has), have the owner answer, then git rm ${LEGACY_DEVICES_PATH}`;

/**
 * The warnings for a checkout that still holds the device list in the old place.
 * @param {string | null | undefined} repoRoot
 * @returns {string[]}
 */
export function legacyWarnings(repoRoot) {
  if (!repoRoot || !existsSync(join(repoRoot, LEGACY_DEVICES_PATH))) return [];
  return [`${LEGACY_DEVICES_PATH} is not read any more: ${DEVICES_MOVED}`];
}
