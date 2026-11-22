// A project's own panels (HITLD-692, decisions HITLD-684, 685 and 687): declared as data in
// .human-in-the-lead/views.json beside tracker.json, checked against the fields of the dashboard
// data contract and the fields tracker.json declares, and resolved here into what each panel shows.
// The resolved panels go into the contract under `views`, so HITLD's page and a project's own app
// draw the same thing from it. Nothing a project writes is code, and nothing is drawn as markup.
//
// A field is named as the contract's item names it, as reached.<state> (the date an item first
// reached that state, from the committed history), or as a declared field, by its name or as
// fields.<name>; a bare name is the contract's own first.

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemas } from '../schema/registry.mjs';
import { byId } from './layout.mjs';

/**
 * @typedef {import('./work.mjs').DeclaredField} DeclaredField
 * @typedef {import('../schema/validate.mjs').ValidationError} ValidationError
 *
 * @typedef {object} FieldSpec a field a panel can name
 * @property {string} name as the panel names it
 * @property {'item' | 'declared' | 'reached'} source
 * @property {string} key the item key, the declared field's name, or the state
 * @property {'string' | 'integer' | 'number' | 'boolean' | 'date'} type
 * @property {boolean} list
 * @property {string[] | null} values the values it may take, when it has a closed set
 *
 * @typedef {object} PanelError a problem with views.json, naming the panel it refuses
 * @property {string | null} panel the panel's id, or null when the whole file is refused
 * @property {string} path where in the file
 * @property {string} message
 *
 * @typedef {Record<string, any>} Panel a panel as views.json declares it
 * @typedef {{ title: string, panels: Panel[], errors: PanelError[] }} CheckedViews
 */

/** Where a project's panels are declared, relative to the repository root. */
export const VIEWS_PATH = '.human-in-the-lead/views.json';

/** The panel types (decision HITLD-685). */
export const PANEL_TYPES = Object.freeze(['table', 'board', 'bar', 'line', 'timeline', 'graph']);

/** The tab's name when views.json is too broken to say. */
const FALLBACK_TITLE = 'Project panels';

/** The most items a table, a board column or a timeline shows by default. */
const DEFAULT_LIMIT = 200;
/** The most nodes a graph draws. */
const GRAPH_MAX = 300;
/** The most points a line shows: the latest are kept. */
const LINE_MAX = 400;
/** The largest views.json read. */
const MAX_BYTES = 256 * 1024;

/** The keys each type takes beside id, title, type, description and where. */
const TYPE_KEYS = /** @type {Record<string, { required: string[], optional: string[] }>} */ ({
  table: { required: ['columns'], optional: ['sort', 'order', 'limit'] },
  board: { required: ['group_by'], optional: ['limit'] },
  bar: { required: ['group_by'], optional: [] },
  line: { required: ['date'], optional: ['interval', 'cumulative'] },
  timeline: { required: ['date'], optional: ['end', 'limit'] },
  graph: { required: [], optional: ['relation'] },
});
const COMMON_KEYS = new Set(['id', 'title', 'type', 'description', 'where']);

/** The contract's item fields a panel can name, typed (schemas/dashboard-data.schema.json). */
function itemFields() {
  const reg = schemas();
  const common = reg.get('common').$defs;
  const item = reg.get('dashboard-data').$defs.item.properties;
  /** @type {[string, FieldSpec['type'], boolean, string[] | null][]} */
  const rows = [
    ['id', 'string', false, null],
    ['kind', 'string', false, item.kind.enum],
    ['title', 'string', false, null],
    ['state', 'string', false, common.itemState.enum],
    ['stage', 'string', false, item.stage.enum],
    ['project', 'string', false, null],
    ['needs', 'string', true, null],
    ['open_needs', 'string', true, null],
    ['created', 'date', false, null],
    ['critical', 'boolean', false, null],
    ['waiting_on_it', 'integer', false, null],
    ['decider', 'string', false, null],
    ['waiting_on', 'string', false, null],
    ['scopes', 'string', true, null],
    ['classification', 'string', false, common.classification.enum],
    ['owner', 'string', false, null],
    ['redacted', 'boolean', false, null],
  ];
  return new Map(
    rows.map(([name, type, list, values]) => [
      name,
      /** @type {FieldSpec} */ ({ name, source: 'item', key: name, type, list, values }),
    ]),
  );
}

/** The item states, for reached.<state>. */
const itemStates = () => /** @type {string[]} */ (schemas().get('common').$defs.itemState.enum);

