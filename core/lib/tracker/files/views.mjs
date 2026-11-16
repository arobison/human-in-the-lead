// The views over the item graph (design part 3.4, "Generated views"): ready, blocked, the
// decision backlog, projects, the item lists, the dependency diagrams, the critical path, the
// milestones (each with its unmet clauses and scope; long outcomes first), the milestone graph
// (design part 12.1.2) and the merged-but-unreleased stock. Each returns text. The first four are the reference views byte for
// byte (design part 16.7).

import { posix } from 'node:path';
import { ITEM_KINDS, describeProgress, findCycles, progress } from './graph.mjs';
import { isLearning, readMilestone } from './milestones.mjs';
import { readProject } from './projects.mjs';
import { DEFAULT_OWNER, STATE_LABELS } from './format.mjs';

/**
 * @typedef {import('./graph.mjs').Graph} Graph
 * @typedef {import('./graph.mjs').Node} Node
 */

/** A state's display label ("in-progress" shows as "In progress"). @param {unknown} s */
const stateLabel = (s) => STATE_LABELS[String(s)] ?? String(s);

/** @param {Graph} g @param {string} id */
const titleOf = (g, id) => String(g.get(id)?.data.title ?? id);

/** @param {string} [t] */
const shortTitle = (t = '') => t.replace(/^The /, '');

/** Group items by project, in the order first seen. @param {Node[]} its */
function byProject(its) {
  /** @type {Map<string, Node[]>} */
  const groups = new Map();
  for (const it of its) {
    const p = String(it.data.project);
    if (!groups.has(p)) groups.set(p, []);
    /** @type {Node[]} */ (groups.get(p)).push(it);
  }
  return [...groups];
}

/** @param {Graph} g @param {Node[]} its @param {(it: Node) => string} line */
function grouped(g, its, line) {
  /** @type {string[]} */
  const out = [];
  for (const [n, [p, group]] of byProject(its).entries()) {
    if (n > 0) out.push('');
    out.push(`${p} ${titleOf(g, p)}`);
    for (const it of group) out.push(`  ${line(it)}`);
  }
  return out;
}

/** One line per item: ID, kind and title, claim, project. @param {Graph} g @param {Node} it */
export function itemRow(g, it) {
  const d = it.data;
  const project = String(g.get(String(d.project))?.data.title ?? d.project);
  const claim = d.claimed_by && d.state === 'in-progress' ? ` [${d.claimed_by}]` : '';
  return `${d.id}\t${d.kind === 'work' ? '' : `${d.kind}: `}${d.title}${claim}\t(${shortTitle(project)})`;
}

/** Planned items whose needs are all done, by project. @param {Graph} g */
export function viewReady(g) {
  const ready = g.items.filter(g.isReady);
  const lines = grouped(g, ready, (it) => itemRow(g, it).split('\t').slice(0, 2).join('  '));
  return `${[...lines, '', `${ready.length} ready`].join('\n')}\n`;
}

/** Open items and what they wait on. @param {Graph} g */
export function viewBlocked(g) {
  const blocked = g.items.filter(g.isBlocked);
  const lines = grouped(g, blocked, (it) => {
    const open = g.openNeeds(it).map((n) => `${n} ${titleOf(g, n)}`);
    return `${it.data.id}  ${it.data.title}${it.data.state === 'proposed' ? ' (proposed)' : ''}\n      ← ${open.join('\n        ')}`;
  });
  return `${[...lines, '', `${blocked.length} blocked`].join('\n')}\n`;
}

/**
 * The decision backlog, by project, with what waits on each.
 * @param {Graph} g @param {string} [who] a decider, or "all"; default "owner"
 */
export function viewDecisions(g, who = 'owner') {
  const open = g.items.filter(
    (it) =>
      it.data.kind === 'decision' && g.isOpen(it) && (who === 'all' || it.data.decider === who),
  );
  const lines = grouped(g, open, (it) => {
    const waits = g.dependents(String(it.data.id)).map((d) => d.data.id);
    const first = g.openNeeds(it);
    const out = [`${it.data.id}  ${it.data.title} (${it.data.decider})`];
    if (first.length) out.push(`      first needs ${first.join(', ')}`);
    if (waits.length) out.push(`      waited on by ${waits.join(', ')}`);
    return out.join('\n');
  });
  return `${[...lines, '', `${open.length} open decision(s) for ${who}`].join('\n')}\n`;
}

/**
 * Open cross-project dependencies: which project waits on which, and how many items.
 * @param {Graph} g
 */
