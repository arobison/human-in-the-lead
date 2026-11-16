// The layered layout the dashboard's graphs use (design part 12.1.2, HITLD-307): written here, with
// no layout library (design part 16). Columns by longest path; crossing reduction by barycenter
// sweeps, with a dummy node wherever an edge spans more than one column; linked nodes grouped (a
// chosen group first); unlinked nodes in a grid. It runs when the page is generated, never in the
// reader's browser. Deterministic: the same graph gives the same layout.

/**
 * @typedef {[string, string]} Edge `[from, to]`: `to` comes after `from` (it needs `from`)
 */

/** Compare IDs as the tracker orders them: by their number, then as text. @param {string} a @param {string} b */
export const byId = (a, b) => {
  const na = Number(/\d+$/.exec(a)?.[0] ?? NaN);
  const nb = Number(/\d+$/.exec(b)?.[0] ?? NaN);
  return Number.isFinite(na) && Number.isFinite(nb) && na !== nb ? na - nb : a.localeCompare(b);
};

/**
 * The edges among `ids` with no loop: an edge that would close a cycle (found by a depth-first walk
 * in ID order) is left out, so every layout below terminates. Edges naming an ID not in `ids` are
 * dropped.
 * @param {string[]} ids @param {Edge[]} edges @returns {Edge[]}
 */
export function acyclic(ids, edges) {
  const known = new Set(ids);
  /** @type {Map<string, string[]>} */
  const out = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of edges) {
    if (known.has(a) && known.has(b) && a !== b) /** @type {string[]} */ (out.get(a)).push(b);
  }
  const state = new Map(); // 1 on the stack, 2 finished
  /** @type {Edge[]} */
  const kept = [];
  /** @param {string} v */
  const walk = (v) => {
    state.set(v, 1);
    for (const w of [...new Set(out.get(v))].sort(byId)) {
      if (state.get(w) === 1) continue; // a back edge: it would close a loop
      kept.push([v, w]);
      if (!state.has(w)) walk(w);
    }
    state.set(v, 2);
  };
  for (const id of [...ids].sort(byId)) if (!state.has(id)) walk(id);
  return kept;
}

/**
 * Each node's column: the length of its longest chain of edges into it.
 * @param {string[]} ids @param {Edge[]} edges acyclic @returns {Map<string, number>}
 */
export function longestPathLayers(ids, edges) {
  /** @type {Map<string, string[]>} */
  const into = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of edges) into.get(b)?.push(a);
  /** @type {Map<string, number>} */
  const layer = new Map();
  /** @param {string} v @returns {number} */
  const of = (v) => {
    const hit = layer.get(v);
    if (hit !== undefined) return hit;
    layer.set(v, 0); // guards a loop the caller did not remove
    const l = Math.max(0, ...(into.get(v) ?? []).map((u) => of(u) + 1));
    layer.set(v, l);
    return l;
  };
  for (const id of ids) of(id);
  return layer;
}

/**
 * Crossings between adjacent columns, counting each edge segment once.
 * @param {string[][]} layers ordered @param {Edge[]} segments edges between adjacent columns
 */
export function countCrossings(layers, segments) {
  /** @type {Map<string, { layer: number, pos: number }>} */
  const at = new Map();
  for (const [l, col] of layers.entries())
    for (const [p, v] of col.entries()) at.set(v, { layer: l, pos: p });
  /** @type {Map<number, [number, number][]>} */
  const byLayer = new Map();
  for (const [a, b] of segments) {
    const pa = at.get(a);
    const pb = at.get(b);
    if (!pa || !pb || pb.layer !== pa.layer + 1) continue;
    const list = byLayer.get(pa.layer) ?? [];
    list.push([pa.pos, pb.pos]);
    byLayer.set(pa.layer, list);
  }
  let n = 0;
  for (const list of byLayer.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a1, b1] = list[i];
        const [a2, b2] = list[j];
        if ((a1 - a2) * (b1 - b2) < 0) n++;
      }
    }
  }
  return n;
}

/**
 * Order the nodes in each column for few crossings: an edge spanning several columns gets a dummy
 * node in each column between, then sweeps alternate down (each column by the mean position of its
 * nodes' neighbors in the column before) and up (by the column after), keeping the best order seen.
 * With `groupOf`, a column stays sorted by group first (a lane), and the barycenter orders nodes
 * within their group.
 * @param {Map<string, number>} layerOf every node's column
 * @param {Edge[]} edges acyclic, each from a lower column to a higher one
 * @param {{ groupOf?: (id: string) => number, sweeps?: number }} [options]
 * @returns {{ layers: string[][], crossings: number }} the real nodes, ordered, per column
 */
