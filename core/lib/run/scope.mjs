// A run scope (HITLD-877, decision HITLD-876): one decision of the owner's, in their own words,
// names a list of items, a token budget and an end time. Within it the chief of staff starts the
// items itself (hitld dispatch start --scope), so a hand-over between orchestrators needs no start
// line typed in the orchestrator's session. It is per run, never standing: it ends at its end time,
// once its budget is spent, or on the owner's word (hitld run scope end), and a new run does not
// inherit it. It allows starts and nothing else: a guard, policy, rights or skill change is still
// the owner's to make.
//
// The scope lives in the private store (run/scope.json), written by the chief of staff. Starts
// under it are ordinary `dispatched` events that carry the scope's decision and the session that
// started them (`by`), so what a scope has spent is read from the ledger.

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 *
 * @typedef {object} RunScope
 * @property {string} run the run it belongs to
 * @property {string} decision the owner's decision that names it
 * @property {string[]} items the items it covers
 * @property {number} budget_tokens what its starts may spend, in tokens
 * @property {string} until when it ends
 * @property {string} granted_at
 * @property {string} granted_by the session that recorded it
 * @property {{ at: string, by: string, reason: string }} [ended] ended before its end time
 */

export const SCOPE_KEY = 'run/scope.json';

/** The longest a scope may run: per run, never standing. */
export const SCOPE_MAX_HOURS = 168;

/** @param {PrivateStore} store @returns {RunScope | null} */
export function readScope(store) {
  const raw = store.read(SCOPE_KEY);
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' && typeof s.decision === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** @param {PrivateStore} store @param {RunScope} scope */
export function writeScope(store, scope) {
  store.write(SCOPE_KEY, `${JSON.stringify(scope, null, 2)}\n`);
}

/**
 * The item IDs a decision's answer names, as the owner wrote them: each of `items` must appear in
 * the words as a whole ID (W-1 is not named by W-12). Returns those it does not name.
 * @param {string} words @param {string[]} items
 */
export function unnamedItems(words, items) {
  const text = String(words).toUpperCase();
  return items.filter((id) => {
    const escaped = id.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^A-Z0-9-])${escaped}(?![0-9A-Z])`).test(text);
  });
}

/**
 * What a scope has spent: for each start under it, the tokens its report recorded, else its start
 * estimate (a start in flight counts at its estimate, so the budget is never passed by starting
 * many at once).
 * @param {RunScope} scope @param {LedgerEntry[]} events
 */
export function spentOf(scope, events) {
  const starts = events.filter(
    (e) => e.event === 'dispatched' && e.decision === scope.decision && e.run === scope.run,
  );
  let spent = 0;
  for (const s of starts) {
    const reported = events.filter(
      (e) => e.event === 'reported' && e.dispatch === s.dispatch && typeof e.tokens === 'number',
    );
    spent += reported.length
      ? reported.reduce((n, e) => n + /** @type {number} */ (e.tokens), 0)
      : typeof s.estimate_tokens === 'number'
        ? s.estimate_tokens
        : 0;
  }
  return { spent, starts: starts.map((s) => /** @type {string} */ (s.dispatch)) };
}

/**
 * Whether the scope is in force now, and if not, why.
 * @param {RunScope | null} scope @param {{ now: number, run: string | null, events: LedgerEntry[] }} at
 * @returns {{ active: boolean, code?: string, why?: string, spent: number, left: number, starts: string[] }}
 */
export function scopeStatus(scope, at) {
  if (!scope) {
    return {
      active: false,
      code: 'no-scope',
      why: 'no run scope is recorded',
      spent: 0,
      left: 0,
      starts: [],
    };
  }
  const { spent, starts } = spentOf(scope, at.events);
  const left = Math.max(0, scope.budget_tokens - spent);
  const base = { spent, left, starts };
  if (scope.ended) {
    return {
      active: false,
      code: 'scope-ended',
      why: `the run scope of ${scope.decision} was ended at ${scope.ended.at} (${scope.ended.reason})`,
      ...base,
    };
  }
  if (at.run !== scope.run) {
    return {
      active: false,
      code: 'scope-ended',
      why: `the run scope of ${scope.decision} belongs to run ${scope.run}, not the run now (${at.run ?? 'none'}): a scope is per run`,
      ...base,
    };
  }
  if (at.now >= Date.parse(scope.until)) {
    return {
      active: false,
      code: 'scope-expired',
      why: `the run scope of ${scope.decision} ended at ${scope.until}`,
      ...base,
    };
  }
  if (spent >= scope.budget_tokens) {
    return {
      active: false,
      code: 'scope-budget',
      why: `the run scope of ${scope.decision} has spent ${spent} of its ${scope.budget_tokens} tokens`,
      ...base,
    };
  }
  return { active: true, ...base };
}

/**
 * Whether the scope lets the chief of staff start an item now. Refusals: `no-scope`, `scope-ended`,
 * `scope-expired`, `scope-budget` (spent, or this start's estimate would pass it) and
 * `outside-scope` (the item is not one it names, or the decision named is not the scope's).
 * @param {RunScope | null} scope
 * @param {{ decision: string, item: string, estimate: number, now: number, run: string | null, events: LedgerEntry[] }} start
 * @returns {{ ok: true, spent: number, left: number } | { ok: false, code: string, why: string }}
 */
export function checkScopeStart(scope, start) {
  if (scope && scope.decision !== start.decision) {
    return {
      ok: false,
      code: 'outside-scope',
      why: `${start.decision} is not the decision of the run scope recorded now (${scope.decision})`,
    };
  }
  const status = scopeStatus(scope, start);
  if (!status.active) {
    return {
      ok: false,
      code: /** @type {string} */ (status.code),
      why: /** @type {string} */ (status.why),
    };
  }
  const s = /** @type {RunScope} */ (scope);
  if (!s.items.includes(start.item)) {
    return {
      ok: false,
      code: 'outside-scope',
      why: `${start.item} is not in the run scope of ${s.decision} (${s.items.join(', ')})`,
    };
  }
  if (status.spent + start.estimate > s.budget_tokens) {
    return {
      ok: false,
      code: 'scope-budget',
      why: `${start.item}'s estimate of ${start.estimate} tokens would pass the run scope's budget: ${status.spent} of ${s.budget_tokens} spent, ${status.left} left`,
    };
  }
  return { ok: true, spent: status.spent, left: status.left };
}