export function projectDeps(g) {
  /** @type {Map<string, number>} "from→to" (from waits on to) → count */
  const edges = new Map();
  for (const it of g.items) {
    if (!g.isOpen(it)) continue;
    for (const n of g.needs(it)) {
      const t = g.get(n);
      if (!t || !g.isOpen(t) || t.data.project === it.data.project) continue;
      const key = `${it.data.project}→${t.data.project}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges].map(([k, count]) => {
    const [from, to] = k.split('→');
    return { from, to, count };
  });
}

/** Each project: progress, ready and blocked counts, what it waits on. @param {Graph} g */
export function viewProjects(g) {
  const deps = projectDeps(g);
  /** @type {string[]} */
  const out = [];
  for (const p of g.projects) {
    const id = String(p.data.id);
    const c = progress(g, g.itemsOf(id));
    out.push(
      `${id} ${p.data.title} [${stateLabel(p.data.state)}], led by ${p.data.owner ?? DEFAULT_OWNER}`,
    );
    out.push(`  ${describeProgress(c)}`);
    const appetite = readProject(p.data).appetite;
    if (appetite !== undefined) {
      const shared = g
        .milestonesOf(id)
        .filter((m) => m.data.state !== 'dropped')
        .reduce((sum, m) => sum + (readMilestone(m.data).appetite ?? 0), 0);
      out.push(`  appetite: ${appetite} tokens, ${shared} shared out to its milestones`);
    }
    const on = deps.filter((e) => e.from === id);
    const by = deps.filter((e) => e.to === id);
    /** @param {typeof deps} es @param {'from' | 'to'} key */
    const fmt = (es, key) =>
      es.map((e) => `${e[key]} ${titleOf(g, e[key])} (${e.count})`).join('; ') || 'nothing open';
    out.push(`  waits on: ${fmt(on, 'to')}`);
    out.push(`  waited on by: ${fmt(by, 'from')}`);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

// --- The lists -------------------------------------------------------------

const BOX = /** @type {Record<string, string>} */ ({
  done: 'x',
  'in-progress': '~',
  planned: ' ',
  proposed: '?',
  dropped: '-',
});

/** @param {string[]} ids */
function joinIds(ids) {
  return ids.length < 3 ? ids.join(' and ') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
}

/** @param {Graph} g @param {Node} it @param {string} projectId */
function needsText(g, it, projectId) {
  const needs = g.needs(it).map((n) => {
    const t = g.get(n);
    const other = t && t.data.project !== projectId;
    return other ? `${n} (${shortTitle(String(g.get(String(t.data.project))?.data.title))})` : n;
  });
  return needs.length ? `Needs ${joinIds(needs)}.` : 'Needs nothing.';
}

/** @param {Graph} g @param {Node} it @param {string} projectId @param {string} linkBase */
function itemLine(g, it, projectId, linkBase) {
  const d = it.data;
  const tag = d.kind === 'work' ? '' : `${d.kind}: `;
  const id = linkBase ? `[${d.id}](${linkBase}${it.folder}/${it.file})` : d.id;
  let tail;
  if (d.state === 'dropped') tail = `Dropped: ${d.reason}`;
  else if (d.state === 'done') tail = 'Done.';
  else {
    tail = needsText(g, it, projectId);
    if (d.state === 'in-progress') tail += ` Claimed by ${d.claimed_by ?? '?'}.`;
    else if (d.state === 'proposed') tail = `Proposed. ${tail}`;
    if (d.kind === 'decision') tail += ` Decided by ${d.decider}.`;
    else if (d.kind === 'external') tail += ` Waiting on ${d.waiting_on}.`;
  }
  return `- [${BOX[String(d.state)] ?? ' '}] ${id} ${tag}${String(d.title).replace(/\.$/, '')}. ${tail}`;
}

/**
 * The generated item lists, as markdown: projects and their items.
 * @param {Graph} g @param {{ linkBase?: string }} [options]
 */
export function renderLists(g, { linkBase = '' } = {}) {
  /** @type {string[]} */
  const out = [];
  /** @param {Node} p @param {number} level */
  const projectBlock = (p, level) => {
    const items = g.itemsOf(String(p.data.id));
    const plan = p.data.plan
      ? ` Plan: [${String(p.data.plan).split('/').pop()}](${linkBase ? '../../../' : ''}${p.data.plan}).`
      : '';
    const pid = linkBase ? `[${p.data.id}](${linkBase}${p.folder}/${p.file})` : p.data.id;
    out.push(
      `${'#'.repeat(level)} ${p.data.title}`,
      '',
      `${pid}, ${stateLabel(p.data.state)}, led by ${p.data.owner ?? DEFAULT_OWNER}: ${describeProgress(progress(g, items))}.${plan}`,
      '',
    );
    // Each item shows under the first of the project's milestones that names it as a constraint.
    const milestones = g.milestonesOf(String(p.data.id));
    const placed = new Set();
    /** @type {[string, Node[]][]} */
    const groups = [];
    for (const m of milestones) {
      const needs = g.needs(m);
      const its = items.filter((it) => needs.includes(String(it.data.id)) && !placed.has(it));
      its.forEach((it) => placed.add(it));
      const mid = linkBase ? `[${m.data.id}](${linkBase}${m.folder}/${m.file})` : m.data.id;
      groups.push([`${m.data.title} (${mid}, ${stateLabel(m.data.state)})`, its]);
    }
    groups.push(['', items.filter((it) => !placed.has(it))]);
    for (const [m, its] of groups) {
      if (!its.length) continue;
      if (m) out.push(`Milestone: ${m}`, '');
      else if (milestones.length) out.push('No milestone', '');
      for (const it of its) out.push(itemLine(g, it, String(p.data.id), linkBase));
      out.push('');
    }
  };
  for (const p of g.projects) projectBlock(p, 3);
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

export const LIST_BEGIN =
  "<!-- work:lists:begin (generated by views.mjs lists --write; don't edit by hand) -->";
export const LIST_END = '<!-- work:lists:end -->';

/**
 * Replace the text between the list markers. Throws if they are absent.
 * @param {string} text @param {string} generated
 */
export function replaceBetweenMarkers(text, generated) {
  const a = text.indexOf('<!-- work:lists:begin');
  const b = text.indexOf(LIST_END);
  if (a < 0 || b < a) throw new Error("the work:lists markers aren't in the file");
  return `${text.slice(0, a)}${LIST_BEGIN}\n\n${generated}\n${text.slice(b)}`;
}

// --- Milestones and releases -----------------------------------------------

/**
 * Each open milestone: its outcome, its unmet clauses, whether its check is due, its
 * scope and what shaping still owes it; then the closed ones, one line each.
 * @param {Graph} g
 * @param {(m: Node) => import('./milestones.mjs').MilestoneDerived} derived
 */
export function viewMilestones(g, derived) {
  /** @type {string[]} */
  const out = [];
  // Long outcomes (no project) first, then each project's milestones, each group in ID order.
  const open = [...g.longOutcomes(), ...g.milestones.filter((m) => m.data.project)].filter(
    g.isOpen,
  );
  for (const m of open) {
    const d = derived(m);
    const data = readMilestone(m.data);
    const parent = m.data.project ? String(m.data.project) : null;
    const where = parent ? `under ${parent} ${titleOf(g, parent)}` : 'a long outcome';
    if (out.length) out.push('');
    out.push(
      `${m.data.id} ${m.data.title} [${stateLabel(m.data.state)}], ${isLearning(data) ? 'learning, ' : ''}${where}`,
    );
    if (data.outcome) out.push(`  outcome: ${data.outcome}`);
    const ids = g.needs(m);
    const done = ids.filter((id) => g.get(id)?.data.state === 'done').length;
    out.push(`  constraints: ${done} of ${ids.length} done`);
    if (d.check_due) out.push('  check due: every constraint is done; the check has not passed');
    for (const e of d.unmet_clauses) {
      const what = e.clause ? `${e.clause} ${e.text}` : 'not linked to a clause yet';
      const why = [
        ...(e.open.length ? [`open: ${e.open.join(', ')}`] : []),
        ...(e.checked ? [] : ['check not passed']),
      ];
      out.push(`  unmet: ${what} (${why.join('; ')})`);
    }
    const s = d.scope;
    if (data.contributions.length || s.appetite_tokens !== null) {
      const parts = [
        `appetite ${s.appetite_tokens ?? 'not set'}`,
        `constraints ${s.constraint_tokens} tokens`,
        `in scope: ${s.fits.join(', ') || 'none'}`,
      ];
      if (s.cut.length) parts.push(`cut: ${s.cut.join(', ')}`);
      if (s.unsized.length) parts.push(`not sized: ${s.unsized.join(', ')}`);
      if (s.too_big) parts.push('too big: the constraints alone exceed the appetite');
      out.push(`  scope: ${parts.join('; ')}`);
    }
    if (d.to_shape.length) out.push(`  to shape: ${d.to_shape.join('; ')}`);
  }
  const closed = g.milestones.filter((m) => !g.isOpen(m));
  if (closed.length) {
    if (out.length) out.push('');
    for (const m of closed) out.push(`${m.data.id} ${m.data.title} [${stateLabel(m.data.state)}]`);
  }
  out.push('', `${open.length} open milestone(s)`);
  return `${out.join('\n').replace(/^\n+/, '')}\n`;
}

/**
 * The merged-but-unreleased stock: Done work items that no full release lists yet, by project.
 * @param {Graph} g @param {Map<string, string>} released item ID to the release that shipped it
 */
export function viewUnreleased(g, released) {
  const stock = g.items.filter(
    (it) =>
      it.data.kind === 'work' && it.data.state === 'done' && !released.has(String(it.data.id)),
  );
  const lines = grouped(g, stock, (it) => `${it.data.id}  ${it.data.title}`);
  return `${[...lines, '', `${stock.length} merged item(s) not in a release`].join('\n')}\n`;
}

// --- Diagrams --------------------------------------------------------------

const CLASS_DEFS = [
  '  classDef open fill:#fff,stroke:#333',
  '  classDef done fill:#ddd,color:#666,stroke:#999',
  '  classDef dropped fill:#eee,color:#999,stroke:#ccc,stroke-dasharray:3',
  '  classDef proposed fill:#fff,stroke:#333,stroke-dasharray:4',
  '  classDef decision fill:#fff4d6,stroke:#a67c00',
  '  classDef external fill:#e6f0ff,stroke:#3366aa',
];

/** @param {string} id */
const node = (id) => id.replace('-', '_');

/** @param {Node} it */
function classOf(it) {
  const s = it.data.state;
  if (s === 'done') return 'done';
  if (s === 'dropped') return 'dropped';
  if (it.data.kind === 'decision') return 'decision';
  if (it.data.kind === 'external') return 'external';
  return s === 'proposed' ? 'proposed' : 'open';
}

/** The item graph as Mermaid. @param {Graph} g @param {string} [projectId] */
export function mermaidItems(g, projectId) {
  /** @param {Node} it */
  const label = (it) => `${it.data.id} ${it.data.title}`.replace(/["`]/g, "'").slice(0, 70);
  const lines = ['graph LR'];
  const shown = new Set();
  const projects = projectId ? [g.get(projectId)].filter((p) => p !== undefined) : g.projects;
  for (const p of projects) {
    lines.push(
      `  subgraph ${node(String(p.data.id))}["${shortTitle(String(p.data.title)).replace(/"/g, "'")}"]`,
    );
    for (const it of g.itemsOf(String(p.data.id))) {
      shown.add(it.data.id);
      lines.push(`    ${node(String(it.data.id))}["${label(it)}"]:::${classOf(it)}`);
    }
    lines.push('  end');
  }
  /** @type {string[]} */
  const edges = [];
  for (const it of g.items.filter((i) => shown.has(i.data.id))) {
    for (const n of g.needs(it)) {
      const t = g.get(n);
      if (t && !shown.has(n)) {
        shown.add(n);
        lines.push(`  ${node(n)}["${label(t)}"]:::${classOf(t)}`);
      }
      edges.push(`  ${node(n)} --> ${node(String(it.data.id))}`);
    }
  }
  lines.push(...edges, ...CLASS_DEFS);
  return `${lines.join('\n')}\n`;
}

