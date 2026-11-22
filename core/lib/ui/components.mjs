// The React components for the six panel types (HITLD-729, decisions HITLD-720, 721 and 726),
// drawn from the dashboard data contract: the same panels on HITLD's page and in a project's own
// app. Each draws what core/lib/dashboard/panels-html.mjs draws with no script, with the same
// classes, so the page's styles and THEME_CSS apply: a heading, a sentence saying what it holds,
// its content as a table or a list that reads without CSS, and a chart's picture hidden from
// screen readers beside that text. Every value is text: nothing a project supplies becomes markup
// or a link, and no component sets HTML. Written with createElement, not JSX, so a project's app
// imports these files as they are, with no build step for them.
//
// A project's app registers its own panel types in a registry (createRegistry) and passes it to
// HitldRoot; a panel whose type nothing registers says so by name, never draws empty.

import { Component, createContext, createElement as h, useContext, useMemo } from 'react';
import { fewestCrossings } from '../dashboard/layout.mjs';
import { fileHref, itemsById } from './client.mjs';
import { ContractProvider, useContract, useFileBase, useReadStamp } from './hooks.mjs';
import { themeStyle } from './theme.mjs';
import {
  CELL_MAX,
  LABEL_MAX,
  TIMELINE_ROWS,
  TITLE_MAX,
  count,
  cut,
  daysBetween,
  groupName,
  holds,
  moreText,
  valueText,
} from './text.mjs';

/**
 * @typedef {import('react').ReactNode} Node
 * @typedef {import('./client.mjs').Contract} Contract
 * @typedef {import('./client.mjs').AnyPanel} AnyPanel
 * @typedef {import('./client.mjs').TablePanel} TablePanel
 * @typedef {import('./client.mjs').BoardPanel} BoardPanel
 * @typedef {import('./client.mjs').BarPanel} BarPanel
 * @typedef {import('./client.mjs').LinePanel} LinePanel
 * @typedef {import('./client.mjs').TimelinePanel} TimelinePanel
 * @typedef {import('./client.mjs').GraphPanel} GraphPanel
 * @typedef {import('./client.mjs').Views} Views
 * @typedef {import('./theme.mjs').Theme} Theme
 * @typedef {(props: { panel: any }) => Node} PanelComponent a panel type's component: it gets
 *   the panel and reads the rest with the hooks
 */

/** An item's ID, linked to its file when the contract has its path. @param {{ id: string }} props */
export function ItemLink({ id }) {
  const it = itemsById(useContract()).get(id);
  const base = useFileBase();
  return it?.path ? h('a', { className: 'file', href: fileHref(it.path, base) }, id) : id;
}

/** An item's ID, linked to its file, and its title. @param {{ id: string }} props */
export function ItemLabel({ id }) {
  const it = itemsById(useContract()).get(id);
  return h('span', null, h(ItemLink, { id }), ' ', cut(String(it?.title ?? id), TITLE_MAX));
}

/** "And 3 more items not shown.", or nothing. @param {{ n: number }} props */
const More = ({ n }) => (n ? h('p', { className: 'meta' }, moreText(n)) : null);

/** @param {{ panel: TablePanel }} props */
export function TablePanelView({ panel: p }) {
  if (!p.rows.length) return h('p', null, 'No item matches.');
  return h(
    'div',
    null,
    h(
      'div',
      { className: 'wrap' },
      h(
        'table',
        { className: 'pn-table' },
        h('caption', { className: 'meta' }, `By ${p.sort}, ${p.order}.`),
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, 'ID'),
            p.columns.map((c, i) => h('th', { scope: 'col', key: i }, c)),
          ),
        ),
        h(
          'tbody',
          null,
          p.rows.map((r) =>
            h(
              'tr',
              { key: r.id },
              h('th', { scope: 'row' }, h(ItemLink, { id: r.id })),
              r.cells.map((c, i) => h('td', { key: i }, cut(valueText(c), CELL_MAX))),
            ),
          ),
        ),
      ),
    ),
    h(More, { n: p.more }),
  );
}