/**
 * The field a panel names, or why it names none.
 * @param {string} name @param {DeclaredField[]} declared
 * @returns {FieldSpec | string}
 */
export function resolveField(name, declared) {
  if (name.startsWith('reached.')) {
    const state = name.slice('reached.'.length);
    if (!itemStates().includes(state)) {
      return `"${name}" names no state (reached.<state> takes one of ${itemStates().join(', ')})`;
    }
    return { name, source: 'reached', key: state, type: 'date', list: false, values: null };
  }
  const own = name.startsWith('fields.') ? null : itemFields().get(name);
  if (own) return own;
  const bare = name.startsWith('fields.') ? name.slice('fields.'.length) : name;
  const d = declared.find((f) => f.name === bare);
  if (!d) {
    return `"${name}" is not a field of the dashboard data contract or one tracker.json declares`;
  }
  return {
    name,
    source: 'declared',
    key: d.name,
    type: d.type,
    list: d.list === true,
    values: d.values ?? null,
  };
}

/** @param {unknown} v */
const isDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Whether a field can be a date: a date, or declared text that may hold one. @param {FieldSpec} f */
const datable = (f) => f.type === 'date' || (f.source === 'declared' && f.type === 'string');

/** @param {unknown} v */
const show = (v) => JSON.stringify(v);

/**
 * Why a filter's value does not fit its field, or null.
 * @param {FieldSpec} f @param {unknown} v @param {string} test
 */
function valueProblem(f, v, test) {
  if (test === 'at_least' || test === 'at_most') {
    if (f.type === 'integer' || f.type === 'number') {
      return typeof v === 'number' ? null : `${test} on "${f.name}" takes a number, not ${show(v)}`;
    }
    if (datable(f)) {
      return isDate(v) ? null : `${test} on "${f.name}" takes a date, YYYY-MM-DD, not ${show(v)}`;
    }
    return `${test} needs a number or a date field; "${f.name}" is ${f.type}`;
  }
  const want =
    f.type === 'integer' || f.type === 'number'
      ? 'number'
      : f.type === 'boolean'
        ? 'boolean'
        : 'string';
  if (typeof v !== want) return `"${f.name}" holds ${f.type} values, not ${show(v)}`;
  if (f.type === 'integer' && !Number.isInteger(v)) {
    return `"${f.name}" holds whole numbers, not ${show(v)}`;
  }
  if (f.type === 'date' && !isDate(v)) return `"${f.name}" holds dates, YYYY-MM-DD, not ${show(v)}`;
  if (f.values && !f.values.includes(/** @type {string} */ (v))) {
    return `${show(v)} is not a value of "${f.name}" (one of ${f.values.join(', ')})`;
  }
  return null;
}

/**
 * Check a parsed views.json against its schema and the fields it may name. A problem in one panel
 * refuses that panel; a problem outside the panels refuses the file.
 * @param {unknown} raw @param {DeclaredField[]} declared tracker.json `fields`
 * @returns {CheckedViews}
 */