/** The project graph as Mermaid. @param {Graph} g */
export function mermaidProjects(g) {
  const lines = ['graph LR'];
  for (const p of g.projects) {
    const c = progress(g, g.itemsOf(String(p.data.id)));
    lines.push(
      `  ${node(String(p.data.id))}["${shortTitle(String(p.data.title)).replace(/"/g, "'")}<br/>${c.done} of ${c.total - c.dropped} done"]`,
    );
  }
  for (const e of projectDeps(g)) lines.push(`  ${node(e.to)} -->|${e.count}| ${node(e.from)}`);
  return `${lines.join('\n')}\n`;
}

// --- The critical path -----------------------------------------------------

/**
 * The longest chain of open items by `needs`, weighted by `estimate_tokens` where an item has
 * one (the optional key) and by 1 where it does not. Derived, never stored (design part 3.2).
 * Returns one chain per open item that nothing open needs, longest first, ties by ID.
 * @param {Graph} g
 * @returns {{ weight: number, chain: Node[] }[]}
 */
export function criticalPaths(g) {
  /** @type {Map<string, { weight: number, chain: Node[] }>} */
  const memo = new Map();
  const weightOf = (/** @type {Node} */ it) => {
    const w = Number(it.data.estimate_tokens);
    return Number.isFinite(w) && w > 0 ? w : 1;
  };
  /** @param {Node} it @param {Set<string>} seen @returns {{ weight: number, chain: Node[] }} */
  const best = (it, seen) => {
    const id = String(it.data.id);
    const hit = memo.get(id);
    if (hit) return hit;
    seen.add(id);
    let tail = { weight: 0, chain: /** @type {Node[]} */ ([]) };
    for (const n of g.needs(it)) {
      const t = g.get(n);
      if (!t || !g.isOpen(t) || !g.isItem(t) || seen.has(n)) continue;
      const b = best(t, seen);
      if (b.weight > tail.weight) tail = b;
    }
    seen.delete(id);
    const out = { weight: tail.weight + weightOf(it), chain: [...tail.chain, it] };
    memo.set(id, out);
    return out;
  };
  const open = g.items.filter((it) => g.isOpen(it) && ITEM_KINDS.includes(String(it.data.kind)));
  const needed = new Set(open.flatMap((it) => g.needs(it)));
  return open
    .filter((it) => !needed.has(String(it.data.id)))
    .map((it) => best(it, new Set()))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        String(a.chain.at(-1)?.data.id).localeCompare(String(b.chain.at(-1)?.data.id)),
    );
}

