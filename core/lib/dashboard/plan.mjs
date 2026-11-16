// The plan: the item dependency graph as inline SVG (design part 12.1.3, HITLD-152). Items are
// nodes in their stage's color, `needs` are edges, lanes are projects, columns are steps by longest
// path, and the order within a lane is the barycenter layout of layout.mjs, so edges cross as
// little as the lanes allow. The critical path and the ready items are marked. Each node links to
// its item file; a text list of the same nodes sits under the graph for a screen reader. A graph
// past the size setting is cut by project; the full graph stays in work/views/items-graph.md.

import { STATE_LABELS } from '../tracker/files/format.mjs';
import { acyclic, longestPathLayers, reduceCrossings } from './layout.mjs';
import { count, cut, esc, fileLink } from './html.mjs';
import { fileHref } from '../tracker/files/views.mjs';

/** @typedef {import('./work.mjs').WorkItem} WorkItem */

/** Each stage's name, as the legend and the lists say it. */
export const STAGE_NAMES = /** @type {Record<string, string>} */ ({
  proposed: 'Proposed',
  blocked: 'Blocked',
  ready: 'Ready',
  'in-progress': 'In progress',
  done: 'Done',
  dropped: 'Dropped',
});

/**
 * Which items the plan draws: those in `states`, then whole projects in ID order (items with no
 * project last) while the count stays within `max`. The first project is always drawn.
 * @param {import('./work.mjs').WorkModel} w
 * @param {{ dashboard_plan_states?: string[], dashboard_plan_max_items?: number }} settings
 */
export function planCut(w, settings = {}) {
  const states = settings.dashboard_plan_states ?? ['planned', 'in-progress'];
  const max = settings.dashboard_plan_max_items ?? 150;
  const wanted = w.items.filter((it) => states.includes(it.state));
  /** @type {{ id: string | null, title: string, items: WorkItem[] }[]} */
  const lanes = [
    ...w.projects.map((p) => ({
      id: /** @type {string | null} */ (p.id),
      title: p.title,
      items: wanted.filter((it) => it.project === p.id),
    })),
    {
      id: null,
      title: 'No project',
      items: wanted.filter((it) => !it.project || !w.projects.some((p) => p.id === it.project)),
    },
  ].filter((l) => l.items.length);
  const drawn = [];
  const left = [];
  let n = 0;
  for (const lane of lanes) {
    if (drawn.length && n + lane.items.length > max) left.push(lane);
    else {
      drawn.push(lane);
      n += lane.items.length;
    }
  }
  return { states, max, lanes: drawn, left };
}

/**
 * @param {import('./work.mjs').WorkModel} w
 * @param {{ dashboard_plan_states?: string[], dashboard_plan_max_items?: number }} settings
 * @param {{ fileBase?: string | null }} [where]
 */
