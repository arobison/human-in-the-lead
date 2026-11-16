// The ledger (design part 5.4): ledger.jsonl at the root of the private store, one JSON event per
// line, append-only. Corrections are new events that reference the old one.
//
// A line is committed when it is complete, so a crash during an append can leave only a torn last
// line (no trailing newline, not valid JSON). Reading ignores it and the next append cuts it off.
// Every event has a unique ID, so appending the same event twice (a retry after a crash) is a
// no-op, which is what makes applying an event idempotent (design part 13.1).
//
// The ledger is never rewritten, so its reader takes every name it ever held (design part 16.5).
// Schema version 1 named three events and two fields differently: `claimed` (now `started`: the
// harness started the executor), `question` (now `asked`), `released` (now `unclaimed`: a claim
// given up), `outcome` (now `result`: how the attempt ended) and `handle` (now `harness_ref`). A
// line in the old names is read in the new ones, permanently; new lines are written in the new
// names, at version 2.

import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} LedgerEntry a validated line; see schemas/ledger-entry.schema.json
 * @typedef {{ line: number, message: string }} LedgerProblem
 * @typedef {{ events: LedgerEntry[], problems: LedgerProblem[], torn: boolean }} LedgerRead
 */

export const LEDGER_KEY = 'ledger.jsonl';

/**
 * Events about a decision or a call, not about a dispatch's life: one may name a dispatch (the
 * one whose report raised the question) after that dispatch has ended.
 */
export const DECISION_EVENTS = Object.freeze(['asked', 'sent', 'answered', 'logged']);

/**
 * Events that end a dispatch: nothing more is expected of its executor. `interrupted` ends one the
 * watchdog stopped so that it continues as a follow-up (a new dispatch on the same agent).
 */
export const TERMINAL_EVENTS = Object.freeze(['reported', 'abandoned', 'unclaimed', 'interrupted']);

/** Event names before schema version 2, and what each is now. Read permanently. */
export const LEGACY_EVENTS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    claimed: 'started',
    question: 'asked',
    released: 'unclaimed',
  }),
);

/** Field names before schema version 2. */
const LEGACY_FIELDS = /** @type {Record<string, string>} */ ({
  outcome: 'result',
  handle: 'harness_ref',
});

/**
 * A ledger line in the current names: an event in the names of schema version 1 is read as
 * version 2 names (`claimed` → `started`, `question` → `asked`, `released` → `unclaimed`,
 * `outcome` → `result`, `handle` → `harness_ref`, `skill_versions.plugin` →
 * `skill_versions.hitld_version`). Its schema_version stays as written.
 * @param {unknown} data
 * @returns {unknown}
 */
export function fromLegacyEvent(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const e = /** @type {Record<string, unknown>} */ (data);
  const event = typeof e.event === 'string' ? LEGACY_EVENTS[e.event] : undefined;
  const fields = Object.keys(LEGACY_FIELDS).filter((k) => Object.hasOwn(e, k));
  const sv = /** @type {Record<string, unknown> | undefined} */ (e.skill_versions);
  const oldPlugin = sv && typeof sv === 'object' && Object.hasOwn(sv, 'plugin');
  if (!event && !fields.length && !oldPlugin) return data;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    const to = LEGACY_FIELDS[k];
    if (to !== undefined) {
      if (!Object.hasOwn(e, to)) out[to] = v;
    } else out[k] = k === 'event' && event ? event : v;
  }
  if (oldPlugin && sv) {
    const { plugin, ...rest } = sv;
    out.skill_versions = { hitld_version: plugin, ...rest };
  }
  return out;
}

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
  'lease-released': ['run', 'session', 'host', 'reason', 'by'],
  'merge-approved': ['branches', 'presented_at', 'commit', 'by'],
  dispatched: ['dispatch', 'item'],
  started: ['dispatch', 'item'],
  asked: ['decision'],
  sent: ['decision'],
  answered: ['decision'],
  reported: ['dispatch', 'item'],
  verified: ['item', 'result'],
  merged: ['item'],
  reverted: ['item'],
  unclaimed: ['item'],
  abandoned: ['dispatch', 'item'],
  logged: ['text'],
  stalled: ['dispatch', 'item', 'reason', 'step'],
  poked: ['dispatch', 'item'],
  interrupted: ['dispatch', 'item'],
  paused: ['limit'],
  resumed: ['reason'],
};

/** @type {Record<string, string[]>} */
const RESULTS = { reported: ['done', 'partial', 'blocked'], verified: ['pass', 'fail'] };

/** Which reasons each event may give. @type {Record<string, string[]>} */
const REASONS = {
  'lease-released': ['handover', 'ended'],
  stalled: ['no_progress', 'deadline', 'limit', 'exited'],
  resumed: ['reset', 'budget'],
  // A report that showed the contract's commands refused (dispatch/permissions.mjs).
  reported: ['executor-permissions'],
};

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
  if (e.result !== undefined) {
    const allowed = RESULTS[e.event];
    if (!allowed) errors.push({ path: 'result', message: `is not used by ${e.event}` });
    else if (!allowed.includes(e.result)) {
      errors.push({ path: 'result', message: `must be ${allowed.join(' or ')} for ${e.event}` });
    }
  }
  if (e.reason !== undefined) {
    const allowed = REASONS[e.event];
    if (!allowed) errors.push({ path: 'reason', message: `is not used by ${e.event}` });
    else if (!allowed.includes(e.reason)) {
      errors.push({ path: 'reason', message: `must be ${allowed.join(', ')} for ${e.event}` });
    }
  }
  if (e.step !== undefined && e.event !== 'stalled') {
    errors.push({ path: 'step', message: 'is only for stalled' });
  }
  if (e.defects !== undefined && !(e.event === 'verified' && e.result === 'fail')) {
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
      data = /** @type {any} */ (fromLegacyEvent(JSON.parse(raw)));
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
 * - A dispatch takes at most one terminal event (reported, abandoned or unclaimed), and nothing
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
      if (ended && !['verified', 'merged', 'reverted', ...DECISION_EVENTS].includes(entry.event)) {
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
