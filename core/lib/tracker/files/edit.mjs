// Editing item files in a working tree: find one by ID, change its front matter, write it back
// atomically. The version of a file is a hash of its text, so `update` can refuse a write over a
// change it has not seen (optimistic concurrency, design part 3.3).

import { keyOrder } from './format.mjs';
import { renderItem, setKeys } from './frontmatter.mjs';
import { insidePath, readNoFollow, writeNoFollow } from './safe.mjs';
import { loadWorkTree, versionOf } from './tree.mjs';

export { versionOf };

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 */

/**
 * Find an item file by ID in a working tree.
 * @param {string} root @param {Layout} layout @param {string} id
 * @returns {Entry | undefined}
 */
export function findEntry(root, layout, id) {
  return loadWorkTree(root, layout).find((e) => e.data?.id === id);
}

/**
 * The current text and version of an entry's file.
 * @param {string} root @param {Entry} entry
 */
export function readEntryFile(root, entry) {
  const text = readNoFollow(insidePath(root, entry.path));
  return { text, version: versionOf(text) };
}

/**
 * Write stored keys (and the body) to an entry's file, replacing it atomically.
 * @param {string} root @param {Layout} layout @param {string} path repository-relative
 * @param {Record<string, unknown>} stored @param {string} body
 * @returns {string} the new version
 */
export function writeStored(root, layout, path, stored, body) {
  const text = renderItem(stored, keyOrder(String(stored.kind), layout), body);
  writeNoFollow(insidePath(root, path), text);
  return versionOf(text);
}

/**
 * Write only the given keys of an entry's file, in place, leaving every other line where it is
 * (HITLD-261), so the diff is the keys that changed.
 * @param {string} root @param {Layout} layout @param {string} path repository-relative
 * @param {Record<string, unknown>} stored the item's stored keys after the change
 * @param {string[]} keys the keys that changed
 * @returns {string} the new version
 */
export function writeKeys(root, layout, path, stored, keys) {
  const full = insidePath(root, path);
  const values = Object.fromEntries(keys.map((k) => [k, stored[k]]));
  const text = setKeys(readNoFollow(full), values, keyOrder(String(stored.kind), layout));
  writeNoFollow(full, text);
  return versionOf(text);
}
