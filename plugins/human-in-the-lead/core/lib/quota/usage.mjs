// Usage readings for quotas (design part 12.5): measured snapshots, and use estimated from the
// ledger. Both are read from the private store.
//
// Snapshots: usage/snapshots.jsonl, one usage-snapshot per line (piece (h)'s status-line command
// appends them; installing that capture is not this piece). A line that fails its schema is
// skipped and counted, never trusted.
//
// Ledger: the seam to piece (b). Until its reader merges, readLedgerEntries is the stand-in: it
// reads ledger.jsonl at the store root and keeps the lines that look like ledger entries. The
// functions below take entries as an array, so swapping the reader changes nothing else.

import { schemas } from '../schema/registry.mjs';
import { readLedger } from '../ledger/ledger.mjs';
import { resetsAtMs } from './window.mjs';

export const SNAPSHOTS_KEY = 'usage/snapshots.jsonl';
export const LEDGER_KEY = 'ledger.jsonl';

/** @typedef {{ read: (key: string) => string | null }} Reader */

/**
 * Parse snapshot lines, validating each.
 * @param {string | null} text
 * @returns {{ snapshots: Record<string, any>[], skipped: number }}
 */
export function parseSnapshots(text) {
  /** @type {Record<string, any>[]} */
  const snapshots = [];
  let skipped = 0;
  const registry = schemas();
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (registry.validateEntity('usage-snapshot', data).length) skipped++;
      else snapshots.push(data);
    } catch {
      skipped++;
    }
  }
  snapshots.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { snapshots, skipped };
}

/** @param {Reader} store */
export const readSnapshots = (store) => parseSnapshots(store.read(SNAPSHOTS_KEY));

/**
 * The ledger's entries, read by piece (b)'s reader (lines that fail validation are its problems,
 * not entries). @param {Reader & Record<string, any>} store @returns {Record<string, any>[]}
 */
export function readLedgerEntries(store) {
  return /** @type {Record<string, any>[]} */ (readLedger(/** @type {any} */ (store)).events);
}

/** Tokens count only as a finite, non-negative number. @param {unknown} n @returns {number} */
export const tokensOf = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);

/**
 * Entries as they stand after corrections. A correction is accepted only when it names an
 * earlier entry of the same item or dispatch; otherwise it is ignored (it neither hides the
 * entry nor is trusted to), so a stray `corrects` cannot erase use.
 * @param {Record<string, any>[]} entries @returns {Record<string, any>[]}
 */
export function effectiveEntries(entries) {
  // Only the first entry with a given ID counts; a duplicate (which the ledger never writes) is
  // dropped, so it can neither be corrected in another's place nor hide one. Corrections are
  // applied to the specific entry by index.
  /** @type {Map<string, number>} */
  const firstAt = new Map();
  entries.forEach((e, i) => {
    if (!firstAt.has(e.id)) firstAt.set(e.id, i);
  });
  /** @type {Set<number>} */
  const hidden = new Set();
  entries.forEach((e, i) => {
    if (firstAt.get(e.id) !== i) {
      hidden.add(i);
      return;
    }
    if (e.corrects === undefined) return;
    const at = firstAt.get(e.corrects);
    if (at === undefined || at >= i) return;
    const t = entries[at];
    const sameItem = e.item !== undefined && e.item === t.item;
    const sameDispatch = e.dispatch !== undefined && e.dispatch === t.dispatch;
    if (sameItem || sameDispatch) hidden.add(at);
  });
  return entries.filter((_, i) => !hidden.has(i));
}

/**
 * What one snapshot says about one limit, or null. A reading by limit ID wins; the status line's
 * percentages feed plan_percent limits on the matching window.
 * @param {Record<string, any>} snapshot
 * @param {{ id: string, unit: string, window: string, limit: number | null }} limit
 * @returns {{ at: number, used: number, resetsAt: number | null } | null}
 */
export function readingFor(snapshot, limit) {
  const at = Date.parse(snapshot.at);
  const named = (snapshot.readings ?? []).find((/** @type {any} */ r) => r.limit === limit.id);
  if (named) return { at, used: named.used, resetsAt: resetsAtMs(named.resets_at) };
  if (limit.unit !== 'plan_percent') return null;
  const w =
    limit.window === 'rolling_5h'
      ? snapshot.rate_limits?.five_hour
      : limit.window === 'weekly'
        ? snapshot.rate_limits?.seven_day
        : undefined;
  if (!w) return null;
  const used = limit.limit == null ? w.used_percentage : (w.used_percentage / 100) * limit.limit;
  return { at, used, resetsAt: resetsAtMs(w.resets_at) };
}

/**
 * Use of a limit estimated from ledger entries inside [start, now]: tokens summed (a corrected
 * entry is dropped for the entry that corrects it), or requests as dispatch events. Other units
 * cannot be estimated from the ledger. Returns the cumulative series so a burn rate can be read.
 * @param {Record<string, any>[]} entries
 * @param {{ unit: string, scope?: { models?: string[] } }} limit
 * @param {{ start: number, now: number }} span
 * @returns {{ used: number, events: number, points: { at: number, used: number }[] } | null}
 */
export function ledgerUsage(entries, limit, span) {
  if (limit.unit !== 'tokens' && limit.unit !== 'requests') return null;
  const models = limit.scope?.models;
  const rows = effectiveEntries(entries)
    .map((e) => ({ e, at: Date.parse(e.at) }))
    .filter(({ e, at }) => at >= span.start && at <= span.now)
    .filter(({ e }) => !models?.length || models.includes(e.model))
    .sort((a, b) => a.at - b.at);
  let used = 0;
  let events = 0;
  /** @type {{ at: number, used: number }[]} */
  const points = [];
  for (const { e, at } of rows) {
    const amount = limit.unit === 'tokens' ? tokensOf(e.tokens) : e.event === 'dispatched' ? 1 : 0;
    if (!amount) continue;
    used += amount;
    events++;
    points.push({ at, used });
  }
  return { used, events, points };
}
