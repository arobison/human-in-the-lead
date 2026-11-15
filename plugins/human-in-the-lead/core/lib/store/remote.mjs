// The store remote: where the private store's encrypted bundles are kept between machines
// (design 0003, sections 4 and 7).
//
// A transport stores opaque bytes and offers compare and swap on a head. It never sees plain text
// or keys: encryption happens before `push` and after `fetch` (age format, HITLD-102), and what to
// push and when is decided by the push and pull commands (HITLD-105). Every transport is one
// module behind this interface; the first is a private git repository (remote-git.mjs).

/**
 * One place bundles are kept. A version id is an opaque string the transport chooses: the same
 * bytes pushed twice get different ids, and ids compare only for equality.
 *
 * @typedef {object} StoreRemote
 * @property {() => Promise<string | null>} head
 *   The remote's current version id, or null when nothing has been pushed.
 * @property {(version: string) => Promise<Buffer>} fetch
 *   The exact bytes pushed as that version. Throws `remote-version-missing` when the remote no
 *   longer holds it (pruned, or never pushed).
 * @property {(bytes: Uint8Array, options: { expected: string | null }) => Promise<string>} push
 *   Compare and swap: add `bytes` as the new head if and only if the remote's head is `expected`
 *   (null: the remote is empty). Returns the new version id. Throws `remote-moved` otherwise,
 *   naming the actual head; the caller pulls, merges and pushes again.
 * @property {(options: { keep: number }) => Promise<{ kept: string[], removed: string[] }>} prune
 *   Drop all but the newest `keep` versions (at least one). The head never changes. `kept` is
 *   oldest first.
 */

/** Every error code this module and its transports throw. Lowercase kebab-case. */
export const REMOTE_ERROR_CODES = Object.freeze(
  /** @type {const} */ ([
    'remote-moved',
    'remote-url-invalid',
    'remote-unreachable',
    'remote-version-missing',
    'remote-version-invalid',
    'remote-corrupt',
    'remote-too-large',
    'remote-argument-invalid',
    'remote-dir-invalid',
    'remote-git-failed',
  ]),
);

/** @typedef {(typeof REMOTE_ERROR_CODES)[number]} RemoteErrorCode */

export class StoreRemoteError extends Error {
  /**
   * @param {RemoteErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'StoreRemoteError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The refusal a stale push gets: the remote's head is not the one the caller expected.
 * @param {string | null} expected @param {string | null} actual
 */
export const remoteMoved = (expected, actual) =>
  new StoreRemoteError(
    'remote-moved',
    `the remote's head is ${actual ?? 'empty'}, not ${expected ?? 'empty'}: pull, merge and push again`,
    { expected, actual },
  );

/** @param {unknown} e whether e is the stale-push refusal */
export const isRemoteMoved = (e) => e instanceof StoreRemoteError && e.code === 'remote-moved';

/**
 * Push, and when the remote has moved, ask the caller to reconcile and try again. `reconcile` gets
 * the remote's actual head; it pulls that version, merges it, and returns the bytes to push on top
 * of it and the head they are based on (what `expected` should now be). Any other error, and the
 * last refusal after `attempts` tries, reaches the caller.
 *
 * @param {StoreRemote} remote
 * @param {{
 *   bytes: Uint8Array,
 *   expected: string | null,
 *   reconcile: (actual: string | null) => Promise<{ bytes: Uint8Array, expected: string | null }>,
 *   attempts?: number,
 * }} options
 * @returns {Promise<string>} the new version id
 */
export async function pushWithRetry(remote, options) {
  const attempts = options.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new StoreRemoteError('remote-argument-invalid', 'attempts must be a positive integer');
  }
  let { bytes, expected } = options;
  for (let i = 1; ; i++) {
    try {
      return await remote.push(bytes, { expected });
    } catch (e) {
      if (!isRemoteMoved(e) || i >= attempts) throw e;
      const actual = /** @type {string | null} */ (
        /** @type {StoreRemoteError} */ (e).detail.actual ?? null
      );
      ({ bytes, expected } = await options.reconcile(actual));
    }
  }
}