/** The longest dependency chains among open items. @param {Graph} g @param {number} [top] */
export function viewCriticalPath(g, top = 5) {
  const paths = criticalPaths(g).slice(0, top);
  if (!paths.length) return 'no open items\n';
  /** @type {string[]} */
  const out = [];
  for (const [i, p] of paths.entries()) {
    out.push(`${i + 1}. weight ${p.weight}, ${p.chain.length} item(s)`);
    for (const it of p.chain)
      out.push(`   ${it.data.id}  ${it.data.title} [${stateLabel(it.data.state)}]`);
  }
  return `${out.join('\n')}\n`;
}

// --- The milestone graph ---------------------------------------------------

/**
 * @typedef {'passed' | 'due' | 'not yet due'} CheckStatus
 * @typedef {object} MilestoneGraphItem a milestone's constraint or contribution
 * @property {string} id
 * @property {string} title
 * @property {string} state
 * @property {'constraint' | 'contribution'} role
 * @property {boolean} critical on the item critical path
 * @property {string | null} path its file, repository-relative; null when it has none
 * @typedef {object} MilestoneGraphNode
 * @property {string} id
 * @property {string} title
 * @property {string} path its file, repository-relative
 * @property {string} state
 * @property {string | null} outcome
 * @property {string | null} project
 * @property {{ done: number, total: number }} constraints its constraints `done` out of all
 * @property {number | null} tokens_spent null where the ledger is not read (the views)
 * @property {number | null} appetite_tokens
 * @property {CheckStatus} check
 * @property {number} remaining_tokens estimate tokens of its open item constraints, each item
 *   weighted as the item critical path weighs it
 * @property {boolean} critical on the milestone critical path
 * @property {number} layer its step: the length of its longest chain of milestone needs (it starts
 *   once everything it waits on is done)
 * @property {MilestoneStage} stage
 * @property {number} in_progress its constraints in progress
 * @property {{ decisions: string[], owner_decisions: string[], external: string[] }} holds open
 *   decisions (and those of them the owner decides) and outside waits that hold it up: among its
 *   open constraints, and what those need directly
 * @property {string[]} waits open milestones it needs that are not done
 * @property {number} waiting_on_it open items and milestones that need it
 * @property {boolean} in_cycle it is in a loop of needs (the check reports the loop)
 * @property {MilestoneGraphItem[]} items its constraints, then its contributions
 * @typedef {'proposed' | 'waiting' | 'ready' | 'in-flight' | 'done' | 'dropped'} MilestoneStage
 *   proposed and dropped by state; done by state; in-flight once a constraint is in progress or
 *   done; waiting while a milestone it needs is not done, or none of its open constraints is
 *   ready; otherwise ready
 * @typedef {object} MilestoneGraphEdge `from` is needed by `to`
 * @property {string} from
 * @property {string} to
 * @property {boolean} critical
 * @property {number} items the items behind the wait: `from`'s open item constraints
 * @typedef {object} MilestoneGraph
 * @property {MilestoneGraphNode[]} nodes in ID order
 * @property {MilestoneGraphEdge[]} edges
 * @property {string[]} critical_path the milestone critical path, first-needed first; empty when
 *   no open milestone has estimate tokens remaining
 * @property {{ id: string | null, title: string, state: string | null }[]} lanes long outcomes (id
 *   and state null), then each project with a milestone, in ID order
 * @property {{ id: string, title: string, release: string, state: string, layer: number, milestones: string[], path: string, needs: { id: string, title: string, state: string, path: string | null }[] }[]} releases
 *   work items with a `release` version (release gates), in board order: by layer, then version.
 *   A done release has layer -1 (before the first step); an open one the step of the last
 *   milestone it needs, else the last step, and never less than an open release it needs; it
 *   stands after that step. `milestones` are those that land before it: the milestones it needs,
 *   and those with an item constraint it needs
 */

