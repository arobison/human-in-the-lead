// Which ledger file a writer appends to (HITLD-74, HITLD-486, design part 5.4). Each writer, each
// orchestrator session and the chief of staff, appends to its own file, ledger/<writer>.jsonl in
// the private store, so no two writers share a file and two stores that both appended merge with
// nothing to reconcile. The project's ledger is the union of those files and of the single
// ledger.jsonl written before the change, which is kept as it is and never appended to again.
//
// The writer, first that gives one:
//   1. the writer the caller names;
//   2. for anyone but an executor, the session as every command resolves it (run/identity.mjs):
//      $HITLD_SESSION, else the harness's session ID, else the session recorded for this worktree
//      by run start or run resume;
//   3. this store's own writer on this machine: a random ID kept in ledger-writer.json, which is
//      machine-local (store/git.mjs), so a store moved to another machine or container writes a
//      new file there. A store directory copied whole takes the record with it; the copy then
//      shares its writer's file until the record is deleted (the next append makes a new one).
// An executor (cli/executor.mjs: the dispatch's environment or a linked worktree) is never
// written as its orchestrator's session: it inherits that session's variables. A session is
// named by a hash of its ID, so file names say nothing about the session.

import { createHash, randomBytes } from 'node:crypto';
import { executorSignal } from '../cli/executor.mjs';
import { resolveIdentity } from '../run/identity.mjs';

/** The ledger written before HITLD-74: read, never appended to. */
export const LEGACY_LEDGER_KEY = 'ledger.jsonl';
/** The directory of per-writer ledger files. */
export const LEDGER_DIR = 'ledger/';
/** This store's own writer on this machine. Machine-local. */
export const WRITER_KEY = 'ledger-writer.json';

const WRITER = /^w-[0-9a-f]{16}$/;

/** @param {string} writer */
export const ledgerKeyOf = (writer) => `${LEDGER_DIR}${writer}.jsonl`;

/** @param {string} key whether a store key is a per-writer ledger file */
export const isWriterFile = (key) =>
  key.startsWith(LEDGER_DIR) &&
  key.endsWith('.jsonl') &&
  WRITER.test(key.slice(LEDGER_DIR.length, -'.jsonl'.length));

/**
 * The ledger's files in the order they are read: the legacy file first, then each writer's. A
 * store that cannot list its keys (a reader of one file) has only the legacy file.
 * @param {{ list?: (prefix?: string) => string[], read: (key: string) => string | null }} store
 */
export function ledgerKeys(store) {
  const writers =
    typeof store.list === 'function' ? store.list(LEDGER_DIR).filter(isWriterFile) : [];
  return store.read(LEGACY_LEDGER_KEY) === null ? writers : [LEGACY_LEDGER_KEY, ...writers];
}

/** @param {string} session */
export const writerOfSession = (session) =>
  `w-${createHash('sha256').update(`session:${session}`).digest('hex').slice(0, 16)}`;

/** executorSignal runs git once per directory and dispatch environment, not once per append. */
const executors = new Map();
/** @param {NodeJS.ProcessEnv} env @param {string} cwd */
function isExecutor(env, cwd) {
  const key = [cwd, env.HITLD_ROLE ?? '', env.HITLD_DISPATCH ?? ''].join('\0');
  if (!executors.has(key)) executors.set(key, executorSignal(env, cwd) !== null);
  return /** @type {boolean} */ (executors.get(key));
}

/**
 * The writer this process appends as.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {{ writer?: string, env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 * @returns {string}
 */
export function resolveWriter(store, options = {}) {
  if (options.writer !== undefined) {
    if (!WRITER.test(options.writer)) {
      throw new Error(`ledger writer ${JSON.stringify(options.writer)} is not w-<16 hex>`);
    }
    return options.writer;
  }
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  if (isExecutor(env, cwd)) return storeWriter(store);
  const { session } = resolveIdentity({ env, cwd, store });
  return session ? writerOfSession(session) : storeWriter(store);
}

/** This store's own writer on this machine, made on first use. @param {import('../store/store.mjs').PrivateStore} store */
function storeWriter(store) {
  try {
    const kept = JSON.parse(store.read(WRITER_KEY) ?? 'null');
    if (kept && typeof kept.writer === 'string' && WRITER.test(kept.writer)) return kept.writer;
  } catch {
    // A damaged record is replaced: the old file stays part of the union.
  }
  const writer = `w-${randomBytes(8).toString('hex')}`;
  store.write(WRITER_KEY, `${JSON.stringify({ writer }, null, 2)}\n`);
  return writer;
}
