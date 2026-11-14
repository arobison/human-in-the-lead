// The ledger (design part 5.4): ledger.jsonl at the root of the private store, one JSON event per
// line, append-only. Corrections are new events that reference the old one.
//
// A line is committed when it is complete, so a crash during an append can leave only a torn last
// line (no trailing newline, not valid JSON). Reading ignores it and the next append cuts it off.
// Every event has a unique ID, so appending the same event twice (a retry after a crash) is a
// no-op, which is what makes applying an event idempotent (design part 13.1).

import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} LedgerEntry a validated line; see schemas/ledger-entry.schema.json
 * @typedef {{ line: number, message: string }} LedgerProblem
 * @typedef {{ events: LedgerEntry[], problems: LedgerProblem[], torn: boolean }} LedgerRead
 */

export const LEDGER_KEY = 'ledger.jsonl';

/** Events that end a dispatch: nothing more is expected of its executor. */
export const TERMINAL_EVENTS = Object.freeze(['reported', 'abandoned', 'released']);

export class LedgerError extends Error {
  /** @param {string} message @param {{ path: string, message: string }[]} [errors] */
  constructor(message, errors = []) {
    super(message);
    this.name = 'LedgerError';
    this.errors = errors;
  }
}

/**
 * What each event kind must carry, beyond the schema (which lists every field as optional).
 * @type {Record<string, string[]>}
 */
const REQUIRED = {
  'run-started': ['run', 'session', 'host'],
  'lease-taken': ['run', 'session', 'host'],
  dispatched: ['dispatch', 'item'],
  claimed: ['dispatch', 'item'],
  question: ['decision'],
  answered: ['decision'],
  reported: ['dispatch', 'item'],
  verified: ['item', 'outcome'],
  merged: ['item'],
  reverted: ['item'],
  released: ['item'],
  abandoned: ['dispatch', 'item'],
};

/** @type {Record<string, string[]>} */
const OUTCOMES = { reported: ['done', 'partial', 'blocked'], verified: ['pass', 'fail'] };

/**
 * Semantic checks the schema cannot express.
 * @param {LedgerEntry} e @returns {{ path: string, message: string }[]}
 */
function checkEventRules(e) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  for (const f of REQUIRED[e.event] ?? []) {
    if (e[f] === undefined) errors.push({ path: f, message: `is required for ${e.event}` });
  }
  if (e.outcome !== undefined) {
    const allowed = OUTCOMES[e.event];
    if (!allowed) errors.push({ path: 'outcome', message: `is not used by ${e.event}` });
    else if (!allowed.includes(e.outcome)) {
      errors.push({ path: 'outcome', message: `must be ${allowed.join(' or ')} for ${e.event}` });
    }
  }
  if (e.defects !== undefined && !(e.event === 'verified' && e.outcome === 'fail')) {
    errors.push({ path: 'defects', message: 'is only for a failed verification' });
  }
  return errors;
}

/**
 * Read the whole ledger. Lines that are not valid events are reported, not thrown, so a damaged
 * ledger can still be summarized and repaired by hand.
 * @param {PrivateStore} store @returns {LedgerRead}
 */
export function readLedger(store) {
  const text = store.read(LEDGER_KEY) ?? '';
  const lines = text.split('\n');
  // The last element is '' after a trailing newline, or an unfinished line a crash left.
  const unfinished = lines.pop() ?? '';
  const torn = unfinished !== '';
  if (torn && parses(unfinished)) lines.push(unfinished); // complete, only the newline is missing
  /** @type {LedgerEntry[]} */
  const events = [];
  /** @type {LedgerProblem[]} */
  const problems = [];
  lines.forEach((raw, i) => {
    if (raw.trim() === '') return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      problems.push({ line: i + 1, message: `is not JSON: ${/** @type {Error} */ (e).message}` });
      return;
    }
    const errors = [
      ...schemas().validateEntity('ledger-entry', data),
      ...(data && typeof data === 'object' ? checkEventRules(data) : []),
    ];
    if (errors.length) {
      problems.push({
        line: i + 1,
        message: errors.map((er) => `${er.path} ${er.message}`).join('; '),
      });
      return;
    }
    events.push(data);
  });
  return { events, problems, torn };
}