export function checkViews(raw, declared = []) {
  /** @type {PanelError[]} */
  const errors = [];
  const data = /** @type {Record<string, any>} */ (raw);
  const panelsIn = Array.isArray(data?.panels) ? data.panels : [];
  /** @param {number} i */
  const panelName = (i) => {
    const id = panelsIn[i]?.id;
    return typeof id === 'string' && id ? id : `panels[${i}]`;
  };
  const refused = new Set();
  for (const e of schemas().validate('views', raw)) {
    const m = /^panels\[(\d+)\]/.exec(e.path);
    if (m) {
      refused.add(Number(m[1]));
      errors.push({ panel: panelName(Number(m[1])), path: e.path, message: e.message });
    } else {
      errors.push({ panel: null, path: e.path || '(top level)', message: e.message });
    }
  }
  const title =
    typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : FALLBACK_TITLE;
  if (errors.some((e) => e.panel === null)) return { title, panels: [], errors };
  /** @type {Panel[]} */
  const panels = [];
  const seen = new Set();
  for (const [i, p] of panelsIn.entries()) {
    if (refused.has(i)) continue;
    const at = `panels[${i}]`;
    const own = /** @type {PanelError[]} */ ([]);
    /** @param {string} path @param {string} message */
    const fail = (path, message) =>
      own.push({ panel: p.id, path, message: `panel "${p.id}": ${message}` });
    if (seen.has(p.id)) fail(`${at}.id`, 'another panel has this id');
    seen.add(p.id);
    const keys = TYPE_KEYS[p.type];
    for (const k of Object.keys(p)) {
      if (!COMMON_KEYS.has(k) && !keys.required.includes(k) && !keys.optional.includes(k)) {
        fail(`${at}.${k}`, `a ${p.type} panel does not take "${k}"`);
      }
    }
    for (const k of keys.required) {
      if (p[k] === undefined) fail(`${at}.${k}`, `a ${p.type} panel needs "${k}"`);
    }
    /** @param {string} path @param {string} name @returns {FieldSpec | null} */
    const field = (path, name) => {
      const f = resolveField(name, declared);
      if (typeof f === 'string') {
        fail(path, f);
        return null;
      }
      return f;
    };
    for (const [j, c] of (p.columns ?? []).entries()) field(`${at}.columns[${j}]`, c);
    for (const k of ['sort', 'group_by']) if (p[k] !== undefined) field(`${at}.${k}`, p[k]);
    for (const k of ['date', 'end']) {
      if (p[k] === undefined) continue;
      const f = field(`${at}.${k}`, p[k]);
      if (f && !datable(f)) {
        fail(
          `${at}.${k}`,
          `"${f.name}" is not a date (created, reached.<state>, or declared text holding YYYY-MM-DD)`,
        );
      }
      if (f && f.list) fail(`${at}.${k}`, `"${f.name}" holds a list, not one date`);
    }
    if (p.relation !== undefined) {
      const f = field(`${at}.relation`, p.relation);
      if (f && f.type !== 'string') {
        fail(`${at}.relation`, `"${f.name}" holds ${f.type} values, not IDs`);
      }
    }
    for (const [j, w] of (p.where ?? []).entries()) {
      const f = field(`${at}.where[${j}].field`, w.field);
      if (!f) continue;
      const [test, value] = /** @type {[string, unknown]} */ (
        Object.entries(w).find(([k]) => k !== 'field')
      );
      if (test === 'set') continue;
      if (f.list && (test === 'at_least' || test === 'at_most')) {
        fail(`${at}.where[${j}].${test}`, `${test} cannot test "${f.name}", which holds a list`);
        continue;
      }
      for (const [n, v] of (Array.isArray(value) ? value : [value]).entries()) {
        const problem = valueProblem(f, v, test);
        if (problem) {
          fail(`${at}.where[${j}].${test}${Array.isArray(value) ? `[${n}]` : ''}`, problem);
        }
      }
    }
    if (own.length) errors.push(...own);
    else panels.push(p);
  }
  return { title, panels, errors };
}

/**
 * Read views.json from a repository. No file is not an error: the dashboard shows the built-in
 * views alone. The file must be a regular file, not a link, and small.
 * @param {string} repoRoot
 * @returns {{ path: string, raw: unknown } | { path: string, error: string } | null}
 */
