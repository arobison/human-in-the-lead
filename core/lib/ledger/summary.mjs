// The run report from the ledger (design parts 5.4 and 11.1): tokens per accepted item,
// first-pass yield, waste, decision latency. Numbers that cannot be computed are null, never
// guessed: a ledger with no verified items has no first-pass yield.
//
// Definitions, where the design leaves room:
// - An item is accepted when it has a `merged` event and no later `reverted` event.
// - Tokens per accepted item: all tokens of all dispatches on the item, executors and verifiers
//   alike. Dispatches whose completion notice gave no tokens are counted separately, not as zero.
// - First-pass yield, of accepted items: the share that had exactly one executor dispatch, whose
//   first verification passed and was never followed by a failed one.
// - Waste: tokens on dispatches that were abandoned, whose work failed verification (a `verified`
//   fail naming the dispatch) or whose merge was reverted (a `reverted` naming the dispatch).
//   Speculation cost is not separate yet: nothing in the ledger marks a speculative dispatch.
// - Decision latency: from an `asked` to the `answered` for the same decision, and split at the
//   `sent` event into queue time (held for a digest) and owner time (shown, unanswered).
// - Stall rate: of executor dispatches, the share the watchdog found stalled (a `stalled` event for
//   any reason but a usage limit, which is not the executor's failure), by model, tier and area as
//   dispatched; with the ladder steps taken, executors cut off by a limit, and quota pauses.

import { TERMINAL_EVENTS, correctsValidly, readLedger } from './ledger.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('./ledger.mjs').LedgerEntry} LedgerEntry
 */

/** @param {number[]} xs sorted ascending @param {number} p 0..1 */
const percentile = (xs, p) =>
  xs.length ? xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)] : null;
/** @param {number[]} xs */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Events as they stand after corrections: an event named by a later correction is dropped, and
 * the correcting event stands in its place. A correction counts only when it names an earlier
 * event of the same kind about the same item or dispatch; any other (a stray `corrects`) is
 * ignored: it hides nothing.
 * @param {LedgerEntry[]} events
 */
export function effectiveEvents(events) {
  /** @type {Map<string, number>} */
  const firstAt = new Map();
  events.forEach((e, i) => {
    if (!firstAt.has(e.id)) firstAt.set(e.id, i);
  });
  /** @type {Set<number>} */
  const hidden = new Set();
  events.forEach((e, i) => {
    if (e.corrects === undefined) return;
    const at = firstAt.get(e.corrects);
    if (at !== undefined && at < i && correctsValidly(events[at], e)) hidden.add(at);
  });
  return events.filter((_, i) => !hidden.has(i));
}

/**
 * @param {LedgerEntry[]} allEvents
 */
