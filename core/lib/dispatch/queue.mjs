// The ready queue (design parts 5.2 and 2.4): ready items in the order the release chain puts them.
//
// No one ranks work by hand: the order is derived from the tracker's own graph. Each ready item
// gets a tier, the nearest open release whose closure holds it: the work the release item needs,
// directly or through others, through item `needs`, release `needs` and a milestone's constraints
// (an item's `constraint_of`). Nearest means the fewest open releases in the release's own chain,
// then the fewest remaining estimated tokens in its closure, then the ID. The tiers go in that
// order, and ready items outside every release's closure come after them. Inside a tier the order
// is:
//
//   1. work that feeds open decisions first: the open decisions among the item's descendants (what
//      needs it, directly or through others), an owner decision counting double; a decision that
//      another decision needs is informed by it, so the item feeds both;
//   2. the longest remaining path: the heaviest chain of open work from the item to the release;
//   3. what it unblocks within the tier;
//   4. the count of releases behind it;
//   5. the smaller estimate (shortest job first);
//   6. the ID.
//
// Every open item on a path weighs its sizing estimate (`weightsOf`): its own `estimate_tokens`,
// else what sizing derives. With no open release item the order is the one before the release
// chain: what an item unblocks, then the smaller estimate, then the ID. An item's `priority` key
// is retired and read by nothing here.

import { sizeItem } from './sizing.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {import('./sizing.mjs').Sizing} Sizing
 *
 * @typedef {object} Release an open release item and what its closure holds
 * @property {string} id the release item's ID
 * @property {string} release the version it makes
 * @property {string} title
 * @property {number} chain open release items in its own chain, itself included
 * @property {number} remaining_tokens estimated tokens of the open items in its closure
 * @property {Set<string>} closure IDs of the open entries it needs, directly or through others,
 *   itself included
 *
 * @typedef {object} RankKey why an item sits where it does in the queue
 * @property {string | null} release the tier's release item, null outside every release
 * @property {string | null} release_version
 * @property {number | null} release_tier 0 for the nearest release, null outside every release
 * @property {number} feeds_decisions open decisions among its descendants, an owner one counting 2
 * @property {number} longest_path_tokens the heaviest chain of open work from it to the release
 *   (outside every release: to the end of the open graph)
 * @property {number} unblocks_in_tier open items behind it inside the tier's closure
 * @property {number} releases_behind open releases whose closure holds it
 * @property {number} estimate_tokens
 *
 * @typedef {object} Ranking
 * @property {Item[]} queue the ready items in order
 * @property {Map<string, RankKey>} keys by item ID
 * @property {Release[]} releases the open releases, nearest first
 * @property {Set<string>} critical the items the quota gate lets through in critical-path-only
 *   mode: the first tier with ready work, those on its longest path; with no open release, or no
 *   open release holding a ready item, the ready items that unblock the most
 */

const ITEM_KINDS = ['work', 'decision', 'external'];
const MILESTONE_KINDS = ['milestone'];
const CLOSED = ['done', 'dropped'];
/** The decider an owner decision names (tracker/files/views.mjs). */
const OWNER = 'owner';

/** @param {unknown} v @returns {string[]} */
const list = (v) =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];