export function readViewsFile(repoRoot) {
  const path = join(repoRoot, VIEWS_PATH);
  /** @type {import('node:fs').Stats} */
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (!st.isFile()) return { path, error: 'is not a regular file (a link is not read)' };
  if (st.size > MAX_BYTES) return { path, error: `is larger than ${MAX_BYTES} bytes` };
  try {
    return { path, raw: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { path, error: `cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Read and check a repository's views.json. Null when there is none.
 * @param {string} repoRoot @param {DeclaredField[]} declared
 * @returns {CheckedViews | null}
 */
export function loadViews(repoRoot, declared) {
  const read = readViewsFile(repoRoot);
  if (!read) return null;
  if ('error' in read) {
    return {
      title: FALLBACK_TITLE,
      panels: [],
      errors: [{ panel: null, path: '(file)', message: `${VIEWS_PATH} ${read.error}` }],
    };
  }
  return checkViews(read.raw, declared);
}

// Resolving: what each panel shows, from the contract's work.

/**
 * @typedef {import('./work.mjs').WorkModel} WorkModel
 * @typedef {Record<string, any>} Item an item of the contract's work
 * @typedef {string | number | boolean | null | (string | number | boolean)[]} Value
 */

/** The first date each item reached each state, from the committed history. @param {WorkModel} work */
function reachedDates(work) {
  /** @type {Map<string, Record<string, string>>} */
  const out = new Map();
  for (const h of work.history ?? []) {
    /** @type {Record<string, string>} */
    const first = {};
    for (const c of h.changes) {
      const day = new Date(Date.parse(c.at)).toISOString().slice(0, 10);
      if (!first[c.to] || day < first[c.to]) first[c.to] = day;
    }
    out.set(h.id, first);
  }
  return out;
}

/**
 * A getter for a field's value on an item.
 * @param {FieldSpec} f @param {Map<string, Record<string, string>>} reached
 * @returns {(it: Item) => Value}
 */
function getter(f, reached) {
  if (f.source === 'reached') return (it) => reached.get(it.id)?.[f.key] ?? null;
  if (f.source === 'declared') return (it) => it.fields?.[f.key] ?? null;
  return (it) => it[f.key] ?? null;
}

/** A value as a list of its members, empty for none. @param {Value} v @returns {(string | number | boolean)[]} */
const members = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

/**
 * Whether an item's value meets one test.
 * @param {Value} v @param {string} test @param {any} want
 */
function meets(v, test, want) {
  const ms = members(v);
  switch (test) {
    case 'is':
      return ms.includes(want);
    case 'not':
      return !ms.includes(want);
    case 'in':
      return ms.some((m) => want.includes(m));
    case 'not_in':
      return !ms.some((m) => want.includes(m));
    case 'set':
      return want ? ms.length > 0 : ms.length === 0;
    case 'at_least':
      return ms.length > 0 && /** @type {any} */ (ms[0]) >= want;
    case 'at_most':
      return ms.length > 0 && /** @type {any} */ (ms[0]) <= want;
    default:
      return false;
  }
}

/** Compare two values for sorting: none last, numbers by size, the rest as text. @param {Value} a @param {Value} b */
function compare(a, b) {
  const na = a == null || (Array.isArray(a) && !a.length);
  const nb = b == null || (Array.isArray(b) && !b.length);
  if (na || nb) return Number(na) - Number(nb);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * The groups of a board or a bar: the field's closed set in its order when it has one (true and
 * false for a boolean), else the values seen, as text; items with no value last.
 * @param {Item[]} items @param {FieldSpec} f @param {(it: Item) => Value} get
 * @returns {{ value: string | number | boolean | null, ids: string[] }[]}
 */
function groupsOf(items, f, get) {
  /** @type {Map<string | number | boolean | null, string[]>} */
  const by = new Map();
  for (const v of f.values ?? (f.type === 'boolean' ? [true, false] : [])) by.set(v, []);
  /** @type {string[]} */
  const none = [];
  for (const it of items) {
    const ms = members(get(it));
    if (!ms.length) none.push(it.id);
    for (const m of new Set(ms)) by.set(m, [...(by.get(m) ?? []), it.id]);
  }
  let groups = [...by].map(([value, ids]) => ({ value, ids }));
  if (!f.values && f.type !== 'boolean') groups.sort((a, b) => compare(a.value, b.value));
  if (none.length) groups = [...groups, { value: null, ids: none }];
  return groups;
}

/** The start of the interval a date falls in. @param {string} day @param {string} interval */
function bucketOf(day, interval) {
  if (interval === 'month') return `${day.slice(0, 7)}-01`;
  if (interval === 'day') return day;
  const t = Date.parse(`${day}T00:00:00Z`);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(monday).toISOString().slice(0, 10);
}

/** The interval after one. @param {string} at @param {string} interval */
function nextBucket(at, interval) {
  const d = new Date(`${at}T00:00:00Z`);
  if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + (interval === 'day' ? 1 : 7));
  return d.toISOString().slice(0, 10);
}

/**
 * What one checked panel shows, from the contract's work.
 * @param {Panel} p @param {Item[]} all the contract's items
 * @param {DeclaredField[]} declared @param {Map<string, Record<string, string>>} reached
 */
export function resolvePanel(p, all, declared, reached) {
  const spec = (/** @type {string} */ name) =>
    /** @type {FieldSpec} */ (resolveField(name, declared));
  const get = (/** @type {string} */ name) => getter(spec(name), reached);
  let items = all;
  for (const w of p.where ?? []) {
    const [test, want] = /** @type {[string, unknown]} */ (
      Object.entries(w).find(([k]) => k !== 'field')
    );
    const g = get(w.field);
    items = items.filter((it) => meets(g(it), test, want));
  }
  items = [...items].sort((a, b) => byId(a.id, b.id));
  const base = {
    id: String(p.id),
    title: String(p.title),
    type: String(p.type),
    description: p.description ?? null,
    where: p.where ?? [],
    matched: items.length,
  };
  const limit = p.limit ?? DEFAULT_LIMIT;
  switch (p.type) {
    case 'table': {
      const sort = p.sort ?? 'id';
      const order = p.order ?? 'ascending';
      const key = sort === 'id' ? null : get(sort);
      let rows = [...items];
      if (key) rows.sort((a, b) => compare(key(a), key(b)) || byId(a.id, b.id));
      if (order === 'descending') {
        // Items with no value stay last when the order is turned round.
        const has = (/** @type {Item} */ it) => !key || members(key(it)).length > 0;
        rows = [...rows.filter(has).reverse(), ...rows.filter((it) => !has(it))];
      }
      const getters = p.columns.map(get);
      return {
        ...base,
        columns: [...p.columns],
        sort,
        order,
        rows: rows.slice(0, limit).map((it) => ({
          id: String(it.id),
          cells: getters.map((/** @type {(it: Item) => Value} */ g) => g(it)),
        })),
        more: Math.max(0, rows.length - limit),
      };
    }
    case 'board':
      return {
        ...base,
        group_by: p.group_by,
        columns: groupsOf(items, spec(p.group_by), get(p.group_by)).map((c) => ({
          value: c.value,
          ids: c.ids.slice(0, limit),
          more: Math.max(0, c.ids.length - limit),
        })),
      };
    case 'bar':
      return {
        ...base,
        group_by: p.group_by,
        bars: groupsOf(items, spec(p.group_by), get(p.group_by)).map((c) => ({
          value: c.value,
          count: c.ids.length,
        })),
      };
    case 'line': {
      const interval = p.interval ?? 'week';
      const cumulative = p.cumulative === true;
      const g = get(p.date);
      /** @type {Map<string, number>} */
      const counts = new Map();
      let undated = 0;
      for (const it of items) {
        const v = g(it);
        if (!isDate(v)) {
          undated++;
          continue;
        }
        const b = bucketOf(/** @type {string} */ (v), interval);
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      const keys = [...counts.keys()].sort();
      /** @type {{ at: string, count: number }[]} */
      let points = [];
      if (keys.length) {
        let total = 0;
        const last = /** @type {string} */ (keys.at(-1));
        for (let at = keys[0]; at <= last; at = nextBucket(at, interval)) {
          total += counts.get(at) ?? 0;
          points.push({ at, count: cumulative ? total : (counts.get(at) ?? 0) });
        }
      }
      const cut = Math.max(0, points.length - LINE_MAX);
      points = points.slice(cut);
      return { ...base, date: p.date, interval, cumulative, points, undated, cut };
    }
    case 'timeline': {
      const start = get(p.date);
      const end = p.end ? get(p.end) : null;
      /** @type {{ id: string, start: string, end: string | null }[]} */
      const entries = [];
      let undated = 0;
      for (const it of items) {
        const s = start(it);
        if (!isDate(s)) {
          undated++;
          continue;
        }
        const e = end ? end(it) : null;
        entries.push({
          id: String(it.id),
          start: /** @type {string} */ (s),
          end:
            isDate(e) && /** @type {string} */ (e) >= /** @type {string} */ (s) ? String(e) : null,
        });
      }
      entries.sort((a, b) => a.start.localeCompare(b.start) || byId(a.id, b.id));
      return {
        ...base,
        date: p.date,
        end: p.end ?? null,
        entries: entries.slice(0, limit),
        undated,
        more: Math.max(0, entries.length - limit),
      };
    }
    case 'graph': {
      const relation = p.relation ?? 'needs';
      const g = get(relation);
      const shown = items.slice(0, GRAPH_MAX);
      const ids = new Set(shown.map((it) => String(it.id)));
      /** @type {[string, string][]} */
      const edges = [];
      let outside = 0;
      for (const it of shown) {
        for (const to of new Set(members(g(it)).map(String))) {
          if (to === it.id) continue;
          if (ids.has(to)) edges.push([to, String(it.id)]);
          else outside++;
        }
      }
      edges.sort((a, b) => byId(a[1], b[1]) || byId(a[0], b[0]));
      return {
        ...base,
        relation,
        nodes: [...ids],
        edges,
        outside,
        more: Math.max(0, items.length - shown.length),
      };
    }
    default:
      return base;
  }
}

/**
 * The contract's `views`: the project's panels, resolved, with the problems that refused any.
 * Null when the project has no views.json.
 * @param {CheckedViews | null} checked @param {WorkModel | null} work
 */
export function viewsModel(checked, work) {
  if (!checked) return null;
  const declared = work?.fields ?? [];
  const reached = work ? reachedDates(work) : new Map();
  const items = work?.items ?? [];
  return {
    path: VIEWS_PATH,
    title: checked.title,
    panels: checked.panels.map((p) => resolvePanel(p, items, declared, reached)),
    errors: checked.errors,
  };
}

/** @typedef {NonNullable<ReturnType<typeof viewsModel>>} ViewsModel */
/** @typedef {ReturnType<typeof resolvePanel>} ResolvedPanel */
