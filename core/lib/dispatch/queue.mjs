// The ready queue (design parts 5.2 and 2.4): ready items in priority order.
//
// For now it orders by the parts of the rule it has data for: the critical path first (an item that
// unblocks others carries the weight of everything behind it), then the item's priority, then the
// smaller token estimate (shortest job first), then the ID. Cost of delay and value of information
// come with the milestone Shaping and prioritization.

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {import('./sizing.mjs').Sizing} Sizing
 */

const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 };
const ITEM_KINDS = ['work', 'decision', 'external'];

/** @param {unknown} v @returns {string[]} */
const list = (v) =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];

/** The numeric part of an ID, for a stable order. @param {string} id */
const idNumber = (id) => Number(/-(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * Which items are ready: Planned, every `needs` entry Done (decisions included), not claimed and
 * not in flight. The files tracker derives the same set itself (`query({ ready: true })`); this is
 * for a tracker without it, and the stand-in used until piece (a) merges.
 * @param {Item[]} items @param {{ inFlight?: string[] }} [options]
 * @returns {Set<string>}
 */
export function deriveReady(items, options = {}) {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  const busy = new Set(options.inFlight ?? []);
  /** @type {Set<string>} */
  const out = new Set();
  for (const i of items) {
    if (!ITEM_KINDS.includes(i.kind) || i.kind === 'decision') continue;
    if (i.state !== 'Planned' || i.claim || i.claimed || busy.has(String(i.id))) continue;
    if (list(i.needs).every((n) => byId.get(n)?.state === 'Done')) out.add(String(i.id));
  }
  return out;
}

/**
 * How many open items each item unblocks, directly or through others.
 * @param {Item[]} items @returns {Map<string, number>}
 */
export function unblockCounts(items) {
  /** @type {Map<string, string[]>} who needs me */
  const dependents = new Map();
  for (const i of items) {
    if (i.state === 'Done' || i.state === 'Dropped') continue;
    for (const n of list(i.needs)) {
      if (!dependents.has(n)) dependents.set(n, []);
      dependents.get(n)?.push(String(i.id));
    }
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const i of items) {
    /** @type {Set<string>} */
    const seen = new Set();
    const stack = [...(dependents.get(String(i.id)) ?? [])];
    while (stack.length) {
      const d = /** @type {string} */ (stack.pop());
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(...(dependents.get(d) ?? []));
    }
    counts.set(String(i.id), seen.size);
  }
  return counts;
}

/**
 * Order the ready items.
 * @param {Item[]} ready @param {Map<string, Sizing>} sizes @param {Map<string, number>} unblocks
 * @returns {Item[]}
 */
export function orderQueue(ready, sizes, unblocks) {
  const key = (/** @type {Item} */ i) => [
    -(unblocks.get(String(i.id)) ?? 0),
    PRIORITY[/** @type {keyof typeof PRIORITY} */ (i.priority)] ?? 2,
    sizes.get(String(i.id))?.estimate_tokens ?? 0,
    idNumber(String(i.id)),
  ];
  return [...ready].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] - kb[n];
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Items on the critical path: the ready items that unblock the most open work (ties included),
 * when they unblock any. The quota gate lets these through in critical-path-only mode.
 * @param {Item[]} ready @param {Map<string, number>} unblocks @returns {Set<string>}
 */
export function criticalPath(ready, unblocks) {
  const max = Math.max(0, ...ready.map((i) => unblocks.get(String(i.id)) ?? 0));
  return new Set(
    max === 0
      ? []
      : ready.filter((i) => unblocks.get(String(i.id)) === max).map((i) => String(i.id)),
  );
}
