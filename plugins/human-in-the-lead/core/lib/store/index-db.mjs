// The ledger index (design part 3.2, Q1): a SQLite file in the private store, local to this
// machine, rebuilt from the ledger's files and never committed or exported. It holds the union of
// the writers' files (ledger/ledger.mjs) and the display numbers people use for dispatches
// (HITLD-74): a dispatch's ID is unique by construction and long; its number is short, and is
// assigned here when the index first ingests the dispatch. A rebuild keeps the numbers already
// assigned and gives new dispatches the next ones, in the order the ledger reads them, so a number
// does not change on this machine. Numbers are this machine's: another machine may number the same
// dispatch differently, so trailers, claims and briefs carry the ID, never the number. Deleting the
// index loses only the numbers, which a rebuild assigns again.
//
// node:sqlite is loaded here only, when the index is built or read, so commands that never touch
// the index never load it.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFile } from './host.mjs';
import { readLedger } from '../ledger/ledger.mjs';

export const INDEX_FILE = 'index.sqlite';
/** The index's own layout version. A different one is rebuilt, never migrated. */
export const INDEX_VERSION = 2;

/**
 * @typedef {import('./store.mjs').PrivateStore} PrivateStore
 * @typedef {{ file: string, events: number, dispatches: number, files: number, ledger_problems: number }} IndexBuilt
 * @typedef {{ number: number, dispatch: string, item: string | null, first_at: string }} DisplayNumber
 */

/**
 * The display numbers an index of this layout already holds, in number order; none without one.
 * @param {any} DatabaseSync @param {string} file @returns {DisplayNumber[]}
 */
function keptNumbers(DatabaseSync, file) {
  if (!existsSync(file)) return [];
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const v = /** @type {{ value: string } | undefined} */ (
      db.prepare("SELECT value FROM meta WHERE key = 'index_version'").get()
    );
    if (Number(v?.value) !== INDEX_VERSION) return [];
    return /** @type {DisplayNumber[]} */ (
      /** @type {unknown} */ (
        db.prepare('SELECT number, dispatch, item, first_at FROM dispatches ORDER BY number').all()
      )
    );
  } catch {
    return []; // a damaged index is rebuilt from nothing
  } finally {
    db?.close();
  }
}

/**
 * Build the index from the ledger's files, replacing any index there was, and keeping the display
 * numbers it had assigned. Written beside, then renamed, so a reader never sees a half-built index.
 * @param {PrivateStore} store
 * @returns {Promise<IndexBuilt>}
 */
export async function rebuildIndex(store) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(store.root, INDEX_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  mkdirSync(store.root, { recursive: true });
  rmSync(tmp, { force: true });
  const { events, problems, files } = readLedger(store);
  const kept = keptNumbers(DatabaseSync, file);
  /** @type {Map<string, DisplayNumber>} */
  const numbers = new Map(kept.map((n) => [n.dispatch, n]));
  let next = kept.reduce((m, n) => Math.max(m, n.number), 0);
  for (const e of events) {
    if (typeof e.dispatch !== 'string' || numbers.has(e.dispatch)) continue;
    numbers.set(e.dispatch, {
      number: ++next,
      dispatch: e.dispatch,
      item: e.item ?? null,
      first_at: String(e.at),
    });
  }
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
      CREATE TABLE dispatches (
        number INTEGER PRIMARY KEY,
        dispatch TEXT NOT NULL UNIQUE,
        item TEXT,
        first_at TEXT NOT NULL
      );
      CREATE TABLE files (key TEXT PRIMARY KEY);
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
    const number = db.prepare(
      'INSERT INTO dispatches (number, dispatch, item, first_at) VALUES (?, ?, ?, ?)',
    );
    for (const n of numbers.values()) number.run(n.number, n.dispatch, n.item, n.first_at);
    const source = db.prepare('INSERT INTO files (key) VALUES (?)');
    for (const key of files) source.run(key);
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('index_version', String(INDEX_VERSION));
    meta.run('events', String(events.length));
    meta.run('ledger_problems', String(problems.length));
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  replaceFile(tmp, file);
  return {
    file,
    events: events.length,
    dispatches: numbers.size,
    files: files.length,
    ledger_problems: problems.length,
  };
}

/**
 * Read the index: its event and dispatch counts and its version, or null when there is none or it is from another
 * layout version (then rebuild it).
 * @param {PrivateStore} store
 * @returns {Promise<{ events: number, dispatches: number, index_version: number } | null>}
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
    const dispatches = /** @type {{ n: number }} */ (
      /** @type {unknown} */ (db.prepare('SELECT count(*) AS n FROM dispatches').get())
    );
    return { events: count.n, dispatches: dispatches.n, index_version: INDEX_VERSION };
  } finally {
    db.close();
  }
}

/**
 * Ingest the ledger into the index (rebuildIndex) and read it back: the latest events, in the
 * order the ledger reads them, and every display number assigned. What people see of the union of
 * the writers' files.
 * @param {PrivateStore} store @param {{ limit?: number }} [options] limit: how many events
 * @returns {Promise<{ total: number, events: Record<string, any>[], numbers: DisplayNumber[], ledger_problems: number }>}
 */
export async function readThroughIndex(store, options = {}) {
  const built = await rebuildIndex(store);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(built.file, { readOnly: true });
  try {
    const limit = Math.max(1, options.limit ?? built.events);
    const rows = /** @type {{ line: string }[]} */ (
      /** @type {unknown} */ (
        db.prepare('SELECT line FROM events ORDER BY seq DESC LIMIT ?').all(limit)
      )
    );
    const numbers = /** @type {DisplayNumber[]} */ (
      /** @type {unknown} */ (
        db.prepare('SELECT number, dispatch, item, first_at FROM dispatches ORDER BY number').all()
      )
    );
    return {
      total: built.events,
      events: rows.reverse().map((r) => JSON.parse(r.line)),
      numbers,
      ledger_problems: built.ledger_problems,
    };
  } finally {
    db.close();
  }
}