export function renderPlan(w, settings, { fileBase = null } = {}) {
  const { states, max, lanes, left } = planCut(w, settings);
  const shown = lanes.flatMap((l) => l.items);
  const ids = shown.map((it) => it.id);
  const byId = new Map(shown.map((it) => [it.id, it]));
  const edges = acyclic(
    ids,
    shown.flatMap((it) => it.needs.map((n) => /** @type {[string, string]} */ ([n, it.id]))),
  );
  const linked = new Set(edges.flat());
  const laneOf = new Map(lanes.flatMap((l, k) => l.items.map((it) => [it.id, k])));
  const layerOf = longestPathLayers(ids, edges);
  const { layers, crossings } = reduceCrossings(layerOf, edges, {
    groupOf: (id) => /** @type {number} */ (laneOf.get(id)),
  });
  const statesText = states.map((s) => (STATE_LABELS[s] ?? s).toLowerCase()).join(', ');
  const head = `<h2 id="plan-graph">The plan</h2>
<p class="muted">Items ${esc(statesText)}, with what each needs; ${count(shown.length, 'item')} in ${count(lanes.length, 'project')}, over ${count(layers.length, 'step')}. ${w.critical_path.length ? `Critical path: ${w.critical_path.map(esc).join(' → ')}.` : 'No critical path: no open items.'} Each item links to its file. The full graph, done items included, is in work/views/items-graph.md.</p>`;
  if (!shown.length) return `${head}\n<p class="muted">No items in these states.</p>`;

  const LABEL = 140;
  const W = 200;
  const H = 46;
  const GX = 52;
  const GY = 8;
  const PAD = 10;
  const HEAD = 24;
  const colX = (/** @type {number} */ l) => LABEL + GX / 2 + l * (W + GX);
  /** @type {Map<string, { x: number, y: number }>} */
  const at = new Map();
  const laneBoxes = [];
  /** @type {number[]} where a lane's unlinked grid starts */
  const separators = [];
  let top = HEAD;
  for (const [k, lane] of lanes.entries()) {
    // Linked items by step; then the lane's unlinked items in a grid across the steps, so a lane
    // with many lone items stays short.
    let most = 0;
    for (const [l, col] of layers.entries()) {
      const own = col.filter((id) => laneOf.get(id) === k && linked.has(id));
      most = Math.max(most, own.length);
      for (const [r, id] of own.entries()) at.set(id, { x: colX(l), y: top + PAD + r * (H + GY) });
    }
    const lone = lane.items.filter((it) => !linked.has(it.id));
    const cols = Math.max(1, layers.length);
    for (const [n, it] of lone.entries()) {
      at.set(it.id, {
        x: colX(n % cols),
        y: top + PAD + (most + Math.floor(n / cols)) * (H + GY) + (most ? GY : 0),
      });
    }
    if (most && lone.length) separators.push(top + PAD + most * (H + GY));
    const rows = most + Math.ceil(lone.length / cols);
    const height = PAD * 2 + rows * H + (rows - 1) * GY + (most && lone.length ? GY : 0);
    laneBoxes.push({ lane, top, height });
    top += height;
  }
  const width = colX(layers.length) - GX / 2;
  const height = top;
  const onPath = new Set(w.critical_path.slice(1).map((id, k) => `${w.critical_path[k]}>${id}`));
  const laneSvg = laneBoxes
    .map(
      ({ lane, top: y, height: h }, k) =>
        `<rect class="mg-lane${k % 2 ? ' zebra' : ''}" x="0" y="${y}" width="${width}" height="${h}"/><text class="mg-lane-name pg-lane" x="8" y="${y + PAD + 12}">${esc(cut(lane.id ? `${lane.id} ${lane.title}` : lane.title, 20))}</text>`,
    )
    .join('');
  const ticks = layers
    .map((_, l) => {
      const x = colX(l) - GX / 2;
      return `<text class="mg-step" x="${colX(l) + W / 2}" y="16" text-anchor="middle">Step ${l + 1}</text>${l ? `<line class="mg-tick" x1="${x}" x2="${x}" y1="${HEAD - 4}" y2="${height}"/>` : ''}`;
    })
    .join('');
  const sepSvg = separators
    .map(
      (y) =>
        `<line class="pg-sep" x1="${LABEL}" x2="${width}" y1="${y}" y2="${y}"/><text class="mg-step" x="8" y="${y + 18}">Not linked</text>`,
    )
    .join('');
  const edgeSvg = edges
    .map(([a, b]) => {
      const p = /** @type {{ x: number, y: number }} */ (at.get(a));
      const q = /** @type {{ x: number, y: number }} */ (at.get(b));
      const [x1, y1, x2, y2] = [p.x + W, p.y + H / 2, q.x, q.y + H / 2];
      const crit = onPath.has(`${a}>${b}`);
      const bend = Math.max(GX / 2, (x2 - x1) / 3);
      return `<g class="pg-wire${crit ? ' critical' : ''}" data-from="${esc(a)}" data-to="${esc(b)}"><title>${esc(`${b} needs ${a}`)}</title><path class="mg-edge${crit ? ' critical' : ''}" d="M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2 - 7} ${y2}"/><path class="mg-head${crit ? ' critical' : ''}" d="M${x2 - 8} ${y2 - 4}L${x2} ${y2}L${x2 - 8} ${y2 + 4}z"/></g>`;
    })
    .join('');
  const kindNote = (/** @type {WorkItem} */ it) =>
    it.kind === 'decision' ? ', a decision' : it.kind === 'external' ? ', an outside wait' : '';
  const nodeSvg = shown
    .map((it) => {
      const { x, y } = /** @type {{ x: number, y: number }} */ (at.get(it.id));
      const stage = STAGE_NAMES[it.stage] ?? it.stage;
      const label = `${it.id} ${it.title}: ${stage}${kindNote(it)}${it.critical ? ', on the critical path' : ''}${it.open_needs.length ? `; needs ${it.open_needs.join(', ')}` : ''}`;
      const inner = `<g class="pg-node st-${it.stage}${it.critical ? ' critical' : ''}"><title>${esc(label)}</title><rect class="pg-box" x="${x}" y="${y}" width="${W}" height="${H}" rx="6"/><rect class="pg-strip" x="${x + 1}" y="${y + 1}" width="4" height="${H - 2}" rx="2"/><text class="pg-id" x="${x + 12}" y="${y + 18}">${esc(it.id)}${it.kind === 'decision' ? ' ◆' : it.kind === 'external' ? ' ◇' : ''}</text><text class="pg-stage" x="${x + W - 8}" y="${y + 18}" text-anchor="end">${esc(stage)}</text><text class="pg-title" x="${x + 12}" y="${y + 36}">${esc(cut(it.title, 29))}</text></g>`;
      return it.path
        ? `<a href="${esc(fileHref(it.path, { base: fileBase }))}" data-item="${esc(it.id)}" aria-label="${esc(label)}">${inner}</a>`
        : `<g data-item="${esc(it.id)}" role="img" aria-label="${esc(label)}">${inner}</g>`;
    })
    .join('\n');
  const svg = `<svg class="mg pg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Item graph: ${shown.length} items in ${lanes.length} lanes over ${layers.length} steps, ${edges.length} needs between them, ${crossings} crossings">${laneSvg}${ticks}${sepSvg}${edgeSvg}\n${nodeSvg}</svg>`;
  const legend = `<div class="mg-legend">${['blocked', 'ready', 'in-progress', 'done']
    .filter((s) => s !== 'done' || states.includes('done'))
    .map((s) => `<span><i class="sw st-${s}"></i>${STAGE_NAMES[s]}</span>`)
    .join(
      '',
    )}${states.includes('proposed') ? `<span><i class="sw st-proposed"></i>Proposed</span>` : ''}<span><i class="sw critical"></i>Critical path</span><span>◆ a decision, ◇ an outside wait</span><span>An arrow points from what is needed to what needs it</span><span>Items linked to none drawn stand in a grid under their lane's linked items</span></div>`;
  const list = `<details class="plan-list"><summary>The same ${count(shown.length, 'item')} as a list</summary>${lanes
    .map(
      (l) =>
        `<h4>${esc(l.id ? `${l.id} ${l.title}` : l.title)}</h4><ul>${l.items
          .map(
            (it) =>
              `<li data-item="${esc(it.id)}">${fileLink(it.id, it.path, fileBase)} ${esc(it.title)}: ${esc(STAGE_NAMES[it.stage] ?? it.stage)}${kindNote(it)}${it.critical ? ', on the critical path' : ''}${it.needs.length ? `; needs ${it.needs.map((n) => `${esc(n)}${byId.has(n) || w.items.find((x) => x.id === n)?.state !== 'done' ? '' : ' (done)'}`).join(', ')}` : ''}</li>`,
          )
          .join('')}</ul>`,
    )
    .join('')}</details>`;
  const cutNote = left.length
    ? `<p class="muted">Cut at ${max} items by project (the setting reports.dashboard_plan_max_items). Not drawn: ${left.map((l) => esc(`${l.id ? `${l.id} ${l.title}` : l.title} (${count(l.items.length, 'item')})`)).join('; ')}.</p>`
    : '';
  return `${head}\n${legend}\n<div class="wrap">${svg}</div>\n${cutNote}${list}`;
}
