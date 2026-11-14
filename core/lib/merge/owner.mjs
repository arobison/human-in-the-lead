// Owner merge mode (design part 14.2): finished branches wait for the owner, who names the ones
// to merge. These functions read the run state's waiting list and the ledger; they merge nothing.

/**
 * @typedef {{ item: string, branch: string | null }} Waiting
 * @typedef {{ item: string, branch: string | null, status: string | null, fast_check: string, waiting_since: string | null, waited_ms: number | null }} OwnerWaiting
 */

/**
 * Branches waiting for the owner: the item, the report's status, the fast-check result so far and
 * how long each has waited (since its verification passed).
 * @param {Waiting[]} waiting @param {Record<string, any>[]} events @param {number} [now]
 * @returns {OwnerWaiting[]}
 */
export function waitingForOwner(waiting, events, now = Date.now()) {
  return waiting.map((w) => {
    const verified = events.filter((e) => e.item === w.item && e.event === 'verified').at(-1);
    const reported = events.filter((e) => e.item === w.item && e.event === 'reported').at(-1);
    const since = typeof verified?.at === 'string' ? verified.at : null;
    const t = since ? Date.parse(since) : NaN;
    return {
      item: w.item,
      branch: w.branch,
      status: reported?.outcome ?? null,
      // The queue runs the fast checks when it merges, so a waiting branch has none yet.
      fast_check: 'not run',
      waiting_since: since,
      waited_ms: Number.isNaN(t) ? null : Math.max(0, now - t),
    };
  });
}

/**
 * The waiting entries the owner named, by branch or item. A name must pick out exactly one
 * entry: one that matches none is unknown, one that matches several (an entry's branch equal to
 * another's item, say) is ambiguous, and an entry whose branch is not the branch its item was
 * dispatched on is refused. The caller merges nothing when any of the three lists is not empty.
 * @template {Waiting} T
 * @param {T[]} waiting @param {string[]} names
 * @param {Record<string, any>[]} [events] the ledger, for the branch each item was dispatched on
 * @returns {{ chosen: T[], unknown: string[], ambiguous: string[], mismatched: string[] }}
 */
export function chooseNamed(waiting, names, events = []) {
  const chosen = new Set();
  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const ambiguous = [];
  /** @type {string[]} */
  const mismatched = [];
  for (const n of names) {
    const hits = waiting.filter((x) => x.branch === n || x.item === n);
    if (hits.length === 0) unknown.push(n);
    else if (hits.length > 1) ambiguous.push(n);
    else {
      const w = hits[0];
      const dispatched = events
        .filter(
          (e) => e.event === 'dispatched' && e.item === w.item && typeof e.branch === 'string',
        )
        .at(-1);
      if (dispatched && dispatched.branch !== w.branch) mismatched.push(n);
      else chosen.add(w);
    }
  }
  return { chosen: waiting.filter((w) => chosen.has(w)), unknown, ambiguous, mismatched };
}

/** @param {number | null} ms @returns {string} */
export function waited(ms) {
  if (ms == null) return 'unknown time';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}
