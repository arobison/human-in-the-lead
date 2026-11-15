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
 * @property {{ path: string, target: string }[]} [links_out] links that point outside the worktree
 *
 * @typedef {object} WorktreeLease
 * @property {string} holder
 * @property {string} path
 * @property {string} branch
 * @property {string} repo_root
 * @property {string} base
 * @property {boolean} adopted a harness-created worktree: the manager never removes it
 * @property {'ready' | 'setup-failed' | 'failed'} state
 * @property {string} created_at
 * @property {string} [failed_at]
 * @property {SetupResult} [setup]
 *
 * @typedef {object} Registry
 * @property {1} version
 * @property {Record<string, WorktreeLease>} worktrees keyed by holder
 * @property {Record<string, PortLease>} ports keyed by port number
 */

const REGISTRY_FILE = 'env/holders.json';
/** The file's name before HITLD-82, read until the next minor release when the new one is missing. */
const LEGACY_REGISTRY_FILE = 'env/registry.json';
const EVENTS = 'env/events.jsonl';

/** @returns {Registry} */
const empty = () => ({ version: 1, worktrees: {}, ports: {} });

/**
 * A worktree lease in the current names: `status` (before HITLD-82) is `state`, and
 * `setup_failed` is `setup-failed`.
 * @param {Record<string, any>} lease
 * @returns {WorktreeLease}
 */
function fromLegacyLease(lease) {
  if (!lease || typeof lease !== 'object' || !Object.hasOwn(lease, 'status')) {
    return /** @type {WorktreeLease} */ (lease);
  }
  const { status, ...rest } = lease;
  return /** @type {WorktreeLease} */ ({
    ...rest,
    state: rest.state ?? (status === 'setup_failed' ? 'setup-failed' : status),
  });
}

/** @param {PrivateStore} store @returns {Registry} */
export function readRegistry(store) {
  const text = store.read(REGISTRY_FILE) ?? store.read(LEGACY_REGISTRY_FILE);
  if (text === null) return empty();
  const parsed = JSON.parse(text);
  const out = { ...empty(), ...parsed };
  out.worktrees = Object.fromEntries(
    Object.entries(out.worktrees ?? {}).map(([k, v]) => [k, fromLegacyLease(v)]),
  );
  return out;
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