export function reduceCrossings(layerOf, edges, { groupOf = () => 0, sweeps = 12 } = {}) {
  const width = Math.max(-1, ...layerOf.values()) + 1;
  /** @type {string[][]} */
  let layers = Array.from({ length: width }, () => []);
  for (const id of [...layerOf.keys()].sort(byId))
    layers[/** @type {number} */ (layerOf.get(id))].push(id);
  /** @type {Map<string, number>} a dummy's group: the group of the edge's source */
  const group = new Map([...layerOf.keys()].map((id) => [id, groupOf(id)]));
  /** @type {Edge[]} */
  const segments = [];
  for (const [a, b] of edges) {
    const la = /** @type {number} */ (layerOf.get(a));
    const lb = /** @type {number} */ (layerOf.get(b));
    let prev = a;
    for (let l = la + 1; l < lb; l++) {
      const d = `\u0000${a}\u0000${b}\u0000${l}`;
      group.set(d, /** @type {number} */ (group.get(a)));
      layers[l].push(d);
      segments.push([prev, d]);
      prev = d;
    }
    segments.push([prev, b]);
  }
  /** @type {Map<string, string[]>} */
  const up = new Map();
  /** @type {Map<string, string[]>} */
  const down = new Map();
  for (const [a, b] of segments) {
    down.set(a, [...(down.get(a) ?? []), b]);
    up.set(b, [...(up.get(b) ?? []), a]);
  }
  const sortCol = (/** @type {string[]} */ col) =>
    col.sort((x, y) => /** @type {number} */ (group.get(x)) - /** @type {number} */ (group.get(y)));
  layers = layers.map(sortCol);
  /** @param {string[][]} ls @param {number} l @param {Map<string, string[]>} side */
  const sweep = (ls, l, side) => {
    /** @type {Map<string, number>} */
    const pos = new Map();
    for (const col of [ls[l - 1], ls[l + 1]])
      for (const [p, v] of (col ?? []).entries()) pos.set(v, p);
    const keyed = ls[l].map((v, p) => {
      const ns = (side.get(v) ?? []).map((n) => pos.get(n)).filter((x) => x !== undefined);
      return { v, key: ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : p };
    });
    keyed.sort(
      (x, y) =>
        /** @type {number} */ (group.get(x.v)) - /** @type {number} */ (group.get(y.v)) ||
        x.key - y.key,
    );
    ls[l] = keyed.map((k) => k.v);
  };
  let best = layers.map((c) => [...c]);
  let bestN = countCrossings(best, segments);
  for (let s = 0; s < sweeps && bestN > 0; s++) {
    for (let l = 1; l < width; l++) sweep(layers, l, up);
    for (let l = width - 2; l >= 0; l--) sweep(layers, l, down);
    const n = countCrossings(layers, segments);
    if (n < bestN) {
      best = layers.map((c) => [...c]);
      bestN = n;
    }
  }
  return {
    layers: best.map((c) => c.filter((v) => !v.startsWith('\u0000'))),
    crossings: bestN,
  };
}

/**
 * The fewest-crossings layout of a whole graph: linked nodes grouped by connected component, each
 * laid out in columns by longest path with its crossings reduced; the group holding `first` (the
 * critical path) first, then larger groups, then by their smallest ID; unlinked nodes in a grid.
 * With `layerOf`, every node keeps the column it gives (the Roadmap's release stages, which run
 * every edge left to right), and a group's `layers` are indexed by those columns.
 * @param {string[]} ids @param {Edge[]} edges
 * @param {{ first?: string[], layerOf?: Map<string, number> }} [options]
 * @returns {{ groups: { ids: string[], layers: string[][], crossings: number }[], grid: string[] }}
 */
export function fewestCrossings(ids, edges, { first = [], layerOf } = {}) {
  const dag = acyclic(ids, edges);
  /** @type {Map<string, string>} union-find parents */
  const parent = new Map(ids.map((id) => [id, id]));
  /** @param {string} v @returns {string} */
  const find = (v) => {
    const p = /** @type {string} */ (parent.get(v));
    if (p === v) return v;
    const r = find(p);
    parent.set(v, r);
    return r;
  };
  for (const [a, b] of dag) parent.set(find(a), find(b));
  const linked = new Set(dag.flat());
  /** @type {Map<string, string[]>} */
  const comps = new Map();
  for (const id of ids) {
    if (!linked.has(id)) continue;
    const r = find(id);
    comps.set(r, [...(comps.get(r) ?? []), id]);
  }
  const wanted = new Set(first);
  const groups = [...comps.values()]
    .map((members) => {
      const set = new Set(members);
      const own = dag.filter(([a]) => set.has(a));
      const columns = layerOf
        ? new Map(members.map((id) => [id, /** @type {number} */ (layerOf.get(id))]))
        : longestPathLayers(members, own);
      const { layers, crossings } = reduceCrossings(columns, own);
      return { ids: [...members].sort(byId), layers, crossings };
    })
    .sort(
      (a, b) =>
        Number(b.ids.some((id) => wanted.has(id))) - Number(a.ids.some((id) => wanted.has(id))) ||
        b.ids.length - a.ids.length ||
        byId(a.ids[0], b.ids[0]),
    );
  return { groups, grid: ids.filter((id) => !linked.has(id)).sort(byId) };
}
