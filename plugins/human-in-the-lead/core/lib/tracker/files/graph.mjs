// The item graph and the derived states (design part 3.2, "Derived states and fields"): ready,
// blocked, open needs, progress. Derived values are computed here from the stored fields and
// never written to a file.

import {
  MILESTONE_KINDS,
  formatConstraint,
  isBad,
  parseConstraintLink,
  readMilestone,
} from './milestones.mjs';
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
 * @property {Node[]} milestones milestone entries
 * @property {(id: string) => Node | undefined} get
 * @property {(it: Node) => string[]} needs the IDs an item or a milestone needs (a milestone's
 *   constraints)
 * @property {(it: Node) => boolean} isItem
 * @property {(it: Node) => boolean} isMilestone
 * @property {(it: Node) => boolean} isOpen
 * @property {(it: Node) => string[]} openNeeds needs that are not done
 * @property {(it: Node) => boolean} isReady planned, every need done
 * @property {(it: Node) => boolean} isBlocked planned with an open need (design part 3.2)
 * @property {(projectId: string) => Node[]} itemsOf
 * @property {(id: string) => Node[]} dependents open items that need `id`
 * @property {(projectId: string) => Node[]} milestonesOf milestones under a project
 * @property {() => Node[]} longOutcomes milestones with no project: long outcomes
 * @property {(id: string) => Node[]} constraintOf milestones whose constraints name `id`
 * @property {(m: Node) => import('./milestones.mjs').Constraint[]} constraintsOf a milestone's
 *   constraints, derived from the items (HITLD-767; see `constraintLinks`)
 * @property {(m: Node) => Record<string, unknown>} milestoneData a milestone's stored keys with
 *   `constraints` replaced by the derived list: for reading only, never for writing
 * @property {(id: string) => Node[]} contributesTo milestones whose contributions name `id`
 */

export const ITEM_KINDS = ['work', 'decision', 'external'];

/**
 * Whether an entry carries its own `constraint_of`.
 * @param {{ data?: Record<string, unknown> | null }} it
 */
export const holdsLinks = (it) => Boolean(it.data && Object.hasOwn(it.data, 'constraint_of'));

/**
 * The milestones an entry's own `constraint_of` names, parsed entries only.
 * @param {{ data?: Record<string, unknown> | null }} it @returns {Set<string>}
 */
export const linkedMilestones = (it) =>
  new Set(
    holdsLinks(it)
      ? list(it.data?.constraint_of).flatMap((s) => {
          const l = parseConstraintLink(String(s));
          return isBad(l) ? [] : [l.milestone];
        })
      : [],
  );

/**
 * Every constraint link, by milestone ID (HITLD-767). The link lives on the item, as its
 * `constraint_of` ("<milestone ID> c<n>"), so a pull request that files an item edits only the
 * item's file. Until a tracker is migrated (`hitld work migrate constraints-on-items`), a
 * milestone's retired `constraints` line is read as well, and the item side wins: the line's
 * entries for an item whose own `constraint_of` names that milestone are not read. Entries that do
 * not parse are left out; the check names them. Each list is in ID order, then clause order.
 * @param {Node[]} all @param {Map<string, Node>} byId
 * @param {(it: Node) => boolean} isMilestone
 * @returns {Map<string, import('./milestones.mjs').Constraint[]>}
 */
function constraintLinks(all, byId, isMilestone) {
  /** @type {Map<string, import('./milestones.mjs').Constraint[]>} */
  const out = new Map();
  const add = (
    /** @type {string} */ m,
    /** @type {string} */ id,
    /** @type {string | null} */ clause,
  ) => {
    const links = out.get(m) ?? [];
    if (!links.some((c) => c.id === id && c.clause === clause)) links.push({ id, clause });
    out.set(m, links);
  };
  for (const it of all) {
    if (!holdsLinks(it)) continue;
    for (const s of list(it.data.constraint_of)) {
      const l = parseConstraintLink(String(s));
      if (!isBad(l)) add(l.milestone, String(it.data.id), l.clause);
    }
  }
  for (const m of all) {
    if (!isMilestone(m)) continue;
    const id = String(m.data.id);
    for (const c of readMilestone(m.data).constraints) {
      const target = byId.get(c.id);
      if (!target || !linkedMilestones(target).has(id)) add(id, c.id, c.clause);
    }
  }
  const order = (/** @type {string} */ id) => idNumber(id);
  for (const links of out.values()) {
    links.sort(
      (a, b) =>
        order(a.id) - order(b.id) ||
        a.id.localeCompare(b.id) ||
        String(a.clause ?? '~').localeCompare(String(b.clause ?? '~'), 'en', { numeric: true }),
    );
  }
  return out;
}

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
  /** @type {Map<string, import('./milestones.mjs').Constraint[]> | undefined} */
  let links;
  const linksOf = (/** @type {Node} */ m) => {
    links ??= constraintLinks(all, byId, (it) => MILESTONE_KINDS.includes(String(it.data.kind)));
    return links.get(String(m.data.id)) ?? [];
  };
  /** @type {Graph} */
  const g = {
    byId,
    duplicates,
    all,
    items: [],
    projects: [],
    milestones: [],
    get: (id) => byId.get(id),
    needs: (it) =>
      g.isMilestone(it) ? [...new Set(linksOf(it).map((c) => c.id))] : list(it.data.needs),
    isItem: (it) => ITEM_KINDS.includes(String(it.data.kind)),
    isMilestone: (it) => MILESTONE_KINDS.includes(String(it.data.kind)),
    isOpen: (it) => !['done', 'dropped'].includes(String(it.data.state)),
    openNeeds: (it) => g.needs(it).filter((id) => byId.get(id)?.data.state !== 'done'),
    isReady: (it) => it.data.state === 'planned' && g.openNeeds(it).length === 0,
    isBlocked: (it) => it.data.state === 'planned' && g.openNeeds(it).length > 0,
    itemsOf: (projectId) => g.items.filter((it) => it.data.project === projectId),
    dependents: (id) => g.items.filter((it) => g.isOpen(it) && g.needs(it).includes(id)),
    milestonesOf: (projectId) => g.milestones.filter((m) => m.data.project === projectId),
    longOutcomes: () => g.milestones.filter((m) => !m.data.project),
    constraintOf: (id) => g.milestones.filter((m) => g.needs(m).includes(id)),
    constraintsOf: (m) => linksOf(m),
    milestoneData: (m) => {
      const derived = linksOf(m).map(formatConstraint);
      const { constraints: _, ...rest } = m.data;
      return derived.length ? { ...rest, constraints: derived } : rest;
    },
    contributesTo: (id) =>
      g.milestones.filter((m) => readMilestone(m.data).contributions.some((c) => c.id === id)),
  };
  g.items = all.filter(g.isItem);
  g.projects = all.filter((it) => it.data.kind === 'project');
  g.milestones = all.filter(g.isMilestone);
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
    const s = it.data.state;
    if (s === 'done') c.done++;
    else if (s === 'dropped') c.dropped++;
    else if (s === 'in-progress') c.inProgress++;
    else if (s === 'proposed') c.proposed++;
    else if (g.isReady(it)) c.ready++;
    else if (g.isBlocked(it)) c.blocked++;
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
 * Dependency cycles among items and milestones (a milestone's constraints are its needs), each as
 * the list of IDs around it.
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
  for (const it of [...g.items, ...g.milestones]) {
    const id = String(it.data.id);
    if (!state.has(id)) visit(id);
  }
  return cycles;
}
