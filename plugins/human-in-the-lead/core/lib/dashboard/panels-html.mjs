// A project's own panels on the page (HITLD-692), drawn from the contract's `views` with no
// script: each panel has a heading, a sentence saying what it holds, and its content as a table or
// a list that reads without CSS; a chart's picture is inline SVG hidden from screen readers, beside
// that text. Every value a project supplies is escaped and shown as text, never as markup or a
// link: only an item's ID links to its file, as in the built-in views.

import { count, cut, esc, fileLink } from './html.mjs';
import { fewestCrossings } from './layout.mjs';

/**
 * @typedef {import('./panels.mjs').ViewsModel} ViewsModel
 * @typedef {import('./panels.mjs').ResolvedPanel} ResolvedPanel
 * @typedef {import('./work.mjs').WorkModel} WorkModel
 * @typedef {Record<string, any>} Item
 */

/** The longest value a cell shows. */
const CELL_MAX = 200;
/** The longest title a list shows. */
const TITLE_MAX = 120;
/** The longest label a picture shows. */
const LABEL_MAX = 24;
/** The most rows a timeline's picture draws; its list has every entry. */
const TIMELINE_ROWS = 60;

/** The CSS the panels add to the page, only when a project has panels. */
export const PANELS_CSS = `.pn{margin:1.5rem 0 2rem}.pn h3{font-size:1rem;margin:0 0 .25rem}.pn-refused{border-left-color:var(--stop);background:var(--stop-bg)}
.pn-board{display:flex;gap:.75rem;overflow-x:auto;align-items:flex-start}.pn-col{flex:1 0 12rem;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.5rem .6rem}.pn-col h4{font-size:.9rem;margin:0 0 .25rem}.pn-col ul{list-style:none;padding:0}.pn-col li{padding:.2rem 0;border-bottom:1px solid var(--line);font-size:.9rem}
svg.pn-svg{display:block;width:100%;max-width:720px;height:auto;font:11px system-ui,sans-serif}.pn-svg text{fill:var(--muted)}.pn-line{fill:none;stroke:var(--used);stroke-width:2}.pn-dot{fill:var(--used)}.pn-axis{stroke:var(--line)}.pn-node rect{fill:var(--card);stroke:var(--mark)}.pn-node text{fill:var(--fg)}.pn-edge{stroke:var(--mark);fill:none}.pn-span{fill:var(--used)}
svg.pn-bar{display:block;width:12rem;height:.8rem}table.pn-table{min-width:0}.pn caption{text-align:left}`;

