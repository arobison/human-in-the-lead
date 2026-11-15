// The commit guard's store placement rule (design 0003, sections 6 and 8): the project's
// repository never holds the private store's address or its device list, whatever its
// classification ceiling. The repository may be public, and either one tells anyone where the
// store is and how many keys open it. classification.mjs applies this rule beside its own, so it
// runs wherever that one does: the pre-commit hook, the merge check and `hitld work check`.
//
//   store-address   a .human-in-the-lead/policy.json that sets store.remote.url (the address
//                   lives in HITLD_STORE_REMOTE or the person file)
//   store-devices   a file at .human-in-the-lead/store-devices.json (who may read the store is
//                   the owner's answers, kept inside the encrypted store)
//
// A file's contents are only parsed as JSON; nothing in them is run.

import { ADDRESS_MOVED, DEVICES_MOVED } from '../store/placement.mjs';

/** @typedef {'store-address' | 'store-devices'} PlacementRule */

/** @param {string} path @param {string} name */
const isHitldFile = (path, name) =>
  path === `.human-in-the-lead/${name}` || path.endsWith(`/.human-in-the-lead/${name}`);

/**
 * Whether a policy.json text sets store.remote.url. A text that does not parse sets nothing here;
 * the policy check refuses it on its own.
 * @param {string} text
 */
export function setsStoreAddress(text) {
  try {
    const remote = JSON.parse(text)?.store?.remote;
    return Boolean(remote) && typeof remote === 'object' && Object.hasOwn(remote, 'url');
  } catch {
    return false;
  }
}

/**
 * The rule applied to one file: why it is refused, or null.
 * @param {string} path repository-relative, with "/" separators
 * @param {Buffer | string} head the start of the file
 * @returns {{ path: string, rule: PlacementRule, classification: null, message: string } | null}
 */
export function judgePlacement(path, head) {
  if (isHitldFile(path, 'store-devices.json')) {
    return { path, rule: 'store-devices', classification: null, message: DEVICES_MOVED };
  }
  if (isHitldFile(path, 'policy.json')) {
    const text = typeof head === 'string' ? head : head.toString('utf8');
    if (setsStoreAddress(text)) {
      return {
        path,
        rule: 'store-address',
        classification: null,
        message: `store.remote.url: ${ADDRESS_MOVED}`,
      };
    }
  }
  return null;
}
