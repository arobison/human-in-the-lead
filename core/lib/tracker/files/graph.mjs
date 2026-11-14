// The item graph and the derived states (design part 3.2, "Derived states and fields"): ready,
// blocked, open needs, progress. Derived values are computed here from the stored fields and
// never written to a file.

import { idNumber } from './tree.mjs';

/**
 * @typedef {import('./tree.mjs').Entry} Entry
 * @typedef {Entry & { data: NonNullable<Entry['data']> }} Node an entry with front matter
 *
 * @typedef {object} Graph
 * @property {Map<string, Node>} byId
 * @property {[Node, Node][]} duplicates pairs of entries that share an ID
 * @property {Node[]} all every entry with an ID, in number order
 * @property {Node[]} items work, decision and external entries
 * @property {Node[]} projects
 * @property {Node[]} initiatives
 * @property {(id: string) => Node | undefined} get
 * @property {(it: Node) => string[]} needs
 * @property {(it: Node) => boolean} isItem
 * @property {(it: Node) => boolean} isOpen
 * @property {(it: Node) => string[]} openNeeds needs that are not Done
 * @property {(it: Node) => boolean} isReady Planned, every need Done
 * @property {(it: Node) => boolean} isBlocked Planned or Proposed with an open need
 * @property {(projectId: string) => Node[]} itemsOf
 * @property {(initiativeId: string) => Node[]} projectsOf
 * @property {(id: string) => Node[]} dependents open items that need `id`
 */

export const ITEM_KINDS = ['work', 'decision', 'external'];

/** @param {unknown} v @returns {string[]} */
export function list(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [String(v)];
}

/**
 * Index loaded entries. A later entry with an ID already seen goes to `duplicates`.
 * @param {Entry[]} entries
 * @returns {Graph}
 */
export function buildGraph(entries) {
  /** @type {Map<string, Node>} */
  const byId = new Map();
  /** @type {[Node, Node][]} */
  const duplicates = [];
  for (const it of entries) {
    const id = it.data?.id;
    if (!id || typeof id !== 'string') continue;
    const node = /** @type {Node} */ (it);
    const first = byId.get(id);
    if (first) duplicates.push([first, node]);
    else byId.set(id, node);
  }
  const all = [...byId.values()].sort(
    (a, b) => idNumber(String(a.data.id)) - idNumber(String(b.data.id)),
  );
  /** @type {Graph} */
  const g = {
    byId,
    duplicates,
    all,
    items: [],
    projects: [],
    initiatives: [],
    get: (id) => byId.get(id),
    needs: (it) => list(it.data.needs),
    isItem: (it) => ITEM_KINDS.includes(String(it.data.kind)),
    isOpen: (it) => !['Done', 'Dropped'].includes(String(it.data.status)),
    openNeeds: (it) => list(it.data.needs).filter((id) => byId.get(id)?.data.status !== 'Done'),
    isReady: (it) => it.data.status === 'Planned' && g.openNeeds(it).length === 0,
    isBlocked: (it) =>
      ['Planned', 'Proposed'].includes(String(it.data.status)) && g.openNeeds(it).length > 0,
    itemsOf: (projectId) => g.items.filter((it) => it.data.project === projectId),
    projectsOf: (initiativeId) => g.projects.filter((p) => p.data.initiative === initiativeId),
    dependents: (id) => g.items.filter((it) => g.isOpen(it) && g.needs(it).includes(id)),
  };
  g.items = all.filter(g.isItem);
  g.projects = all.filter((it) => it.data.kind === 'project');
  g.initiatives = all.filter((it) => it.data.kind === 'initiative');
  return g;
}

/**
 * @typedef {{ total: number, done: number, dropped: number, ready: number, blocked: number, inProgress: number, proposed: number }} Counts
 */

/**
 * Progress counts for a set of items.
 * @param {Graph} g @param {Node[]} items
 * @returns {Counts}
 */
export function progress(g, items) {
  const c = { total: 0, done: 0, dropped: 0, ready: 0, blocked: 0, inProgress: 0, proposed: 0 };
  for (const it of items) {
    c.total++;
    const s = it.data.status;
    if (s === 'Done') c.done++;
    else if (s === 'Dropped') c.dropped++;
    else if (s === 'In progress') c.inProgress++;
    else if (g.isReady(it)) c.ready++;
    else if (g.isBlocked(it)) c.blocked++;
    if (s === 'Proposed') c.proposed++;
  }
  return c;
}

/** @param {Counts} c */
export function describeProgress(c) {
  const live = c.total - c.dropped;
  const parts = [`${c.done} of ${live} done`];
  if (c.inProgress) parts.push(`${c.inProgress} in progress`);
  parts.push(`${c.ready} ready`, `${c.blocked} blocked`);
  if (c.proposed) parts.push(`${c.proposed} proposed`);
  if (c.dropped) parts.push(`${c.dropped} dropped`);
  return parts.join(', ');
}

/**
 * Dependency cycles among items, each as the list of IDs around it.
 * @param {Graph} g
 * @returns {string[][]}
 */
export function findCycles(g) {
  /** @type {string[][]} */
  const cycles = [];
  const state = new Map(); // 1 visiting, 2 done
  /** @type {string[]} */
  const stack = [];
  /** @param {string} id */
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const n of g.needs(/** @type {Node} */ (g.get(id)))) {
      if (!g.get(n)) continue;
      if (state.get(n) === 1) cycles.push([...stack.slice(stack.indexOf(n)), n]);
      else if (!state.has(n)) visit(n);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const it of g.items) {
    const id = String(it.data.id);
    if (!state.has(id)) visit(id);
  }
  return cycles;
}
