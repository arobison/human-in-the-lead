// The views over the item graph (design part 3.4, "Generated views"): ready, blocked, the
// decision backlog, projects, initiatives, the item lists, the dependency diagrams and the
// critical path. Each returns text. The first five and the lists are the reference views
// byte for byte (design part 16.7); the critical path is new.

import { ITEM_KINDS, describeProgress, list, progress } from './graph.mjs';

/**
 * @typedef {import('./graph.mjs').Graph} Graph
 * @typedef {import('./graph.mjs').Node} Node
 */

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
  const claim = d.claimed && d.status === 'In progress' ? ` [${d.claimed}]` : '';
  return `${d.id}\t${d.kind === 'work' ? '' : `${d.kind}: `}${d.title}${claim}\t(${shortTitle(project)})`;
}

/** Planned items whose needs are all Done, by project. @param {Graph} g */
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
    return `${it.data.id}  ${it.data.title}${it.data.status === 'Proposed' ? ' (proposed)' : ''}\n      ← ${open.join('\n        ')}`;
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
      it.data.kind === 'decision' &&
      g.isOpen(it) &&
      (who === 'all' || it.data['decided-by'] === who),
  );
  const lines = grouped(g, open, (it) => {
    const waits = g.dependents(String(it.data.id)).map((d) => d.data.id);
    const first = g.openNeeds(it);
    const out = [`${it.data.id}  ${it.data.title} (${it.data['decided-by']})`];
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
    out.push(`${id} ${p.data.title} [${p.data.status}], led by ${p.data.lead}`);
    out.push(`  ${describeProgress(c)}`);
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

/** Each initiative: its projects' progress rolled up. @param {Graph} g */
export function viewInitiatives(g) {
  /** @type {string[]} */
  const out = [];
  for (const ini of g.initiatives) {
    const projects = g.projectsOf(String(ini.data.id));
    const all = projects.flatMap((p) => g.itemsOf(String(p.data.id)));
    out.push(`${ini.data.id} ${ini.data.title} [${ini.data.status}]`);
    for (const p of projects) {
      out.push(
        `  ${p.data.id} ${p.data.title}: ${describeProgress(progress(g, g.itemsOf(String(p.data.id))))}`,
      );
    }
    const decisions = all.filter((it) => it.data.kind === 'decision' && g.isOpen(it));
    const external = all.filter((it) => it.data.kind === 'external' && g.isOpen(it));
    out.push(`  all: ${describeProgress(progress(g, all))}`);
    out.push(`  open decisions: ${decisions.length}; waiting outside: ${external.length}`);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

// --- The lists -------------------------------------------------------------

const BOX = /** @type {Record<string, string>} */ ({
  Done: 'x',
  'In progress': '~',
  Planned: ' ',
  Proposed: '?',
  Dropped: '-',
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
  if (d.status === 'Dropped') tail = `Dropped: ${d.reason}`;
  else if (d.status === 'Done') tail = 'Done.';
  else {
    tail = needsText(g, it, projectId);
    if (d.status === 'In progress') tail += ` Claimed by ${d.claimed ?? '?'}.`;
    else if (d.status === 'Proposed') tail = `Proposed. ${tail}`;
    if (d.kind === 'decision') tail += ` Decided by ${d['decided-by']}.`;
    else if (d.kind === 'external') tail += ` Waiting on ${d.party}.`;
  }
  return `- [${BOX[String(d.status)] ?? ' '}] ${id} ${tag}${String(d.title).replace(/\.$/, '')}. ${tail}`;
}

/**
 * The generated item lists, as markdown: initiatives, projects, items.
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
      `${pid}, ${p.data.status}, led by ${p.data.lead}: ${describeProgress(progress(g, items))}.${plan}`,
      '',
    );
    const milestones = list(p.data.milestones);
    /** @type {[string, Node[]][]} */
    const groups = milestones.length
      ? [
          ...milestones.map(
            (/** @type {string} */ m) =>
              /** @type {[string, Node[]]} */ ([m, items.filter((it) => it.data.milestone === m)]),
          ),
          ['', items.filter((it) => !milestones.includes(String(it.data.milestone)))],
        ]
      : [['', items]];
    for (const [m, its] of groups) {
      if (!its.length) continue;
      if (m) out.push(`Milestone: ${m}`, '');
      else if (milestones.length) out.push('No milestone', '');
      for (const it of its) out.push(itemLine(g, it, String(p.data.id), linkBase));
      out.push('');
    }
  };
  for (const ini of g.initiatives) {
    out.push(`### ${ini.data.title}`, '');
    const projects = g.projectsOf(String(ini.data.id));
    const all = projects.flatMap((p) => g.itemsOf(String(p.data.id)));
    const iid = linkBase ? `[${ini.data.id}](${linkBase}${ini.folder}/${ini.file})` : ini.data.id;
    out.push(`${iid}, ${ini.data.status}: ${describeProgress(progress(g, all))}.`, '');
    for (const p of projects) projectBlock(p, 4);
  }
  for (const p of g.projects.filter((p) => !g.get(String(p.data.initiative)))) projectBlock(p, 3);
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
  const s = it.data.status;
  if (s === 'Done') return 'done';
  if (s === 'Dropped') return 'dropped';
  if (it.data.kind === 'decision') return 'decision';
  if (it.data.kind === 'external') return 'external';
  return s === 'Proposed' ? 'proposed' : 'open';
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
  for (const ini of g.initiatives) {
    lines.push(
      `  subgraph ${node(String(ini.data.id))}["${String(ini.data.title).replace(/"/g, "'")}"]`,
    );
    for (const p of g.projectsOf(String(ini.data.id))) {
      const c = progress(g, g.itemsOf(String(p.data.id)));
      lines.push(
        `    ${node(String(p.data.id))}["${shortTitle(String(p.data.title)).replace(/"/g, "'")}<br/>${c.done} of ${c.total - c.dropped} done"]`,
      );
    }
    lines.push('  end');
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
    for (const it of p.chain) out.push(`   ${it.data.id}  ${it.data.title} [${it.data.status}]`);
  }
  return `${out.join('\n')}\n`;
}