/**
 * The web address of the repository's files on its forge, at a branch, from the `origin` remote's
 * URL: `https://github.com/<owner>/<repo>/blob/<branch>`. Only github.com is known; any other
 * remote, or none, gives null. Credentials in the URL are never carried over.
 * @param {string | null | undefined} remote @param {string} [branch] default HEAD, which the forge
 *   resolves to the default branch
 * @returns {string | null}
 */
export function forgeFileBase(remote, branch = 'HEAD') {
  const m =
    /^(?:https:\/\/(?:[^@/]*@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      String(remote ?? '').trim(),
    );
  if (!m || !/^[A-Za-z0-9._/-]+$/.test(branch)) return null;
  return `https://github.com/${m[1]}/${m[2]}/blob/${branch}`;
}

/**
 * The link to a tracker file, the same for every view: on the forge when its base is known,
 * otherwise relative to `from` (a repository-relative directory), otherwise the
 * repository-relative path itself.
 * @param {string} path repository-relative, "/" separated
 * @param {{ base?: string | null, from?: string }} [where]
 */
export function fileHref(path, { base = null, from } = {}) {
  if (base) return `${base}/${encodeURI(path)}`;
  return encodeURI(from ? posix.relative(from, path) : path);
}

/**
 * Order two version strings as semantic versions do: by their numbers, a pre-release (1.0.0-rc.2)
 * before its release (1.0.0), pre-release parts number by number. Anything else compares as text.
 * @param {string} a @param {string} b
 */
export function compareVersions(a, b) {
  const split = (/** @type {string} */ v) => {
    const [core, ...pre] = v.replace(/^v/, '').split('-');
    return { core: core.split('.'), pre: pre.length ? pre.join('-').split('.') : null };
  };
  /** @param {string[]} x @param {string[]} y */
  const parts = (x, y) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      const nx = /^\d+$/.test(x[i]) ? Number(x[i]) : null;
      const ny = /^\d+$/.test(y[i]) ? Number(y[i]) : null;
      const c =
        nx !== null && ny !== null
          ? nx - ny
          : nx !== null
            ? -1
            : ny !== null
              ? 1
              : x[i].localeCompare(y[i]);
      if (c) return Math.sign(c);
    }
    return 0;
  };
  const va = split(a);
  const vb = split(b);
  const c = parts(va.core, vb.core);
  if (c) return c;
  if (!va.pre || !vb.pre) return va.pre ? -1 : vb.pre ? 1 : 0;
  return parts(va.pre, vb.pre);
}

