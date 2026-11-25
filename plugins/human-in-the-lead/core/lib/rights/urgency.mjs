// What waits on an open decision, and how much that costs (design parts 2.4 and 5.5), computed
// from the tracker's open items alone. Nothing here is stored: it is derived each time, so it is
// never counted by hand (design part 3.2).
//
// - blocks: the open items that need the decision, directly or through others.
// - unblocks_ready: the items that become ready the moment it is answered (they need nothing
//   else that is open): answering it puts work in the queue.
// - critical_path: it sits on the longest chain of open work by `needs`, each item weighing its
//   sizing estimate (the caller's `weight`; without one, its own `estimate_tokens` or 1), as the
//   critical-path view weighs it. A decision that blocks nothing is never on the critical path.
// - cost_of_delay: the summed estimate tokens of the open items it blocks, by the same weights:
//   a decision that holds up more work costs more (design part 2.4). No priority, rate or profile
//   is read: an item's retired `priority` key changes nothing.

/** The kinds of item that sit in the dependency graph. */
const GRAPH_KINDS = ['work', 'external', 'decision'];
/** Work that may be started (a decision is answered, not started). */
const WORK_KINDS = ['work', 'external'];
const OPEN = ['proposed', 'planned', 'in-progress'];
/** @param {unknown} v @returns {string[]} */
const list = (v) =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];

/** An item's own `estimate_tokens`, or 1 without one. @param {Record<string, any> | undefined} item */
const storedWeight = (item) => {
  const w = Number(item?.estimate_tokens);
  return Number.isFinite(w) && w > 0 ? w : 1;
};

/**
 * @typedef {object} Urgency
 * @property {string[]} blocks IDs of the open items that need it, directly or through others
 * @property {string[]} unblocks_ready IDs of the items that become ready when it is answered
 * @property {boolean} critical_path
 * @property {number} cost_of_delay
 */

/**
 * Urgency of every open decision.
 * @param {Record<string, any>[]} items every item that is not done or dropped, of any kind
 * @param {{ weight?: (id: string) => number }} [o] each open item's weight on a path, its sizing
 *   estimate (dispatch/queue.mjs `weightsOf`); its own `estimate_tokens` or 1 without one
 * @returns {Map<string, Urgency>} by decision ID
 */
export function decisionUrgency(items, o = {}) {
  const open = items.filter((i) => OPEN.includes(i.state) && GRAPH_KINDS.includes(i.kind));
  /** @type {Map<string, Record<string, any>>} */
  const byId = new Map(open.map((i) => [String(i.id), i]));
  const weightOf = (/** @type {Record<string, any>} */ item) =>
    o.weight ? o.weight(String(item.id)) : storedWeight(item);
  /** @type {Map<string, string[]>} who needs me, among open items */
  const dependents = new Map();
  for (const i of open) {
    for (const n of list(i.needs)) {
      if (!byId.has(n)) continue;
      if (!dependents.has(n)) dependents.set(n, []);
      dependents.get(n)?.push(String(i.id));
    }
  }

  // The longest chain through each item: the heaviest chain ending at it by `needs`, plus the
  // heaviest chain after it by dependents. An item is on the critical path when that equals the
  // heaviest chain anywhere.
  /** @type {Map<string, number>} */
  const upMemo = new Map();
  /** @type {Map<string, number>} */
  const downMemo = new Map();
  /** @param {string} id @param {Set<string>} seen @returns {number} */
  const up = (id, seen) => {
    const hit = upMemo.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0;
    seen.add(id);
    const w = weightOf(/** @type {Record<string, any>} */ (byId.get(id)));
    const tail = Math.max(
      0,
      ...list(byId.get(id)?.needs)
        .filter((n) => byId.has(n))
        .map((n) => up(n, seen)),
    );
    seen.delete(id);
    upMemo.set(id, tail + w);
    return tail + w;
  };
  /** @param {string} id @param {Set<string>} seen @returns {number} */
  const down = (id, seen) => {
    const hit = downMemo.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0;
    seen.add(id);
    const w = weightOf(/** @type {Record<string, any>} */ (byId.get(id)));
    const tail = Math.max(0, ...(dependents.get(id) ?? []).map((d) => down(d, seen)));
    seen.delete(id);
    downMemo.set(id, tail + w);
    return tail + w;
  };
  const through = (/** @type {string} */ id) =>
    up(id, new Set()) +
    down(id, new Set()) -
    weightOf(/** @type {Record<string, any>} */ (byId.get(id)));
  const longest = Math.max(0, ...open.map((i) => through(String(i.id))));

  /** @type {Map<string, Urgency>} */
  const out = new Map();
  for (const d of open.filter((i) => i.kind === 'decision')) {
    const id = String(d.id);
    /** @type {Set<string>} */
    const seen = new Set();
    const stack = [...(dependents.get(id) ?? [])];
    while (stack.length) {
      const next = /** @type {string} */ (stack.pop());
      if (seen.has(next) || next === id) continue;
      seen.add(next);
      stack.push(...(dependents.get(next) ?? []));
    }
    const blocks = [...seen].sort();
    const unblocksReady = (dependents.get(id) ?? [])
      .filter((x) => {
        const item = /** @type {Record<string, any>} */ (byId.get(x));
        return (
          WORK_KINDS.includes(item.kind) &&
          item.state === 'planned' &&
          list(item.needs).every((n) => n === id || !byId.has(n))
        );
      })
      .sort();
    const cost = blocks.reduce(
      (sum, b) => sum + weightOf(/** @type {Record<string, any>} */ (byId.get(b))),
      0,
    );
    out.set(id, {
      blocks,
      unblocks_ready: unblocksReady,
      critical_path: blocks.length > 0 && through(id) === longest,
      cost_of_delay: cost,
    });
  }
  return out;
}

/**
 * The work that could be started now: planned, every need done (a need that is not open counts as
 * done), not claimed and not in flight.
 * @param {Record<string, any>[]} items every item that is not done or dropped, of any kind
 * @param {string[]} [inFlight] IDs of the items with an executor running
 * @returns {string[]}
 */
export function readyWork(items, inFlight = []) {
  const open = new Set(items.filter((i) => OPEN.includes(i.state)).map((i) => String(i.id)));
  const busy = new Set(inFlight);
  return items
    .filter(
      (i) =>
        WORK_KINDS.includes(i.kind) &&
        i.state === 'planned' &&
        !i.claim &&
        !i.claimed_by &&
        !busy.has(String(i.id)) &&
        list(i.needs).every((n) => !open.has(n)),
    )
    .map((i) => String(i.id))
    .sort();
}
