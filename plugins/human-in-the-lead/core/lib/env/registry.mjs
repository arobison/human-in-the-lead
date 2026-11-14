// The registry: every allocation the manager has made, in the private store under env/ (design
// part 13.2). One JSON file, changed only while holding a mutex, so concurrent leases never
// read each other's half-finished state.

import { join } from 'node:path';
import { withMutex } from './mutex.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 *
 * @typedef {object} ServerRecord a dev server the manager started
 * @property {number} pid
 * @property {string} start the process start time, as ps prints it
 * @property {string} cwd
 * @property {string} command
 * @property {string} started_at
 *
 * @typedef {object} PortLease
 * @property {number} port
 * @property {string} holder
 * @property {string} leased_at
 * @property {ServerRecord | null} server
 *
 * @typedef {object} SetupResult
 * @property {boolean} ok
 * @property {{ command: string, exit_code: number | null, ms: number, output_tail: string }[]} steps
 *
 * @typedef {object} WorktreeLease
 * @property {string} holder
 * @property {string} path
 * @property {string} branch
 * @property {string} repo_root
 * @property {string} base
 * @property {boolean} adopted a harness-created worktree: the manager never removes it
 * @property {'ready' | 'setup_failed' | 'failed'} status
 * @property {string} created_at
 * @property {string} [failed_at]
 * @property {SetupResult} [setup]
 *
 * @typedef {object} Registry
 * @property {1} version
 * @property {Record<string, WorktreeLease>} worktrees keyed by holder
 * @property {Record<string, PortLease>} ports keyed by port number
 */

const REGISTRY_FILE = 'env/registry.json';
const EVENTS = 'env/events.jsonl';

/** @returns {Registry} */
const empty = () => ({ version: 1, worktrees: {}, ports: {} });

/** @param {PrivateStore} store @returns {Registry} */
export function readRegistry(store) {
  const text = store.read(REGISTRY_FILE);
  if (text === null) return empty();
  const parsed = JSON.parse(text);
  return { ...empty(), ...parsed };
}

/**
 * Change the registry atomically with respect to other processes. `fn` may mutate the registry it
 * is given; whatever it returns is returned from here.
 * @template T
 * @param {PrivateStore} store
 * @param {(registry: Registry) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export function updateRegistry(store, fn) {
  return withMutex(join(store.root, 'env', '.registry.mutex'), async () => {
    const registry = readRegistry(store);
    const result = await fn(registry);
    store.write(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
    return result;
  });
}

/**
 * Append an event to the manager's log. Events never hold secret values.
 * @param {PrivateStore} store
 * @param {string} kind
 * @param {Record<string, unknown>} data
 */
export function logEvent(store, kind, data) {
  store.append(EVENTS, JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n');
}

/** @param {PrivateStore} store @returns {Record<string, unknown>[]} */
export function readEvents(store) {
  const text = store.read(EVENTS);
  if (!text) return [];
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