export function summarize(allEvents) {
  const events = effectiveEvents(allEvents);

  /** @type {Map<string, { item: string, role?: string, tokens: number, tokenless: boolean, abandoned: boolean, failed: boolean, reverted: boolean, ended: boolean }>} */
  const dispatches = new Map();
  /** @type {Map<string, LedgerEntry[]>} */
  const byItem = new Map();
  for (const e of events) {
    if (e.item !== undefined) {
      if (!byItem.has(e.item)) byItem.set(e.item, []);
      /** @type {LedgerEntry[]} */ (byItem.get(e.item)).push(e);
    }
    if (e.dispatch === undefined) continue;
    let d = dispatches.get(e.dispatch);
    if (!d) {
      d = {
        item: e.item,
        tokens: 0,
        tokenless: true,
        abandoned: false,
        failed: false,
        reverted: false,
        ended: false,
      };
      dispatches.set(e.dispatch, d);
    }
    if (e.role !== undefined) d.role = e.role;
    if (typeof e.tokens === 'number') {
      d.tokens += e.tokens;
      d.tokenless = false;
    }
    if (e.event === 'abandoned') d.abandoned = true;
    if (e.event === 'verified' && e.result === 'fail') d.failed = true;
    if (e.event === 'reverted') d.reverted = true;
    if (TERMINAL_EVENTS.includes(e.event)) d.ended = true;
  }

  // Accepted items: merged, and not reverted since.
  /** @type {string[]} */
  const accepted = [];
  for (const [item, evs] of byItem) {
    const lastMerge = evs.findLastIndex((e) => e.event === 'merged');
    if (lastMerge >= 0 && !evs.slice(lastMerge + 1).some((e) => e.event === 'reverted')) {
      accepted.push(item);
    }
  }

  // Tokens per accepted item.
  /** @type {Record<string, number>} */
  const perItem = {};
  let unknown = 0;
  for (const item of accepted) {
    let sum = 0;
    for (const d of dispatches.values()) {
      if (d.item !== item) continue;
      sum += d.tokens;
      if (d.tokenless && d.ended) unknown++;
    }
    perItem[item] = sum;
  }
  const sums = Object.values(perItem).sort((a, b) => a - b);

  // First-pass yield, of accepted items.
  let firstPass = 0;
  for (const item of accepted) {
    const evs = byItem.get(item) ?? [];
    const executors = new Set(
      evs
        .filter((e) => e.event === 'dispatched' && (e.role ?? 'executor') === 'executor')
        .map((e) => e.dispatch),
    );
    const verdicts = evs.filter((e) => e.event === 'verified').map((e) => e.result);
    if (executors.size === 1 && verdicts[0] === 'pass' && !verdicts.includes('fail')) firstPass++;
  }

  // Waste.
  const byCause = { abandoned: 0, failed_verification: 0, reverted: 0 };
  let wasteTokens = 0;
  let wastedDispatches = 0;
  let totalTokens = 0;
  for (const d of dispatches.values()) {
    totalTokens += d.tokens;
    const causes = /** @type {const} */ ([
      ['abandoned', d.abandoned],
      ['failed_verification', d.failed],
      ['reverted', d.reverted],
    ]).filter(([, hit]) => hit);
    if (!causes.length) continue;
    wastedDispatches++;
    wasteTokens += d.tokens;
    byCause[causes[0][0]] += d.tokens; // each dispatch counted once, under its first cause
  }

  // Decision latency: from `asked` to `answered`, split at `sent` into queue time (asked to sent)
  // and owner time (sent to answered). A decision never shown has no queue time, and its owner
  // time runs from `asked`. Only the first of each event counts.
  /** @type {Map<string, { asked: number, sent?: number }>} */
  const waiting = new Map();
  let defaulted = 0;
  /** @type {number[]} */
  const latencies = [];
  /** @type {number[]} */
  const queues = [];
  /** @type {number[]} */
  const owners = [];
  for (const e of events) {
    if (e.decision === undefined) continue;
    const at = Date.parse(e.at);
    if (e.event === 'asked' && !waiting.has(e.decision)) waiting.set(e.decision, { asked: at });
    const w = waiting.get(e.decision);
    if (!w) continue;
    if (e.event === 'sent' && w.sent === undefined) w.sent = at;
    if (e.event === 'answered' && e.via === 'default') {
      // No one answered: a default took the question, so it says nothing about how long the person took.
      waiting.delete(e.decision);
      defaulted++;
    } else if (e.event === 'answered') {
      latencies.push(at - w.asked);
      if (w.sent !== undefined) queues.push(w.sent - w.asked);
      owners.push(at - (w.sent ?? w.asked));
      waiting.delete(e.decision);
    }
  }
  latencies.sort((a, b) => a - b);
  queues.sort((a, b) => a - b);
  owners.sort((a, b) => a - b);
  /** @param {number[]} xs */
  const spread = (xs) => ({
    count: xs.length,
    median: percentile(xs, 0.5),
    p90: percentile(xs, 0.9),
    mean: mean(xs),
  });

  const verifiedItems = [...byItem].filter(([, evs]) => evs.some((e) => e.event === 'verified'));
  const stalls = stallMeasures(events);
  return {
    events: events.length,
    dispatches: dispatches.size,
    items_accepted: accepted.length,
    tokens_per_accepted_item: {
      mean: mean(sums),
      median: percentile(sums, 0.5),
      total: sums.reduce((a, b) => a + b, 0),
      by_item: perItem,
      dispatches_without_token_counts: unknown,
    },
    first_pass_yield: {
      value: accepted.length ? firstPass / accepted.length : null,
      passed: firstPass,
      of: accepted.length,
      items_verified: verifiedItems.length,
    },
    waste: {
      tokens: wasteTokens,
      share_of_tokens: totalTokens ? wasteTokens / totalTokens : null,
      dispatches: wastedDispatches,
      by_cause: byCause,
    },
    decision_latency_ms: {
      answered: latencies.length,
      defaulted,
      open: waiting.size,
      median: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      mean: mean(latencies),
      queue: spread(queues),
      owner: spread(owners),
    },
    logged_calls: loggedMeasures(events),
    stalls,
  };
}