/** A value as text: none as a dash, a list joined, true and false as yes and no. @param {unknown} v @returns {string} */
export function valueText(v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/** A group's name: none as "(none)". @param {unknown} v */
const groupName = (v) => (v == null ? '(none)' : valueText(v));

/** One filter in words. @param {Record<string, any>} w */
function filterText(w) {
  const [test, v] = /** @type {[string, any]} */ (Object.entries(w).find(([k]) => k !== 'field'));
  const list = () => (Array.isArray(v) ? v : [v]).map(valueText).join(' or ');
  const said =
    test === 'is'
      ? `is ${valueText(v)}`
      : test === 'not'
        ? `is not ${valueText(v)}`
        : test === 'in'
          ? `is ${list()}`
          : test === 'not_in'
            ? `is not ${list()}`
            : test === 'set'
              ? v
                ? 'is set'
                : 'is not set'
              : `is ${test === 'at_least' ? 'at least' : 'at most'} ${valueText(v)}`;
  return `${w.field} ${said}`;
}

/** What a panel holds, in a sentence. @param {ResolvedPanel} p */
function holds(p) {
  const where = p.where.length ? ` where ${p.where.map(filterText).join(', and ')}` : '';
  return `${count(p.matched, 'item')}${where}.`;
}

/**
 * The page's tab of the project's panels: a heading named by the project, the panels in order, and
 * any panel views.json declares that was refused, with why.
 * @param {ViewsModel} v @param {WorkModel | null} work
 * @param {{ fileBase?: string | null }} [where]
 */
export function renderPanelsView(v, work, { fileBase = null } = {}) {
  /** @type {Map<string, Item>} */
  const items = new Map((work?.items ?? []).map((it) => [String(it.id), it]));
  /** An item's ID, linked to its file. @param {string} id */
  const link = (id) => fileLink(id, items.get(id)?.path, fileBase);
  /** An item's ID, linked to its file, and its title. @param {string} id */
  const label = (id) => `${link(id)} ${esc(cut(String(items.get(id)?.title ?? id), TITLE_MAX))}`;
  const refused = v.errors.length
    ? `<div class="status pn-refused" role="alert"><strong>${v.errors.some((e) => e.panel === null) ? 'views.json is refused: no panel is shown' : `${count(new Set(v.errors.map((e) => e.panel)).size, 'panel')} refused`}</strong><ul>${v.errors
        .map((e) => `<li>${esc(e.message)} <small>at ${esc(e.path)}</small></li>`)
        .join('')}</ul><small>Run hitld check views for the same list.</small></div>`
    : '';
  const panels = v.panels.map((p) => renderPanel(p, label, link)).join('\n');
  return `<h2>${esc(v.title)}</h2>
<p class="meta">The project's own panels, declared in ${esc(v.path)}: ${count(v.panels.length, 'panel')}.</p>
${refused}
${panels}`;
}

/**
 * One panel.
 * @param {ResolvedPanel} p @param {(id: string) => string} label @param {(id: string) => string} link
 */
function renderPanel(p, label, link) {
  const h = `pn-${esc(p.id)}`;
  const body =
    p.type === 'table'
      ? table(/** @type {any} */ (p), link)
      : p.type === 'board'
        ? board(/** @type {any} */ (p), label)
        : p.type === 'bar'
          ? bar(/** @type {any} */ (p))
          : p.type === 'line'
            ? line(/** @type {any} */ (p))
            : p.type === 'timeline'
              ? timeline(/** @type {any} */ (p), label)
              : graph(/** @type {any} */ (p), label);
  return `<section class="pn pn-is-${esc(p.type)}" id="${h}" aria-labelledby="${h}-h">
<h3 id="${h}-h">${esc(p.title)}</h3>
<p class="meta">${p.description ? `${esc(p.description)} ` : ''}${esc(holds(p))}</p>
${body}
</section>`;
}

/** "and 3 more not shown", or nothing. @param {number} n */
const more = (n) => (n ? `<p class="meta">And ${count(n, 'more item')} not shown.</p>` : '');

/** @param {{ columns: string[], rows: { id: string, cells: unknown[] }[], more: number, sort: string, order: string }} p @param {(id: string) => string} link */
function table(p, link) {
  if (!p.rows.length) return '<p>No item matches.</p>';
  const head = p.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('');
  const rows = p.rows
    .map(
      (r) =>
        `<tr><th scope="row">${link(r.id)}</th>${r.cells.map((c) => `<td>${esc(cut(valueText(c), CELL_MAX))}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<div class="wrap"><table class="pn-table"><caption class="meta">By ${esc(p.sort)}, ${esc(p.order)}.</caption><thead><tr><th scope="col">ID</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more(p.more)}`;
}

/** @param {{ group_by: string, columns: { value: unknown, ids: string[], more: number }[] }} p @param {(id: string) => string} label */
function board(p, label) {
  if (!p.columns.length) return '<p>No item matches.</p>';
  const cols = p.columns
    .map(
      (c) =>
        `<section class="pn-col"><h4>${esc(cut(groupName(c.value), LABEL_MAX * 2))} <span class="num">${c.ids.length + c.more}</span></h4>${
          c.ids.length
            ? `<ul>${c.ids.map((id) => `<li>${label(id)}</li>`).join('')}</ul>`
            : '<p class="meta">None.</p>'
        }${more(c.more)}</section>`,
    )
    .join('');
  return `<p class="meta">Columns by ${esc(p.group_by)}.</p><div class="pn-board">${cols}</div>`;
}

/** @param {{ group_by: string, bars: { value: unknown, count: number }[] }} p */
function bar(p) {
  if (!p.bars.length) return '<p>No item matches.</p>';
  const most = Math.max(1, ...p.bars.map((b) => b.count));
  const rows = p.bars
    .map((b) => {
      const w = Math.round((b.count / most) * 200);
      return `<tr><th scope="row">${esc(cut(groupName(b.value), CELL_MAX))}</th><td>${b.count}</td><td><svg class="pn-bar" aria-hidden="true" viewBox="0 0 200 10" preserveAspectRatio="none"><rect class="track" width="200" height="10"/><rect class="used" width="${w}" height="10"/></svg></td></tr>`;
    })
    .join('');
  return `<div class="wrap"><table class="pn-table"><thead><tr><th scope="col">${esc(p.group_by)}</th><th scope="col">Items</th><th scope="col"><span class="meta">Bar</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** @param {{ date: string, interval: string, cumulative: boolean, points: { at: string, count: number }[], undated: number, cut: number }} p */
function line(p) {
  const notes = [
    p.undated ? `${count(p.undated, 'item')} with no ${p.date} date not counted.` : '',
    p.cut ? `The first ${count(p.cut, p.interval)} are left out.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!p.points.length) {
    return `<p>No item has a ${esc(p.date)} date.</p>${notes ? `<p class="meta">${esc(notes)}</p>` : ''}`;
  }
  const W = 720;
  const H = 200;
  const L = 36;
  const B = 22;
  const T = 10;
  const most = Math.max(1, ...p.points.map((x) => x.count));
  const step = p.points.length > 1 ? (W - L - 10) / (p.points.length - 1) : 0;
  const xy = p.points.map((x, i) => [
    (L + i * step).toFixed(1),
    (T + (H - B - T) * (1 - x.count / most)).toFixed(1),
  ]);
  const peak = p.points.reduce((a, b) => (b.count > a.count ? b : a));
  const latest = /** @type {{ at: string, count: number }} */ (p.points.at(-1));
  const what = p.cumulative
    ? `items with a ${p.date} date up to each ${p.interval}`
    : `items by ${p.date}, per ${p.interval}`;
  const svg = `<svg class="pn-svg" aria-hidden="true" viewBox="0 0 ${W} ${H}"><line class="pn-axis" x1="${L}" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="#999"/><text x="2" y="${T + 8}">${most}</text><text x="2" y="${H - B}">0</text><text x="${L}" y="${H - 6}">${esc(p.points[0].at)}</text><text x="${W - 70}" y="${H - 6}">${esc(latest.at)}</text><polyline class="pn-line" fill="none" stroke="#2f6fb3" points="${xy.map((x) => x.join(',')).join(' ')}"/>${xy.length <= 60 ? xy.map(([x, y]) => `<circle class="pn-dot" cx="${x}" cy="${y}" r="2.5"/>`).join('') : ''}</svg>`;
  const rows = p.points
    .map((x) => `<tr><th scope="row">${esc(x.at)}</th><td>${x.count}</td></tr>`)
    .join('');
  return `<p>${esc(`The count of ${what}, from ${p.points[0].at} to ${latest.at}: highest ${peak.count} (${p.interval} of ${peak.at}), latest ${latest.count}.`)}</p>
${svg}
<details><summary>The counts as a table</summary><div class="wrap"><table class="pn-table"><thead><tr><th scope="col">${esc(p.interval)} from</th><th scope="col">Items</th></tr></thead><tbody>${rows}</tbody></table></div></details>${notes ? `<p class="meta">${esc(notes)}</p>` : ''}`;
}

/** Days between two dates. @param {string} a @param {string} b */
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** @param {{ date: string, end: string | null, entries: { id: string, start: string, end: string | null }[], undated: number, more: number }} p @param {(id: string) => string} label */
function timeline(p, label) {
  const undated = p.undated
    ? `<p class="meta">${count(p.undated, 'item')} with no ${esc(p.date)} date not placed.</p>`
    : '';
  if (!p.entries.length) return `<p>No item has a ${esc(p.date)} date.</p>${undated}`;
  const first = p.entries[0].start;
  const last = p.entries.reduce((m, e) => ((e.end ?? e.start) > m ? (e.end ?? e.start) : m), first);
  const span = Math.max(1, daysBetween(first, last));
  const drawn = p.entries.slice(0, TIMELINE_ROWS);
  const W = 720;
  const L = 70;
  const R = 12;
  const ROW = 14;
  const H = 24 + drawn.length * ROW;
  const x = (/** @type {string} */ d) =>
    (L + ((W - L - R) * daysBetween(first, d)) / span).toFixed(1);
  const marks = drawn
    .map((e, i) => {
      const y = 18 + i * ROW;
      const x1 = x(e.start);
      const w = e.end ? Math.max(3, Number(x(e.end)) - Number(x1)).toFixed(1) : '6';
      return `<text x="2" y="${y + 9}">${esc(cut(e.id, 10))}</text><rect class="pn-span" x="${x1}" y="${y}" width="${w}" height="10" rx="2"/>`;
    })
    .join('');
  const svg = `<svg class="pn-svg" aria-hidden="true" viewBox="0 0 ${W} ${H}"><text x="${L}" y="10">${esc(first)}</text><text x="${W - 70}" y="10">${esc(last)}</text><line class="pn-axis" x1="${L}" y1="14" x2="${W - R}" y2="14" stroke="#999"/>${marks}</svg>`;
  const list = p.entries
    .map(
      (e) =>
        `<li><time datetime="${esc(e.start)}">${esc(e.start)}</time>${e.end ? ` to <time datetime="${esc(e.end)}">${esc(e.end)}</time>` : ''}: ${label(e.id)}</li>`,
    )
    .join('');
  return `${svg}${drawn.length < p.entries.length ? `<p class="meta">The picture shows the first ${drawn.length}; the list has all.</p>` : ''}
<ol class="pn-list">${list}</ol>${more(p.more)}${undated}`;
}

/** @param {{ relation: string, nodes: string[], edges: [string, string][], outside: number, more: number }} p @param {(id: string) => string} label */
function graph(p, label) {
  if (!p.nodes.length) return '<p>No item matches.</p>';
  const { groups, grid } = fewestCrossings(p.nodes, p.edges);
  const BW = 150;
  const BH = 24;
  const CW = 190;
  const RH = 34;
  /** @type {Map<string, [number, number]>} */
  const at = new Map();
  let top = 8;
  let width = 0;
  for (const g of groups) {
    const rows = Math.max(...g.layers.map((l) => l.length));
    for (const [c, col] of g.layers.entries()) {
      for (const [r, id] of col.entries()) at.set(id, [8 + c * CW, top + r * RH]);
    }
    width = Math.max(width, 8 + g.layers.length * CW);
    top += rows * RH + 12;
  }
  const perRow = 4;
  for (const [k, id] of grid.entries()) {
    at.set(id, [8 + (k % perRow) * CW, top + Math.floor(k / perRow) * RH]);
  }
  if (grid.length) top += Math.ceil(grid.length / perRow) * RH;
  width = Math.max(width, 8 + Math.min(grid.length, perRow) * CW);
  const edges = p.edges
    .filter(([a, b]) => at.has(a) && at.has(b))
    .map(([a, b]) => {
      const [ax, ay] = /** @type {[number, number]} */ (at.get(a));
      const [bx, by] = /** @type {[number, number]} */ (at.get(b));
      return `<path class="pn-edge" fill="none" stroke="#888" d="M${ax + BW} ${ay + BH / 2} C${ax + BW + 20} ${ay + BH / 2} ${bx - 20} ${by + BH / 2} ${bx} ${by + BH / 2}"/><circle class="pn-dot" cx="${bx}" cy="${by + BH / 2}" r="2.5"/>`;
    })
    .join('');
  const nodes = [...at]
    .map(
      ([id, [x, y]]) =>
        `<g class="pn-node"><rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="4" fill="none" stroke="#888"/><text x="${x + 6}" y="${y + 16}">${esc(cut(id, LABEL_MAX))}</text></g>`,
    )
    .join('');
  const svg = `<svg class="pn-svg" aria-hidden="true" viewBox="0 0 ${Math.max(width, 200)} ${Math.max(top, 40)}">${edges}${nodes}</svg>`;
  /** @type {Map<string, string[]>} */
  const into = new Map();
  for (const [a, b] of p.edges) into.set(b, [...(into.get(b) ?? []), a]);
  const list = p.nodes
    .map((id) => {
      const links = into.get(id) ?? [];
      return `<li>${label(id)}${links.length ? `; ${esc(p.relation)}: ${links.map(esc).join(', ')}` : ''}</li>`;
    })
    .join('');
  const notes = [
    p.outside ? `${count(p.outside, 'link')} to items outside the panel not drawn.` : '',
    p.more ? `${count(p.more, 'more item')} not drawn.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<p class="meta">Each item, and the items it links to by ${esc(p.relation)}; a line runs from the item linked to.</p>${svg}<ul class="pn-list">${list}</ul>${notes ? `<p class="meta">${esc(notes)}</p>` : ''}`;
}
