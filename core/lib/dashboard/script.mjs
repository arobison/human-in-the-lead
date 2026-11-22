// The page's one inline script (HITLD-308, design part 12.4): hover highlighting of what feeds a
// node and what it unblocks, a scope picker and a search field that narrow every view. The page is
// complete without it. It never parses HTML (no innerHTML or the like): it builds its controls with
// createElement and textContent. Its data comes in as JSON with every character that could end the
// script or a string escaped. A Content-Security-Policy tag allows this script alone, by its hash,
// and nothing from elsewhere: no script, style, font, image or connection.

import { createHash } from 'node:crypto';

/**
 * @typedef {object} ScriptData
 * @property {Record<string, { t: string, s: string[] }>} items each item's and milestone's title and
 *   the scopes it belongs to
 * @property {[string, { id: string, t: string }[]][]} groups the scope picker's groups
 * @property {[string, string][]} edges `[from, to]`: `to` needs `from`
 */

/** The script's code; `__DATA__` is replaced by the escaped JSON. */
const CODE = `(() => {
  const D = __DATA__;
  const doc = document;
  const nav = doc.querySelector('nav.tabs');
  if (!nav) return;
  const bar = doc.createElement('div');
  bar.className = 'filters';
  const sel = doc.createElement('select');
  sel.setAttribute('aria-label', 'Scope');
  const option = (parent, value, text) => {
    const o = doc.createElement('option');
    o.value = value;
    o.textContent = text;
    parent.append(o);
  };
  option(sel, '', 'All work');
  for (const [label, list] of D.groups) {
    const g = doc.createElement('optgroup');
    g.label = label;
    for (const x of list) option(g, x.id, x.id + ' ' + x.t);
    sel.append(g);
  }
  const q = doc.createElement('input');
  q.type = 'search';
  q.placeholder = 'Search IDs and titles';
  q.setAttribute('aria-label', 'Search IDs and titles');
  const said = doc.createElement('span');
  said.className = 'meta';
  said.setAttribute('aria-live', 'polite');
  bar.append(sel, q, said);
  nav.after(bar);
  const apply = () => {
    const s = sel.value;
    const t = q.value.trim().toLowerCase();
    const hits = new Set();
    for (const el of doc.querySelectorAll('[data-item]')) {
      const id = el.getAttribute('data-item');
      const it = D.items[id];
      if (!it) continue;
      const ok =
        (!s || id === s || it.s.includes(s)) &&
        (!t || (id + ' ' + it.t).toLowerCase().includes(t));
      if (ok) hits.add(id);
      el.classList.toggle(el.closest('svg') ? 'dim' : 'hide', !ok);
    }
    said.textContent = s || t ? hits.size + ' match' + (hits.size === 1 ? '' : 'es') : '';
  };
  sel.addEventListener('change', apply);
  q.addEventListener('input', apply);
  const out = new Map();
  const into = new Map();
  for (const [a, b] of D.edges) {
    out.set(a, [...(out.get(a) || []), b]);
    into.set(b, [...(into.get(b) || []), a]);
  }
  const reach = (id, side, seen) => {
    for (const n of side.get(id) || []) {
      if (!seen.has(n)) {
        seen.add(n);
        reach(n, side, seen);
      }
    }
    return seen;
  };
  const unlight = (svg) => {
    svg.classList.remove('hovering');
    for (const x of svg.querySelectorAll('.lit')) x.classList.remove('lit');
  };
  const light = (el) => {
    const svg = el.closest('svg');
    const id = el.getAttribute('data-node');
    const up = reach(id, into, new Set([id]));
    const down = reach(id, out, new Set([id]));
    svg.classList.add('hovering');
    for (const x of svg.querySelectorAll('[data-node]')) {
      const n = x.getAttribute('data-node');
      x.classList.toggle('lit', up.has(n) || down.has(n));
    }
    for (const w of svg.querySelectorAll('[data-from]')) {
      const a = w.getAttribute('data-from');
      const b = w.getAttribute('data-to');
      w.classList.toggle('lit', (up.has(a) && up.has(b)) || (down.has(a) && down.has(b)));
    }
  };
  const node = (e) => (e.target instanceof Element ? e.target.closest('svg [data-node]') : null);
  for (const [on, off] of [
    ['mouseover', 'mouseout'],
    ['focusin', 'focusout'],
  ]) {
    doc.addEventListener(on, (e) => {
      const el = node(e);
      if (el) light(el);
    });
    doc.addEventListener(off, (e) => {
      const el = node(e);
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) {
        unlight(el.closest('svg'));
      }
    });
  }
})();`;

/**
 * JSON safe inside a script element: every `<`, `>`, `&` and line or paragraph separator escaped,
 * so no text from the tracker can end the script or start a comment.
 * @param {unknown} data
 */
export const scriptJson = (data) =>
  JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

/**
 * The script element and the Content-Security-Policy that allows only it.
 * @param {ScriptData} data
 * @returns {{ csp: string, tag: string, hash: string }}
 */
export function pageScript(data) {
  const code = CODE.replace('__DATA__', () => scriptJson(data));
  const hash = `sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}`;
  return { hash, csp: pagePolicy([hash]), tag: `<script>${code}</script>` };
}

/**
 * The Content-Security-Policy tag that allows the page's inline scripts by their hashes alone, and
 * nothing from elsewhere: no script, style, font, image or connection.
 * @param {string[]} hashes each `sha256-<base64>`
 */
export const pagePolicy = (hashes) =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashes.map((x) => `'${x}'`).join(' ')}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`;

/**
 * The script's data from the work model and the milestone graph.
 * @param {import('./work.mjs').WorkModel} w
 * @param {import('../tracker/files/views.mjs').MilestoneGraph | null} mg
 * @returns {ScriptData}
 */
export function scriptData(w, mg) {
  /** @type {ScriptData['items']} */
  const items = {};
  for (const it of w.items) items[it.id] = { t: it.title, s: it.scopes };
  for (const m of w.milestones) items[m.id] = { t: m.title, s: m.scopes };
  const live = (/** @type {{ state: string }} */ x) => x.state !== 'dropped';
  return {
    items,
    groups: /** @type {ScriptData['groups']} */ (
      [
        ['Long outcomes', w.milestones.filter((m) => m.long_outcome && live(m))],
        ['Projects', w.projects.filter(live)],
        ['Milestones', w.milestones.filter((m) => !m.long_outcome && live(m))],
      ]
        .filter(([, list]) => list.length)
        .map(([label, list]) => [
          label,
          /** @type {{ id: string, title: string }[]} */ (list).map((x) => ({
            id: x.id,
            t: x.title,
          })),
        ])
    ),
    edges: [
      ...w.items.flatMap((it) => it.needs.map((n) => /** @type {[string, string]} */ ([n, it.id]))),
      ...(mg?.edges ?? []).map((e) => /** @type {[string, string]} */ ([e.from, e.to])),
    ],
  };
}