/**
 * The calls made without asking, and who made them: the count per session and machine. A call
 * logged before the ledger recorded who made it counts under a null session and host.
 * @param {LedgerEntry[]} events
 */
export function loggedMeasures(events) {
  /** @type {Map<string, { session: string | null, host: string | null, calls: number }>} */
  const by = new Map();
  let total = 0;
  for (const e of events) {
    if (e.event !== 'logged') continue;
    total++;
    const session = e.session ?? null;
    const host = e.host ?? null;
    const key = JSON.stringify([session, host]);
    const row = by.get(key) ?? { session, host, calls: 0 };
    row.calls++;
    by.set(key, row);
  }
  return { total, by_session: [...by.values()] };
}

/**
 * Stall rates and the watchdog's steps (design parts 5.2 and 11.1).
 * @param {LedgerEntry[]} events
 */
export function stallMeasures(events) {
  /** @type {Map<string, LedgerEntry>} */
  const executors = new Map();
  /** @type {Set<string>} */
  const stalled = new Set();
  const steps = { poke: 0, 'follow-up': 0, abandon: 0, ask: 0 };
  let cutOff = 0;
  let pauses = 0;
  let resumes = 0;
  for (const e of events) {
    if (e.event === 'dispatched' && (e.role ?? 'executor') === 'executor')
      executors.set(e.dispatch, e);
    if (e.event === 'paused') pauses++;
    if (e.event === 'resumed') resumes++;
    if (e.event !== 'stalled') continue;
    if (e.reason === 'limit') {
      cutOff++;
      continue;
    }
    stalled.add(e.dispatch);
    steps[/** @type {keyof typeof steps} */ (e.step)]++;
  }
  /** @param {(d: LedgerEntry) => string | number | undefined} key */
  const by = (key) => {
    /** @type {Record<string, { dispatches: number, stalled: number, rate: number }>} */
    const out = {};
    for (const [id, d] of executors) {
      const k = String(key(d) ?? 'unknown');
      out[k] ??= { dispatches: 0, stalled: 0, rate: 0 };
      out[k].dispatches++;
      if (stalled.has(id)) out[k].stalled++;
    }
    for (const v of Object.values(out)) v.rate = v.stalled / v.dispatches;
    return out;
  };
  const counted = [...stalled].filter((d) => executors.has(d)).length;
  return {
    dispatches: executors.size,
    stalled: counted,
    rate: executors.size ? counted / executors.size : null,
    steps,
    cut_off_by_limit: cutOff,
    pauses,
    resumes,
    by_model: by((d) => d.model),
    by_tier: by((d) => d.tier),
    by_area: by((d) => d.area),
  };
}

/**
 * @param {PrivateStore} store
 */
export function summary(store) {
  const { events, problems } = readLedger(store);
  return { ...summarize(events), ledger_problems: problems };
}
