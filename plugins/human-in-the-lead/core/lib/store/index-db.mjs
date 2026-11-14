// The ledger index (design part 3.2, Q1): a SQLite file in the private store, local to this
// machine, rebuilt from ledger.jsonl and never committed or exported. Deleting it loses nothing.
//
// node:sqlite is loaded here only, when the index is built or read, so commands that never touch
// the index never load it.

import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGER_KEY, readLedger } from '../ledger/ledger.mjs';

export const INDEX_FILE = 'index.sqlite';
/** The index's own layout version. A different one is rebuilt, never migrated. */
export const INDEX_VERSION = 1;

/**
 * @typedef {import('./store.mjs').PrivateStore} PrivateStore
 * @typedef {{ file: string, events: number, ledger_problems: number }} IndexBuilt
 */

/**
 * Build the index from the ledger, replacing any index there was. Written beside, then renamed,
 * so a reader never sees a half-built index.
 * @param {PrivateStore} store
 * @returns {Promise<IndexBuilt>}
 */
export async function rebuildIndex(store) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(store.root, INDEX_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  const { events, problems } = readLedger(store);
  const db = new DatabaseSync(tmp);
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE events (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        event TEXT NOT NULL,
        at TEXT NOT NULL,
        run TEXT,
        dispatch TEXT,
        item TEXT,
        line TEXT NOT NULL
      );
      CREATE INDEX events_item ON events (item);
      CREATE INDEX events_dispatch ON events (dispatch);
      CREATE INDEX events_event ON events (event, at);
    `);
    const put = db.prepare(
      'INSERT INTO events (seq, id, event, at, run, dispatch, item, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    events.forEach((e, i) =>
      put.run(
        i + 1,
        String(e.id),
        String(e.event),
        String(e.at),
        e.run ?? null,
        e.dispatch ?? null,
        e.item ?? null,
        JSON.stringify(e),
      ),
    );
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('index_version', String(INDEX_VERSION));
    meta.run('source', LEDGER_KEY);
    meta.run('events', String(events.length));
    meta.run('ledger_problems', String(problems.length));
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  renameSync(tmp, file);
  return { file, events: events.length, ledger_problems: problems.length };
}

/**
 * Read the index: its event count and version, or null when there is none or it is from another
 * layout version (then rebuild it).
 * @param {PrivateStore} store
 * @returns {Promise<{ events: number, index_version: number } | null>}
 */
export async function readIndex(store) {
  const file = join(store.root, INDEX_FILE);
  if (!existsSync(file)) return null;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = /** @type {{ key: string, value: string }[]} */ (
      /** @type {unknown} */ (db.prepare('SELECT key, value FROM meta').all())
    );
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (Number(meta.index_version) !== INDEX_VERSION) return null;
    const count = /** @type {{ n: number }} */ (
      /** @type {unknown} */ (db.prepare('SELECT count(*) AS n FROM events').get())
    );
    return { events: count.n, index_version: INDEX_VERSION };
  } finally {
    db.close();
  }
}
