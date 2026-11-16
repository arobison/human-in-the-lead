// Messages between the chief of staff and the orchestrator (HITLD-144). On the web, an
// orchestrator's turn ending delivers nothing to the chief of staff: only an explicit message does.
// A turn that ends without one leaves the run waiting, unseen. The chief of staff records the wakes
// it sends (`hitld run woke`) and the messages that reach it (`hitld run heard`), and the watchdog
// flags an orchestrator that was woken, or recorded work, after the last message heard and has been
// quiet since for longer than policy orchestrator.silent_after_seconds.
//
// The record lives in the private store under run/, which is machine-local (store/git.mjs,
// MACHINE_LOCAL): it is the chief of staff's own record on its machine, where it runs the watch.
// One record per store; each write replaces the field it names and keeps the other.

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {{ schema_version: 1, heard_at?: string, heard_from?: string, woke_at?: string, woke_to?: string }} MessageRecord
 * @typedef {{ session: string, since: string, quiet_seconds: number, silent_after_seconds: number, heard_at: string | null, woke_at: string | null, why: string }} Silent
 */

export const MESSAGES_KEY = 'run/messages.json';

/** The default quiet time, in seconds, after which an unanswered orchestrator counts as silent. */
export const SILENT_AFTER_SECONDS = 900;

/** @param {unknown} v */
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/**
 * The record, or null when there is none or it is damaged (a damaged record is no record: the next
 * write replaces it).
 * @param {PrivateStore} store @returns {MessageRecord | null}
 */
export function readMessages(store) {
  let raw;
  try {
    raw = store.read(MESSAGES_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw);
    if (!r || r.schema_version !== 1) return null;
    /** @type {MessageRecord} */
    const out = { schema_version: 1 };
    for (const k of /** @type {const} */ (['heard_at', 'woke_at'])) if (isTime(r[k])) out[k] = r[k];
    for (const k of /** @type {const} */ (['heard_from', 'woke_to'])) {
      if (typeof r[k] === 'string' && r[k]) out[k] = r[k];
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Record a message from the orchestrator (`heard`) or a wake sent to it (`woke`).
 * @param {PrivateStore} store @param {'heard' | 'woke'} what
 * @param {{ session?: string, now?: Date }} [options] session: who sent it, or whom it went to
 * @returns {MessageRecord}
 */
export function recordMessage(store, what, options = {}) {
  const now = options.now ?? new Date();
  /** @type {Record<string, unknown>} */
  const record = { ...(readMessages(store) ?? { schema_version: 1 }) };
  const [at, who] = what === 'heard' ? ['heard_at', 'heard_from'] : ['woke_at', 'woke_to'];
  record[at] = now.toISOString();
  if (options.session) record[who] = options.session;
  else delete record[who];
  store.write(MESSAGES_KEY, `${JSON.stringify(record, null, 2)}\n`);
  return /** @type {MessageRecord} */ (/** @type {unknown} */ (record));
}

/**
 * Whether the orchestrator holding the lease has gone silent: it was woken, or renewed the lease,
 * after the last message the chief of staff heard, and nothing has been heard for longer than
 * `afterSeconds` since. Null when no chief of staff records messages here (no record), when the
 * lease was released (a hand-over or a retired session: the chief of staff starts a successor), or
 * when all is well. An expired lease still counts: an orchestrator waiting between wakes does not
 * renew it, and its holder is the one that went silent.
 * @param {{
 *   record: MessageRecord | null,
 *   lease: { released?: unknown, session?: string, harness_ref?: string | null, renewed_at?: string },
 *   now: number,
 *   afterSeconds?: number,
 * }} input
 * @returns {Silent | null}
 */
export function silentOrchestrator({ record, lease, now, afterSeconds = SILENT_AFTER_SECONDS }) {
  if (!record || lease.released) return null;
  const woke = record.woke_at ? Date.parse(record.woke_at) : -Infinity;
  const renewed = isTime(lease.renewed_at)
    ? Date.parse(/** @type {string} */ (lease.renewed_at))
    : -Infinity;
  const since = Math.max(woke, renewed);
  if (!Number.isFinite(since)) return null;
  const heard = record.heard_at ? Date.parse(record.heard_at) : -Infinity;
  if (heard >= since) return null;
  const quiet = Math.floor((now - since) / 1000);
  if (quiet < afterSeconds) return null;
  const session = lease.harness_ref ?? lease.session ?? 'unknown';
  const cause = woke >= renewed ? 'was woken' : 'recorded work';
  return {
    session,
    since: new Date(since).toISOString(),
    quiet_seconds: quiet,
    silent_after_seconds: afterSeconds,
    heard_at: record.heard_at ?? null,
    woke_at: record.woke_at ?? null,
    why: `the orchestrator ${cause} at ${new Date(since).toISOString()} and no message has reached the chief of staff since${record.heard_at ? ` (last heard ${record.heard_at})` : ''}: its turn ended without one`,
  };
}
