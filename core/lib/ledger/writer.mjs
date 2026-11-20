// Which ledger file a writer appends to (HITLD-74, HITLD-486, design part 5.4). Each writer, each
// orchestrator session and the chief of staff, appends to its own file, ledger/<writer>.jsonl in
// the private store, so no two writers share a file and two stores that both appended merge with
// nothing to reconcile. The project's ledger is the union of those files and of the single
// ledger.jsonl written before the change, which is kept as it is and never appended to again.
//
// The writer, first that gives one:
//   1. the writer the caller names;
//   2. the session: $HITLD_SESSION, else the harness's session ID (not for an executor, which
//      shares its orchestrator's harness variables);
//   3. this store's own writer on this machine: a random ID kept in ledger-writer.json, which is
//      machine-local (store/git.mjs), so a store moved to another machine or container writes a
//      new file there.
// A session is named by a hash of its ID, so file names say nothing about the session.

import { createHash, randomBytes } from 'node:crypto';
import * as claudeCode from '../../harness/claude-code/session.mjs';

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

/**
 * The writer this process appends as.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {{ writer?: string, env?: NodeJS.ProcessEnv }} [options]
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
  const executor = env.HITLD_ROLE === 'executor' || Boolean(env.HITLD_DISPATCH);
  const session =
    (typeof env.HITLD_SESSION === 'string' && env.HITLD_SESSION) ||
    (executor ? null : claudeCode.sessionIdOf(env));
  if (session) return writerOfSession(session);
  return storeWriter(store);
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