/** @param {{ panel: BoardPanel }} props */
export function BoardPanelView({ panel: p }) {
  if (!p.columns.length) return h('p', null, 'No item matches.');
  return h(
    'div',
    null,
    h('p', { className: 'meta' }, `Columns by ${p.group_by}.`),
    h(
      'div',
      { className: 'pn-board' },
      p.columns.map((c, k) =>
        h(
          'section',
          { className: 'pn-col', key: k },
          h(
            'h4',
            null,
            cut(groupName(c.value), LABEL_MAX * 2),
            ' ',
            h('span', { className: 'num' }, c.ids.length + c.more),
          ),
          c.ids.length
            ? h(
                'ul',
                null,
                c.ids.map((id) => h('li', { key: id }, h(ItemLabel, { id }))),
              )
            : h('p', { className: 'meta' }, 'None.'),
          h(More, { n: c.more }),
        ),
      ),
    ),
  );
}

/** @param {{ panel: BarPanel }} props */
export function BarPanelView({ panel: p }) {
  if (!p.bars.length) return h('p', null, 'No item matches.');
  const most = Math.max(1, ...p.bars.map((b) => b.count));
  return h(
    'div',
    { className: 'wrap' },
    h(
      'table',
      { className: 'pn-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, p.group_by),
          h('th', { scope: 'col' }, 'Items'),
          h('th', { scope: 'col' }, h('span', { className: 'meta' }, 'Bar')),
        ),
      ),
      h(
        'tbody',
        null,
        p.bars.map((b, k) =>
          h(
            'tr',
            { key: k },
            h('th', { scope: 'row' }, cut(groupName(b.value), CELL_MAX)),
            h('td', null, b.count),
            h(
              'td',
              null,
              h(
                'svg',
                {
                  className: 'pn-bar',
                  'aria-hidden': 'true',
                  viewBox: '0 0 200 10',
                  preserveAspectRatio: 'none',
                },
                h('rect', { className: 'track', width: 200, height: 10 }),
                h('rect', {
                  className: 'used',
                  width: Math.round((b.count / most) * 200),
                  height: 10,
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** @param {{ panel: LinePanel }} props */
export function LinePanelView({ panel: p }) {
  const notes = [
    p.undated ? `${count(p.undated, 'item')} with no ${p.date} date not counted.` : '',
    p.cut ? `The first ${count(p.cut, p.interval)} are left out.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const note = notes ? h('p', { className: 'meta' }, notes) : null;
  if (!p.points.length) return h('div', null, h('p', null, `No item has a ${p.date} date.`), note);
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
  return h(
    'div',
    null,
    h(
      'p',
      null,
      `The count of ${what}, from ${p.points[0].at} to ${latest.at}: highest ${peak.count} (${p.interval} of ${peak.at}), latest ${latest.count}.`,
    ),
    h(
      'svg',
      { className: 'pn-svg', 'aria-hidden': 'true', viewBox: `0 0 ${W} ${H}` },
      h('line', { className: 'pn-axis', x1: L, y1: H - B, x2: W, y2: H - B }),
      h('text', { x: 2, y: T + 8 }, most),
      h('text', { x: 2, y: H - B }, 0),
      h('text', { x: L, y: H - 6 }, p.points[0].at),
      h('text', { x: W - 70, y: H - 6 }, latest.at),
      h('polyline', { className: 'pn-line', points: xy.map((x) => x.join(',')).join(' ') }),
      xy.length <= 60
        ? xy.map(([x, y], i) => h('circle', { className: 'pn-dot', cx: x, cy: y, r: 2.5, key: i }))
        : null,
    ),
    h(
      'details',
      null,
      h('summary', null, 'The counts as a table'),
      h(
        'div',
        { className: 'wrap' },
        h(
          'table',
          { className: 'pn-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, `${p.interval} from`),
              h('th', { scope: 'col' }, 'Items'),
            ),
          ),
          h(
            'tbody',
            null,
            p.points.map((x) =>
              h('tr', { key: x.at }, h('th', { scope: 'row' }, x.at), h('td', null, x.count)),
            ),
          ),
        ),
      ),
    ),
    note,
  );
}

/** @param {{ panel: TimelinePanel }} props */
export function TimelinePanelView({ panel: p }) {
  const undated = p.undated
    ? h(
        'p',
        { className: 'meta' },
        `${count(p.undated, 'item')} with no ${p.date} date not placed.`,
      )
    : null;
  if (!p.entries.length) {
    return h('div', null, h('p', null, `No item has a ${p.date} date.`), undated);
  }
  const first = p.entries[0].start;
  const last = p.entries.reduce((m, e) => ((e.end ?? e.start) > m ? (e.end ?? e.start) : m), first);
  const span = Math.max(1, daysBetween(first, last));
  const drawn = p.entries.slice(0, TIMELINE_ROWS);
  const W = 720;
  const L = 70;
  const R = 12;
  const ROW = 14;
  const H = 24 + drawn.length * ROW;
  const x = (/** @type {string} */ d) => L + ((W - L - R) * daysBetween(first, d)) / span;
  return h(
    'div',
    null,
    h(
      'svg',
      { className: 'pn-svg', 'aria-hidden': 'true', viewBox: `0 0 ${W} ${H}` },
      h('text', { x: L, y: 10 }, first),
      h('text', { x: W - 70, y: 10 }, last),
      h('line', { className: 'pn-axis', x1: L, y1: 14, x2: W - R, y2: 14 }),
      drawn.map((e, i) => {
        const y = 18 + i * ROW;
        const x1 = x(e.start);
        const w = e.end ? Math.max(3, x(e.end) - x1) : 6;
        return h(
          'g',
          { key: `${e.id}-${i}` },
          h('text', { x: 2, y: y + 9 }, cut(e.id, 10)),
          h('rect', {
            className: 'pn-span',
            x: x1.toFixed(1),
            y,
            width: w.toFixed(1),
            height: 10,
            rx: 2,
          }),
        );
      }),
    ),
    drawn.length < p.entries.length
      ? h(
          'p',
          { className: 'meta' },
          `The picture shows the first ${drawn.length}; the list has all.`,
        )
      : null,
    h(
      'ol',
      { className: 'pn-list' },
      p.entries.map((e, i) =>
        h(
          'li',
          { key: `${e.id}-${i}` },
          h('time', { dateTime: e.start }, e.start),
          e.end ? [' to ', h('time', { dateTime: e.end, key: 'end' }, e.end)] : null,
          ': ',
          h(ItemLabel, { id: e.id }),
        ),
      ),
    ),
    h(More, { n: p.more }),
    undated,
  );
}

/** Where each node of a graph panel sits. @param {GraphPanel} p */
function graphLayout(p) {
  const { groups, grid } = fewestCrossings(p.nodes, p.edges);
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
  return { at, width: Math.max(width, 200), height: Math.max(top, 40) };
}

/** @param {{ panel: GraphPanel }} props */
export function GraphPanelView({ panel: p }) {
  const layout = useMemo(() => (p.nodes.length ? graphLayout(p) : null), [p]);
  if (!layout) return h('p', null, 'No item matches.');
  const { at, width, height } = layout;
  const BW = 150;
  const BH = 24;
  /** @type {Map<string, string[]>} */
  const into = new Map();
  for (const [a, b] of p.edges) into.set(b, [...(into.get(b) ?? []), a]);
  const notes = [
    p.outside ? `${count(p.outside, 'link')} to items outside the panel not drawn.` : '',
    p.more ? `${count(p.more, 'more item')} not drawn.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return h(
    'div',
    null,
    h(
      'p',
      { className: 'meta' },
      `Each item, and the items it links to by ${p.relation}; a line runs from the item linked to.`,
    ),
    h(
      'svg',
      { className: 'pn-svg', 'aria-hidden': 'true', viewBox: `0 0 ${width} ${height}` },
      p.edges
        .filter(([a, b]) => at.has(a) && at.has(b))
        .map(([a, b]) => {
          const [ax, ay] = /** @type {[number, number]} */ (at.get(a));
          const [bx, by] = /** @type {[number, number]} */ (at.get(b));
          return h(
            'g',
            { key: `${a}>${b}` },
            h('path', {
              className: 'pn-edge',
              d: `M${ax + BW} ${ay + BH / 2} C${ax + BW + 20} ${ay + BH / 2} ${bx - 20} ${by + BH / 2} ${bx} ${by + BH / 2}`,
            }),
            h('circle', { className: 'pn-dot', cx: bx, cy: by + BH / 2, r: 2.5 }),
          );
        }),
      [...at].map(([id, [x, y]]) =>
        h(
          'g',
          { className: 'pn-node', key: id },
          h('rect', { x, y, width: BW, height: BH, rx: 4 }),
          h('text', { x: x + 6, y: y + 16 }, cut(id, LABEL_MAX)),
        ),
      ),
    ),
    h(
      'ul',
      { className: 'pn-list' },
      p.nodes.map((id) => {
        const links = into.get(id) ?? [];
        return h(
          'li',
          { key: id },
          h(ItemLabel, { id }),
          links.length ? `; ${p.relation}: ${links.join(', ')}` : null,
        );
      }),
    ),
    notes ? h('p', { className: 'meta' }, notes) : null,
  );
}

/** The six panel types (decision HITLD-685) and their components. */
export const BUILTIN_PANELS = Object.freeze({
  table: /** @type {PanelComponent} */ (TablePanelView),
  board: /** @type {PanelComponent} */ (BoardPanelView),
  bar: /** @type {PanelComponent} */ (BarPanelView),
  line: /** @type {PanelComponent} */ (LinePanelView),
  timeline: /** @type {PanelComponent} */ (TimelinePanelView),
  graph: /** @type {PanelComponent} */ (GraphPanelView),
});

/** A panel type's name: lowercase, with hyphens. */
const TYPE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * @typedef {object} Registry the panel types a page or an app draws
 * @property {(type: string) => PanelComponent | null} get
 * @property {() => string[]} types the built-in types first, then the project's own
 */

/**
 * A registry of panel types: the six built-in ones and a project's own. A project's type may not
 * take a built-in type's name or an odd one; either is refused by name.
 * @param {Record<string, PanelComponent>} [custom] @returns {Registry}
 */
export function createRegistry(custom = {}) {
  /** @type {Map<string, PanelComponent>} */
  const all = new Map(Object.entries(BUILTIN_PANELS));
  for (const [type, component] of Object.entries(custom)) {
    if (Object.hasOwn(BUILTIN_PANELS, type)) {
      throw new TypeError(
        `panel type "${type}" is built in; give the project's own type a new name`,
      );
    }
    if (!TYPE_NAME.test(type)) {
      throw new TypeError(
        `panel type "${type}" is not a name: lowercase letters, digits and hyphens`,
      );
    }
    if (typeof component !== 'function') {
      throw new TypeError(`panel type "${type}" needs a component`);
    }
    all.set(type, component);
  }
  return Object.freeze({ get: (type) => all.get(type) ?? null, types: () => [...all.keys()] });
}

/** The registry the components below read; the built-in types alone by default. */
export const RegistryContext = createContext(createRegistry());

/** A panel that failed to draw, named, with why. @param {{ panel: AnyPanel, message: string }} props */
function Refused({ panel, message }) {
  return h(
    'div',
    { className: 'status pn-refused', role: 'alert' },
    h('strong', null, `Panel "${panel.id}" is not shown`),
    message,
  );
}

/**
 * Keeps one panel's failure inside it: the panel says why, and the rest of the page draws.
 * @extends {Component<{ panel: AnyPanel, children?: Node }, { error: Error | null }>}
 */
class PanelBoundary extends Component {
  /** @param {{ panel: AnyPanel, children?: Node }} props */
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  /** @param {unknown} error */
  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  render() {
    const error = /** @type {Error | null} */ (this.state.error);
    return error
      ? h(Refused, { panel: this.props.panel, message: error.message })
      : this.props.children;
  }
}

/**
 * One panel: its heading, what it holds, and its type's component from the registry.
 * @param {{ panel: AnyPanel }} props
 */
export function Panel({ panel: p }) {
  const registry = useContext(RegistryContext);
  const View = registry.get(p.type);
  const id = `pn-${p.id}`;
  return h(
    'section',
    { className: `pn pn-is-${p.type}`, id, 'aria-labelledby': `${id}-h` },
    h('h3', { id: `${id}-h` }, p.title),
    h(
      'p',
      { className: 'meta' },
      p.description ? `${p.description} ` : '',
      Array.isArray(p.where) && typeof p.matched === 'number' ? holds(p) : null,
    ),
    View
      ? h(PanelBoundary, { panel: p }, h(View, { panel: p }))
      : h(Refused, {
          panel: p,
          message: `no panel type "${p.type}" is registered (${registry.types().join(', ')})`,
        }),
  );
}

/**
 * The project's panels as HITLD's page shows them in their tab: the title views.json gives, the
 * panels in order, and any panel that was refused, with why. Extra panels (a project's own types,
 * from its app) follow the declared ones.
 * @param {{ views?: Views | null, extra?: AnyPanel[] }} props
 */
export function PanelsView({ views, extra = [] }) {
  const c = useContract();
  const v = views === undefined ? c.views : views;
  if (!v && !extra.length) return null;
  const errors = v?.errors ?? [];
  const panels = [...(v?.panels ?? []), ...extra];
  return h(
    'div',
    { className: 'pn-view' },
    v ? h('h2', null, v.title) : null,
    v
      ? h(
          'p',
          { className: 'meta' },
          `The project's own panels, declared in ${v.path}: ${count(v.panels.length, 'panel')}.`,
        )
      : null,
    errors.length
      ? h(
          'div',
          { className: 'status pn-refused', role: 'alert' },
          h(
            'strong',
            null,
            errors.some((e) => e.panel === null)
              ? 'views.json is refused: no panel is shown'
              : `${count(new Set(errors.map((e) => e.panel)).size, 'panel')} refused`,
          ),
          h(
            'ul',
            null,
            errors.map((e, i) =>
              h('li', { key: i }, e.message, ' ', h('small', null, `at ${e.path}`)),
            ),
          ),
          h('small', null, 'Run hitld check views for the same list.'),
        )
      : null,
    panels.map((p) => h(Panel, { panel: p, key: p.id })),
  );
}

/** The line saying when and where the data was read. */
export function ReadStamp() {
  return h('span', { className: 'hitld-read' }, useReadStamp().text);
}

/**
 * The root of a project's own app, or of a part of HITLD's page: the contract for the hooks, the
 * panel types it draws, and the theme variables it sets. With `bare`, no wrapping element: the
 * page's own styles apply.
 * @param {{ contract: Contract, fileBase?: string | null, registry?: Registry, theme?: Theme, bare?: boolean, className?: string, children?: Node }} props
 */
export function HitldRoot({
  contract,
  fileBase = null,
  registry,
  theme,
  bare = false,
  className,
  children,
}) {
  const style = useMemo(() => (theme ? themeStyle(theme) : undefined), [theme]);
  const inner = registry ? h(RegistryContext.Provider, { value: registry }, children) : children;
  return h(
    ContractProvider,
    { contract, fileBase },
    bare
      ? inner
      : h('div', { className: className ? `hitld ${className}` : 'hitld', style }, inner),
  );
}

/**
 * The whole kit in one: the read line and the project's panels, in a themed root. A project's app
 * that wants no more uses this alone.
 * @param {{ contract: Contract, fileBase?: string | null, registry?: Registry, theme?: Theme, extra?: AnyPanel[] }} props
 */
export function Dashboard({ contract, fileBase = null, registry, theme, extra = [] }) {
  return h(
    HitldRoot,
    { contract, fileBase, registry, theme },
    h('p', { className: 'meta' }, h(ReadStamp)),
    h(PanelsView, { extra }),
  );
}