/** The numeric part of an ID, for a stable order. @param {string} id */
const idNumber = (id) => Number(/-(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

/** @param {Item} i */
const isOpen = (i) => !CLOSED.includes(String(i.state));

/** @param {Item} i */
const isRelease = (i) =>
  i.kind === 'work' && typeof i.release === 'string' && i.release !== '' && isOpen(i);

/**
 * What an entry needs in the closure: an item's `needs`; a milestone's constraints, which the
 * tracker derives from each item's `constraint_of` (a milestone's `constraints` entries, objects
 * or "<ID> c<n>" strings, and any `needs` it holds).
 * @param {Item} i @returns {string[]}
 */
const needsOf = (i) => {
  if (!MILESTONE_KINDS.includes(String(i.kind))) return list(i.needs);
  const constraints = Array.isArray(i.constraints) ? i.constraints : [];
  return [
    ...new Set([
      ...list(i.needs),
      ...constraints.map((/** @type {any} */ c) =>
        typeof c === 'string' ? c.split(/\s+/)[0] : String(c?.id ?? ''),
      ),
    ]),
  ].filter(Boolean);
};

/**
 * Every open entry's weight on a path: a work item weighs its sizing estimate (its own
 * `estimate_tokens`, else the median of similar past completions, else the tier's default); a
 * decision or an external item, which no executor runs, weighs its own `estimate_tokens` or 1; a
 * milestone weighs nothing of its own, only through its constraints.
 * @param {Item[]} items @param {Record<string, any>} policy @param {import('./sizing.mjs').HistoryEntry[]} [history]
 * @param {{ workDir?: string, sizes?: Map<string, Sizing> }} [o] sizes already computed are reused
 * @returns {(id: string) => number}
 */
export function weightsOf(items, policy, history = [], o = {}) {
  /** @type {Map<string, number>} */
  const w = new Map();
  for (const i of items) {
    if (!isOpen(i)) continue;
    const id = String(i.id);
    if (MILESTONE_KINDS.includes(String(i.kind))) w.set(id, 0);
    else if (i.kind === 'work') {
      const s = o.sizes?.get(id) ?? sizeItem(i, policy, history, { workDir: o.workDir });
      w.set(id, Math.max(0, Number(s.estimate_tokens) || 0));
    } else w.set(id, storedWeight(i));
  }
  return (id) => w.get(id) ?? 0;
}

/**
 * An entry's own `estimate_tokens`, or 1 without one: the weight where no policy is at hand.
 * @param {Record<string, any> | undefined} i
 */
export const storedWeight = (i) => {
  const n = Number(i?.estimate_tokens);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

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
    if (i.state !== 'planned' || i.claim || i.claimed_by || busy.has(String(i.id))) continue;
    if (list(i.needs).every((n) => byId.get(n)?.state === 'done')) out.add(String(i.id));
  }
  return out;
}

/**
 * How many open items each item unblocks, directly or through others, by item `needs`.
 * @param {Item[]} items @returns {Map<string, number>}
 */
export function unblockCounts(items) {
  /** @type {Map<string, string[]>} who needs me */
  const dependents = new Map();
  for (const i of items) {
    if (!isOpen(i)) continue;
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

/** @param {number[]} ka @param {number[]} kb */
const compareKeys = (ka, kb) => {
  for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] - kb[n];
  return 0;
};

/**
 * The order with no open release item: what an item unblocks, then the smaller estimate, then
 * the ID. An item's `priority` key plays no part.
 * @param {Item[]} ready @param {Map<string, Sizing>} sizes @param {Map<string, number>} unblocks
 * @returns {Item[]}
 */
export function orderQueue(ready, sizes, unblocks) {
  const key = (/** @type {Item} */ i) => [
    -(unblocks.get(String(i.id)) ?? 0),
    sizes.get(String(i.id))?.estimate_tokens ?? 0,
    idNumber(String(i.id)),
  ];
  return [...ready].sort(
    (a, b) => compareKeys(key(a), key(b)) || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Items on the critical path with no open release: the ready items that unblock the most open
 * work (ties included), when they unblock any.
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

/**
 * The open release items, nearest first, each with its closure. A cycle in the graph ends the
 * walk where it closes.
 * @param {Item[]} items @param {(id: string) => number} weight
 * @returns {Release[]}
 */
export function releaseChain(items, weight) {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  /** @param {string} root @returns {Set<string>} */
  const closureOf = (root) => {
    /** @type {Set<string>} */
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const id = /** @type {string} */ (stack.pop());
      if (seen.has(id)) continue;
      const it = byId.get(id);
      if (!it || !isOpen(it)) continue;
      seen.add(id);
      stack.push(...needsOf(it));
    }
    return seen;
  };
  const releases = items.filter(isRelease).map((r) => {
    const id = String(r.id);
    const closure = closureOf(id);
    let remaining = 0;
    let chain = 0;
    for (const x of closure) {
      const it = /** @type {Item} */ (byId.get(x));
      if (ITEM_KINDS.includes(String(it.kind))) remaining += weight(x);
      if (isRelease(it)) chain++;
    }
    return {
      id,
      release: String(r.release),
      title: String(r.title ?? ''),
      chain,
      remaining_tokens: remaining,
      closure,
    };
  });
  return releases.sort(
    (a, b) =>
      a.chain - b.chain ||
      a.remaining_tokens - b.remaining_tokens ||
      idNumber(a.id) - idNumber(b.id) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Who needs each entry, among open entries, through item `needs` and a milestone's constraints.
 * @param {Item[]} items @returns {Map<string, string[]>}
 */
const dependentsOf = (items) => {
  /** @type {Map<string, string[]>} */
  const dependents = new Map();
  for (const i of items) {
    if (!isOpen(i)) continue;
    for (const n of needsOf(i)) {
      if (!dependents.has(n)) dependents.set(n, []);
      dependents.get(n)?.push(String(i.id));
    }
  }
  return dependents;
};

/**
 * Every open entry that needs `id`, directly or through others.
 * @param {Map<string, string[]>} dependents @param {string} id @returns {Set<string>}
 */
const descendantsOf = (dependents, id) => {
  /** @type {Set<string>} */
  const seen = new Set();
  const stack = [...(dependents.get(id) ?? [])];
  while (stack.length) {
    const d = /** @type {string} */ (stack.pop());
    if (seen.has(d) || d === id) continue;
    seen.add(d);
    stack.push(...(dependents.get(d) ?? []));
  }
  return seen;
};

/**
 * The ready queue in release-chain order, with each item's sort key, the open releases nearest
 * first, and the critical path the quota gate reads.
 * @param {{
 *   items: Item[],
 *   ready: Item[],
 *   sizes: Map<string, Sizing>,
 *   weight: (id: string) => number,
 *   unblocks?: Map<string, number>,
 * }} r items: every entry the tracker holds (done ones included: they are left out of paths);
 *   ready: the items that may start; unblocks: by item `needs`, for the order with no release
 * @returns {Ranking}
 */
export function rankQueue(r) {
  const unblocks = r.unblocks ?? unblockCounts(r.items);
  const releases = releaseChain(r.items, r.weight);
  const byId = new Map(r.items.map((i) => [String(i.id), i]));
  const estimate = (/** @type {string} */ id) => r.sizes.get(id)?.estimate_tokens ?? 0;

  const dependents = dependentsOf(r.items);
  const descendants = (/** @type {string} */ id) => descendantsOf(dependents, id);
  /**
   * The heaviest chain of open work from `id` down through what needs it, inside `within` when
   * given. Each call has its own memo; a cycle counts nothing past where it closes.
   * @param {string} start @param {Set<string> | null} within
   */
  const longest = (start, within) => {
    /** @type {Map<string, number>} */
    const memo = new Map();
    /** @param {string} id @param {Set<string>} path @returns {number} */
    const down = (id, path) => {
      const hit = memo.get(id);
      if (hit !== undefined) return hit;
      path.add(id);
      let tail = 0;
      for (const d of dependents.get(id) ?? []) {
        if (path.has(d) || (within && !within.has(d))) continue;
        tail = Math.max(tail, down(d, path));
      }
      path.delete(id);
      const out = tail + r.weight(id);
      memo.set(id, out);
      return out;
    };
    return down(start, new Set());
  };

  /** @type {Map<string, RankKey>} */
  const keys = new Map();
  for (const item of r.ready) {
    const id = String(item.id);
    const holding = releases.filter((rel) => rel.closure.has(id));
    const tier = holding[0] ?? null;
    const behind = descendants(id);
    let feeds = 0;
    for (const d of behind) {
      const it = byId.get(d);
      if (it?.kind === 'decision' && isOpen(it)) feeds += it.decider === OWNER ? 2 : 1;
    }
    keys.set(id, {
      release: tier?.id ?? null,
      release_version: tier?.release ?? null,
      release_tier: tier ? releases.indexOf(tier) : null,
      feeds_decisions: feeds,
      longest_path_tokens: longest(id, tier?.closure ?? null),
      unblocks_in_tier: tier
        ? [...behind].filter(
            (d) => tier.closure.has(d) && ITEM_KINDS.includes(String(byId.get(d)?.kind)),
          ).length
        : 0,
      releases_behind: holding.length,
      estimate_tokens: estimate(id),
    });
  }

  if (!releases.length) {
    const queue = orderQueue(r.ready, r.sizes, unblocks);
    return { queue, keys, releases, critical: criticalPath(r.ready, unblocks) };
  }

  const outside = releases.length; // after every tier
  const sortKey = (/** @type {Item} */ i) => {
    const k = /** @type {RankKey} */ (keys.get(String(i.id)));
    if (k.release_tier === null) {
      // Outside every release: the order with no release, after every tier.
      return [outside, -(unblocks.get(String(i.id)) ?? 0), 0, 0, 0, k.estimate_tokens];
    }
    return [
      k.release_tier,
      -k.feeds_decisions,
      -k.longest_path_tokens,
      -k.unblocks_in_tier,
      -k.releases_behind,
      k.estimate_tokens,
    ];
  };
  const queue = [...r.ready].sort(
    (a, b) =>
      compareKeys(sortKey(a), sortKey(b)) ||
      idNumber(String(a.id)) - idNumber(String(b.id)) ||
      String(a.id).localeCompare(String(b.id)),
  );

  // Critical path only: the first tier that has ready work, its items on its longest path. A
  // ready item has no open needs, so the longest chain through it starts at it. When no open
  // release holds a ready item, the rule with no release stands: the ready items that unblock the
  // most, so the gate does not pass nothing while ready work waits.
  const first = queue
    .map((i) => keys.get(String(i.id)))
    .find((k) => k?.release_tier !== null && k?.release_tier !== undefined)?.release_tier;
  /** @type {Set<string>} */
  const critical = new Set();
  if (first !== undefined && first !== null) {
    const inTier = r.ready.filter((i) => keys.get(String(i.id))?.release_tier === first);
    const max = Math.max(0, ...inTier.map((i) => keys.get(String(i.id))?.longest_path_tokens ?? 0));
    for (const i of inTier) {
      if (keys.get(String(i.id))?.longest_path_tokens === max) critical.add(String(i.id));
    }
    return { queue, keys, releases, critical };
  }
  return { queue, keys, releases, critical: criticalPath(r.ready, unblocks) };
}

/**
 * What the plan and `hitld ready` say about the release chain: the next release and its ready,
 * blocked and awaiting-merge counts, a note when it has nothing ready and which tier is offered
 * instead, and the ready items outside every release's closure with how long they have waited.
 * @param {Ranking} ranking @param {Item[]} items
 * @param {{ ready: Item[], awaiting?: string[], inFlight?: string[], now?: number }} o
 */
export function releaseSummary(ranking, items, o) {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  const ready = new Set(o.ready.map((i) => String(i.id)));
  const awaiting = new Set(o.awaiting ?? []);
  const running = new Set(o.inFlight ?? []);
  const now = o.now ?? Date.now();
  /** @param {Release} rel */
  const counts = (rel) => {
    let r = 0;
    let blocked = 0;
    let waiting = 0;
    let inFlight = 0;
    for (const id of rel.closure) {
      const it = byId.get(id);
      if (!it || !['work', 'external'].includes(String(it.kind))) continue;
      if (awaiting.has(id)) waiting++;
      else if (ready.has(id)) r++;
      else if (running.has(id) || it.state === 'in-progress') inFlight++;
      else blocked++;
    }
    return { ready: r, blocked, awaiting_merge: waiting, in_flight: inFlight };
  };
  const describe = (/** @type {Release} */ rel) => ({
    id: rel.id,
    release: rel.release,
    title: rel.title,
    chain: rel.chain,
    remaining_tokens: rel.remaining_tokens,
    ...counts(rel),
  });
  const next = ranking.releases[0] ? describe(ranking.releases[0]) : null;
  /** @type {string | null} */
  let note = null;
  if (next && next.ready === 0) {
    const offered = ranking.releases.slice(1).find((rel) => counts(rel).ready > 0);
    note = `the next release ${next.id} (${next.release}) has nothing ready: ${next.blocked} blocked, ${next.awaiting_merge} awaiting merge, ${next.in_flight} in flight; ${offered ? `the plan offers the next tier, ${offered.id} (${offered.release})` : 'no other release has ready work either'}`;
  }
  const outside = ranking.releases.length
    ? o.ready
        .filter((i) => ranking.keys.get(String(i.id))?.release === null)
        .map((i) => {
          const created = Date.parse(String(i.created ?? ''));
          return {
            id: String(i.id),
            title: String(i.title ?? ''),
            created: i.created ? String(i.created) : null,
            waited_days: Number.isFinite(created)
              ? Math.max(0, Math.floor((now - created) / 86_400_000))
              : null,
          };
        })
    : [];
  return {
    next_release: next,
    releases: ranking.releases.map(describe),
    ...(note ? { note } : {}),
    outside_releases: outside,
  };
}

/**
 * @typedef {object} DecisionOverlap an open decision whose touches overlap a ready item's
 * @property {string} decision the decision's ID
 * @property {string} title
 * @property {string[]} paths the item's touches that overlap the decision's
 */

/**
 * The open decisions in each ready item's tier whose touches overlap the item's (HITLD-1047): work
 * started before a decision on the same files is settled often changes after the answer. A
 * decision's tier is the nearest open release whose closure holds it, as an item's is; outside
 * every release both are outside, and that counts as the same tier. A decision the item feeds (one
 * among what needs it, directly or through others) is left out: the item informs it, and holding
 * the item would hold the answer. An item with no touches overlaps nothing. Items with no overlap
 * are left out of the map.
 * @param {{
 *   items: Item[],
 *   ready: Item[],
 *   ranking: Pick<Ranking, 'keys' | 'releases'>,
 *   touches: (item: Item) => string[],
 *   overlap: (a: string, b: string) => boolean,
 * }} r items: every entry the tracker holds; touches: an entry's own, else derived (touches.mjs);
 *   overlap: whether two globs overlap (item.mjs globsOverlap)
 * @returns {Map<string, DecisionOverlap[]>}
 */
export function decisionOverlaps(r) {
  /** @type {Map<string, DecisionOverlap[]>} */
  const out = new Map();
  const open = r.items.filter((i) => i.kind === 'decision' && isOpen(i));
  if (!open.length) return out;
  /** @param {string} id */
  const tierOf = (id) => r.ranking.releases.find((rel) => rel.closure.has(id))?.id ?? null;
  const decisions = open
    .map((d) => ({
      id: String(d.id),
      title: String(d.title ?? ''),
      tier: tierOf(String(d.id)),
      touches: r.touches(d),
    }))
    .filter((d) => d.touches.length);
  if (!decisions.length) return out;
  const dependents = dependentsOf(r.items);
  for (const item of r.ready) {
    const id = String(item.id);
    const own = r.touches(item);
    if (!own.length) continue;
    const tier = r.ranking.keys.get(id)?.release ?? tierOf(id);
    const feeds = descendantsOf(dependents, id);
    /** @type {DecisionOverlap[]} */
    const hits = [];
    for (const d of decisions) {
      if (d.tier !== tier || feeds.has(d.id)) continue;
      const paths = own.filter((t) => d.touches.some((x) => r.overlap(t, x)));
      if (paths.length) hits.push({ decision: d.id, title: d.title, paths });
    }
    if (hits.length) out.set(id, hits);
  }
  return out;
}