/** An item's weight on a critical path: its estimate, or 1 without one. @param {Node | undefined} it */
const pathWeight = (it) => {
  const w = Number(it?.data.estimate_tokens);
  return Number.isFinite(w) && w > 0 ? w : 1;
};

/**
 * The milestone graph (design part 12.1.2): milestones as nodes, `needs` between milestones (a
 * milestone's constraints that name milestones) as edges. A constraint that names an item is not
 * an edge; it counts toward the node's progress. The critical path is the chain of milestones not
 * yet done with the most estimate tokens remaining, by the rule items use: each open item
 * constraint weighs its `estimate_tokens`, or 1 without one.
 * @param {Graph} g
 * @param {{ checkOf: (m: Node) => CheckStatus, tokensSpent?: (m: Node) => number | null }} how
 * @returns {MilestoneGraph}
 */
export function milestoneGraph(g, { checkOf, tokensSpent = () => null }) {
  const isM = (/** @type {string} */ id) => {
    const n = g.get(id);
    return n !== undefined && g.isMilestone(n);
  };
  const milestoneNeeds = (/** @type {Node} */ m) => g.needs(m).filter(isM);
  /** The entries the IDs name, leaving out what does not exist. @param {string[]} ids */
  const nodesOf = (ids) =>
    ids.map((id) => g.get(id)).filter(/** @returns {n is Node} */ (n) => n !== undefined);
  /** A milestone's open item constraints. @param {Node} m */
  const openItems = (m) => nodesOf(g.needs(m)).filter((n) => g.isItem(n) && g.isOpen(n));
  /** Estimate tokens remaining on a milestone. @param {Node} m */
  const remaining = (m) => openItems(m).reduce((sum, n) => sum + pathWeight(n), 0);
  /** @param {Node} m @returns {MilestoneStage} */
  const stageOf = (m) => {
    const s = String(m.data.state);
    if (s === 'proposed' || s === 'dropped' || s === 'done') return s;
    const its = nodesOf(g.needs(m));
    if (its.some((n) => g.isItem(n) && ['in-progress', 'done'].includes(String(n.data.state)))) {
      return 'in-flight';
    }
    if (milestoneNeeds(m).some((id) => g.get(id)?.data.state !== 'done')) return 'waiting';
    const open = openItems(m);
    return open.length && !open.some((n) => g.isReady(n)) ? 'waiting' : 'ready';
  };
  /** @param {Node} m */
  const holdsOf = (m) => {
    const open = openItems(m);
    const around = [...open, ...open.flatMap((n) => nodesOf(g.openNeeds(n)))].filter(g.isOpen);
    /** @param {string} kind */
    const of = (kind) => [
      ...new Set(around.filter((n) => n.data.kind === kind).map((n) => String(n.data.id))),
    ];
    return {
      decisions: of('decision'),
      owner_decisions: of('decision').filter((id) => g.get(id)?.data.decider === DEFAULT_OWNER),
      external: of('external'),
    };
  };

  /** @type {Map<string, number>} */
  const layers = new Map();
  /** @param {Node} m @param {Set<string>} seen @returns {number} */
  const layerOf = (m, seen) => {
    const id = String(m.data.id);
    const hit = layers.get(id);
    if (hit !== undefined) return hit;
    seen.add(id);
    let l = 0;
    for (const n of milestoneNeeds(m)) {
      if (seen.has(n)) continue; // a cycle; the check reports it
      l = Math.max(l, layerOf(/** @type {Node} */ (g.get(n)), seen) + 1);
    }
    seen.delete(id);
    layers.set(id, l);
    return l;
  };

  // The critical path: the heaviest chain of open milestones, as criticalPaths does for items.
  /** @type {Map<string, { weight: number, chain: string[] }>} */
  const memo = new Map();
  /** @param {Node} m @param {Set<string>} seen @returns {{ weight: number, chain: string[] }} */
  const best = (m, seen) => {
    const id = String(m.data.id);
    const hit = memo.get(id);
    if (hit) return hit;
    seen.add(id);
    let tail = { weight: 0, chain: /** @type {string[]} */ ([]) };
    for (const n of milestoneNeeds(m)) {
      const t = /** @type {Node} */ (g.get(n));
      if (!g.isOpen(t) || seen.has(n)) continue;
      const b = best(t, seen);
      if (b.weight > tail.weight) tail = b;
    }
    seen.delete(id);
    const out = { weight: tail.weight + remaining(m), chain: [...tail.chain, id] };
    memo.set(id, out);
    return out;
  };
  const open = g.milestones.filter(g.isOpen);
  const needed = new Set(open.flatMap(milestoneNeeds));
  const top = open
    .filter((m) => !needed.has(String(m.data.id)))
    .map((m) => best(m, new Set()))
    .sort(
      (a, b) => b.weight - a.weight || String(a.chain.at(-1)).localeCompare(String(b.chain.at(-1))),
    )[0];
  const path = top && top.weight > 0 ? top.chain : [];
  const looped = new Set(findCycles(g).flat());
  const onPath = new Set(path);
  const criticalItems = new Set((criticalPaths(g)[0]?.chain ?? []).map((it) => String(it.data.id)));

  const nodes = g.milestones.map((m) => {
    const id = String(m.data.id);
    const data = readMilestone(m.data);
    const ids = g.needs(m);
    /** @param {string} x @param {'constraint' | 'contribution'} role @returns {MilestoneGraphItem} */
    const item = (x, role) => ({
      id: x,
      title: titleOf(g, x),
      state: String(g.get(x)?.data.state ?? 'unknown'),
      role,
      critical: criticalItems.has(x),
      path: g.get(x)?.path ?? null,
    });
    return {
      id,
      title: String(m.data.title),
      path: m.path,
      state: String(m.data.state),
      outcome: data.outcome ?? null,
      project: m.data.project ? String(m.data.project) : null,
      constraints: {
        done: ids.filter((x) => g.get(x)?.data.state === 'done').length,
        total: ids.length,
      },
      tokens_spent: tokensSpent(m),
      appetite_tokens: data.appetite ?? null,
      check: checkOf(m),
      remaining_tokens: g.isOpen(m) ? remaining(m) : 0,
      critical: onPath.has(id),
      layer: layerOf(m, new Set()),
      stage: stageOf(m),
      in_progress: ids.filter((x) => g.get(x)?.data.state === 'in-progress').length,
      holds: holdsOf(m),
      waits: milestoneNeeds(m).filter((x) => g.get(x)?.data.state !== 'done'),
      waiting_on_it: [
        ...g.dependents(id),
        ...g.milestones.filter((o) => g.isOpen(o) && g.needs(o).includes(id)),
      ].length,
      in_cycle: looped.has(id),
      items: [
        ...ids.map((x) => item(x, 'constraint')),
        ...data.contributions.map((c) => item(c.id, 'contribution')),
      ],
    };
  });
  const edges = g.milestones.flatMap((m) => {
    const to = String(m.data.id);
    return milestoneNeeds(m).map((from) => ({
      from,
      to,
      critical: onPath.has(from) && onPath.has(to) && path.indexOf(from) === path.indexOf(to) - 1,
      items: openItems(/** @type {Node} */ (g.get(from))).length,
    }));
  });
  const lanes = [
    ...(g.milestones.some((m) => !m.data.project)
      ? [{ id: null, title: 'Long outcomes', state: null }]
      : []),
    ...g.projects
      .filter((p) => g.milestones.some((m) => m.data.project === p.data.id))
      .map((p) => ({
        id: String(p.data.id),
        title: shortTitle(String(p.data.title)),
        state: String(p.data.state),
      })),
  ];
  // Release gates. A done release has happened: it stands before the first step (layer -1). An
  // open one stands after the last milestone it needs (one it names, or one holding an item
  // constraint it needs), else after the last step, and never left of an open release it needs.
  const lastStep = Math.max(0, ...nodes.map((n) => n.layer));
  const gates = g.items.filter((it) => it.data.kind === 'work' && it.data.release !== undefined);
  const gateIds = new Set(gates.map((it) => String(it.data.id)));
  /** @type {Map<string, number>} */
  const gateLayer = new Map();
  const drafts = gates.map((it) => {
    const id = String(it.data.id);
    const needs = g.needs(it);
    // A milestone that only contains a needed milestone is not itself needed.
    const before = g.milestones.filter(
      (m) =>
        needs.includes(String(m.data.id)) ||
        g.needs(m).some((x) => x !== id && !isM(x) && needs.includes(x)),
    );
    const after = before.map((m) => layers.get(String(m.data.id)) ?? 0);
    const done = it.data.state === 'done';
    gateLayer.set(id, done ? -1 : after.length ? Math.max(...after) : lastStep);
    return { it, id, needs, before, done };
  });
  // Push each open release right of the open releases it needs, until nothing moves.
  for (let pass = 0; pass < gates.length; pass++) {
    let moved = false;
    for (const d of drafts) {
      if (d.done) continue;
      for (const n of d.needs.filter((x) => gateIds.has(x))) {
        const need = gateLayer.get(n) ?? -1;
        if (need > (gateLayer.get(d.id) ?? 0)) {
          gateLayer.set(d.id, need);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const releases = drafts
    .map((d) => ({
      id: d.id,
      title: String(d.it.data.title),
      release: String(d.it.data.release),
      state: String(d.it.data.state),
      layer: /** @type {number} */ (gateLayer.get(d.id)),
      milestones: d.before.map((m) => String(m.data.id)),
      path: d.it.path,
      needs: d.needs.map((x) => ({
        id: x,
        title: titleOf(g, x),
        state: String(g.get(x)?.data.state ?? 'unknown'),
        path: g.get(x)?.path ?? null,
      })),
    }))
    .sort(
      (a, b) =>
        a.layer - b.layer || compareVersions(a.release, b.release) || a.id.localeCompare(b.id),
    );
  return { nodes, edges, critical_path: path, lanes, releases };
}

/** The first sentence of a text, at most `max` characters. @param {string | null} t @param {number} [max] */
export function oneSentence(t, max = 80) {
  if (!t) return '';
  const first = /^.*?[.!?](?=\s|$)/.exec(t.trim())?.[0] ?? t.trim();
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/** A node's progress lines, as the graph and the table show them. @param {MilestoneGraphNode} n */
export function milestoneFacts(n) {
  const spent = n.tokens_spent === null ? '—' : String(n.tokens_spent);
  return {
    constraints: `${n.constraints.done} of ${n.constraints.total} done`,
    tokens:
      n.appetite_tokens === null
        ? `${spent} tokens, no appetite set`
        : `${spent} of ${n.appetite_tokens} tokens`,
    check: n.check === 'not yet due' ? 'check not yet due' : `check ${n.check}`,
  };
}

/** Text safe inside a quoted Mermaid label. @param {string} s */
const mermaidText = (s) =>
  s
    // `#` first, as every other escape writes one; then a backslash, so none is left raw; then
    // `&`, so an entity in the text shows as written.
    .replace(/#/g, '#35;')
    .replace(/\\/g, '#92;')
    .replace(/&/g, '#38;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/`/g, "'");

/** The milestone graph as Mermaid. @param {MilestoneGraph} mg */
export function mermaidMilestones(mg) {
  const lines = ['graph LR'];
  for (const n of mg.nodes) {
    const f = milestoneFacts(n);
    const label = [
      `${n.id} ${n.title}`,
      oneSentence(n.outcome, 60),
      `constraints ${f.constraints}`,
      f.tokens,
      f.check,
    ]
      .filter(Boolean)
      .map(mermaidText)
      .join('<br/>');
    const cls =
      n.state === 'done'
        ? 'done'
        : n.state === 'dropped'
          ? 'dropped'
          : n.state === 'proposed'
            ? 'proposed'
            : 'open';
    lines.push(`  ${node(n.id)}["${label}"]:::${cls}`);
  }
  for (const e of mg.edges)
    lines.push(`  ${node(e.from)} ${e.critical ? '==>' : '-->'} ${node(e.to)}`);
  lines.push(...CLASS_DEFS.slice(0, 4), '  classDef critical stroke:#b3261e,stroke-width:3px');
  if (mg.critical_path.length)
    lines.push(`  class ${mg.critical_path.map(node).join(',')} critical`);
  return `${lines.join('\n')}\n`;
}

/** Text safe in a markdown table cell. @param {string} s */
const cell = (s) =>
  // The backslash first, so a `\|` in the text cannot end up as an unescaped pipe; `&`, `<` and
  // `>` as entities, so the text shows as written and makes no HTML.
  s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The view `milestones.md` (design parts 3.4 and 12.1.2): the graph, then a table of the same
 * fields with each milestone's constraints and contributions and their state, then the text view
 * of unmet clauses, scope and shaping.
 * @param {MilestoneGraph} mg @param {string} detail the text view of the milestones
 * @param {string} [from] the views directory, repository-relative, which links are relative to
 */
export function renderMilestonesView(mg, detail, from = 'work/views') {
  /** @param {string} id @param {string | null} path */
  const link = (id, path) => (path ? `[${id}](${fileHref(path, { from })})` : id);
  const path = mg.critical_path.length
    ? `Critical path (thick edges, red outline): ${mg.critical_path.join(' → ')}.`
    : 'No critical path: no open milestone has estimate tokens remaining.';
  /** @param {MilestoneGraphItem[]} its */
  const items = (its) =>
    its
      .map(
        (i) =>
          `${link(i.id, i.path)} ${stateLabel(i.state)}${i.critical ? ' (critical path)' : ''}`,
      )
      .join(', ') || '—';
  const rows = mg.nodes.map((n) => {
    const f = milestoneFacts(n);
    // Links are built from IDs and file paths, which need no escaping; the text around them is
    // escaped.
    return `| ${link(n.id, n.path)} ${cell(`${n.title}${n.critical ? ' (critical path)' : ''}`)} | ${stateLabel(n.state)} | ${cell(n.outcome ?? '—')} | ${f.constraints} | ${f.tokens} | ${n.check} | ${items(n.items.filter((i) => i.role === 'constraint'))} | ${items(n.items.filter((i) => i.role === 'contribution'))} |`;
  });
  return [
    '```mermaid',
    mermaidMilestones(mg).trimEnd(),
    '```',
    '',
    path,
    '',
    '| Milestone | State | Outcome | Constraints | Tokens spent | Check | Constraints and their state | Contributions and their state |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    'Tokens spent come from the ledger in the private store, so this view shows — for them; `hitld dashboard` shows the figures. The item graph is in [items-graph.md](items-graph.md).',
    '',
    '## Unmet clauses, scope and shaping',
    '',
    '```text',
    detail.trimEnd(),
    '```',
    '',
  ].join('\n');
}
