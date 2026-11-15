// The commit guard's store placement rule (design 0003, section 8): the project's repository never
// holds the private store's address, whatever its classification ceiling. The repository may be
// public, and the address tells anyone where the store is. classification.mjs applies this rule beside its own, so it
// runs wherever that one does: the pre-commit hook, the merge check and `hitld work check`.
//
//   store-address   a .human-in-the-lead/policy.json that sets store.remote.url (the address
//                   lives in HITLD_STORE_REMOTE or the person file)
//
// A file's contents are only parsed as JSON; nothing in them is run.

import { ADDRESS_MOVED } from '../store/placement.mjs';

/** @typedef {'store-address'} PlacementRule */

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