/** @param {string} text */
function parses(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** @param {LedgerEntry[]} events @param {RegExp} pattern @param {string} field */
function maxSuffix(events, pattern, field) {
  let max = 0;
  for (const e of events) {
    const m = pattern.exec(String(e[field] ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * The next dispatch ID: one above the highest D-<n> in the ledger.
 * @param {PrivateStore | LedgerEntry[]} source
 */
export function nextDispatchId(source) {
  const events = Array.isArray(source) ? source : readLedger(source).events;
  return `D-${maxSuffix(events, /^D-(\d+)$/, 'dispatch') + 1}`;
}

/**
 * The ID a lifecycle event gets by default, so that recording it twice is a no-op.
 * @param {string} event @param {string} dispatch
 */
export const lifecycleId = (event, dispatch) => `${event}-${dispatch}`;

/**
 * Whether `correction` may correct `target`: the same kind of event, about the same item or the
 * same dispatch (the rule core/lib/quota/usage.mjs applies to the same ledger).
 * @param {LedgerEntry} target @param {LedgerEntry} correction
 */
export const correctsValidly = (target, correction) =>
  target.event === correction.event &&
  ((correction.item !== undefined && correction.item === target.item) ||
    (correction.dispatch !== undefined && correction.dispatch === target.dispatch));

/** Two events are the same event if they differ only in when they were written. @param {LedgerEntry} a @param {LedgerEntry} b */
const sameEvent = (a, b) => {
  const strip = (/** @type {LedgerEntry} */ e) => JSON.stringify({ ...e, at: undefined });
  return strip(a) === strip(b);
};

/**
 * Append one event: fill in schema_version, id and time; validate; then write one line.
 * - An event whose ID is already in the ledger and is otherwise identical is not appended again
 *   (`appended: false`); with different content it is an error.
 * - A dispatch takes at most one terminal event (reported, abandoned or released), and nothing
 *   else after it, so a stale session cannot revive or double-finish a dispatch.
 * @param {PrivateStore} store
 * @param {LedgerEntry} event
 * @param {{ now?: () => Date }} [options]
 * @returns {{ event: LedgerEntry, appended: boolean, events: LedgerEntry[] }}
 *   events: the whole ledger after the call
 */
export function appendEvent(store, event, options = {}) {
  const now = options.now ?? (() => new Date());
  const registry = schemas();
  const { events, torn } = readLedger(store);
  /** @type {LedgerEntry} */
  const entry = {
    schema_version: registry.currentVersion('ledger-entry'),
    ...event,
    at: event.at ?? now().toISOString(),
  };
  entry.id ??= `E-${maxSuffix(events, /^E-(\d+)$/, 'id') + 1}`;

  const errors = [...registry.validateEntity('ledger-entry', entry), ...checkEventRules(entry)];
  if (errors.length) {
    throw new LedgerError(
      `invalid ledger event: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
      errors,
    );
  }

  const same = events.find((e) => e.id === entry.id);
  if (same) {
    if (!sameEvent(same, entry)) {
      throw new LedgerError(`ledger event ${entry.id} already exists with different content`);
    }
    return { event: same, appended: false, events };
  }
  if (entry.corrects !== undefined && !events.some((e) => e.id === entry.corrects)) {
    throw new LedgerError(`corrects ${entry.corrects}, which is not in the ledger`);
  }
  if (entry.dispatch !== undefined) {
    const mine = events.filter((e) => e.dispatch === entry.dispatch && e.corrects === undefined);
    if (entry.event === 'dispatched' && mine.some((e) => e.event === 'dispatched')) {
      throw new LedgerError(`${entry.dispatch} was already dispatched`);
    }
    if (entry.corrects === undefined) {
      const ended = mine.find((e) => TERMINAL_EVENTS.includes(e.event));
      if (ended && !['verified', 'merged', 'reverted'].includes(entry.event)) {
        throw new LedgerError(
          `${entry.dispatch} already ended with ${ended.event} (${ended.id}); record a correction instead`,
        );
      }
    }
  }

  const line = JSON.stringify(entry) + '\n';
  if (torn) {
    // A crash left an unfinished last line: keep it if it is whole, cut it off if not.
    const text = store.read(LEDGER_KEY) ?? '';
    const cut = text.lastIndexOf('\n') + 1;
    const kept = parses(text.slice(cut)) ? text + '\n' : text.slice(0, cut);
    store.write(LEDGER_KEY, kept + line);
  } else {
    store.append(LEDGER_KEY, line);
  }
  return { event: entry, appended: true, events: [...events, entry] };
}
