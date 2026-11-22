// The typed client over the dashboard data contract (HITLD-729, decisions HITLD-720 and
// HITLD-721): framework-free, for HITLD's page and for a project's own app. It reads a contract
// (an object, its JSON text, the copy inlined in HITLD's page, or a URL), checks the version it
// knows, and gives the items, the panels, any field's value and the line saying when and where the
// data was read. It ignores fields it does not know, as the contract asks of callers
// (schemas/dashboard-data.schema.json). Pure apart from fetchContract and readInlined, which use
// the fetch and document the caller has.

import { readNote } from './text.mjs';

/** The contract version this client reads. A contract with another version is refused. */
export const SUPPORTED_API_VERSION = 2;

/** The id of the script element HITLD's page carries the contract in, as JSON. */
export const INLINE_ID = 'hitld-contract';

/**
 * @typedef {string | number | boolean | null | (string | number | boolean)[]} Value a field's value
 *
 * @typedef {object} DeclaredField a field tracker.json declares
 * @property {string} name
 * @property {'string' | 'integer' | 'number' | 'boolean' | 'date'} type
 * @property {boolean} [list]
 * @property {string[]} [values]
 * @property {string} [description]
 * @property {string} [label] its classification label, when one is set
 *
 * @typedef {object} ContractItem an item of the contract's work
 * @property {string} id
 * @property {string} kind
 * @property {string} title its ID when it is withheld
 * @property {string} state
 * @property {string} stage
 * @property {string | null} project
 * @property {string[]} needs
 * @property {string[]} open_needs
 * @property {string | null} [path]
 * @property {string | null} created
 * @property {boolean} critical
 * @property {number} waiting_on_it
 * @property {string | null} decider
 * @property {string | null} waiting_on
 * @property {string[]} scopes
 * @property {string} classification
 * @property {string | null} owner
 * @property {Record<string, Value>} [fields] the declared fields it sets
 * @property {boolean} [redacted] true for a withheld item's stub
 *
 * @typedef {object} StateChange
 * @property {string} at @property {string | null} from @property {string} to
 *
 * @typedef {object} Work the contract's work
 * @property {string} read_at
 * @property {{ commit: string | null, branch: string | null, shallow?: boolean }} source
 * @property {DeclaredField[]} fields
 * @property {ContractItem[]} items
 * @property {{ id: string, changes: StateChange[] }[]} history
 *
 * @typedef {{ field: string } & Record<string, unknown>} Filter a panel's filter, as views.json has it
 *
 * @typedef {object} PanelBase what every resolved panel has
 * @property {string} id
 * @property {string} title
 * @property {string} type
 * @property {string | null} description
 * @property {Filter[]} where
 * @property {number} matched how many items its filters keep
 *
 * @typedef {PanelBase & { type: 'table', columns: string[], sort: string, order: 'ascending' | 'descending', rows: { id: string, cells: Value[] }[], more: number }} TablePanel
 * @typedef {PanelBase & { type: 'board', group_by: string, columns: { value: string | number | boolean | null, ids: string[], more: number }[] }} BoardPanel
 * @typedef {PanelBase & { type: 'bar', group_by: string, bars: { value: string | number | boolean | null, count: number }[] }} BarPanel
 * @typedef {PanelBase & { type: 'line', date: string, interval: 'day' | 'week' | 'month', cumulative: boolean, points: { at: string, count: number }[], undated: number, cut: number }} LinePanel
 * @typedef {PanelBase & { type: 'timeline', date: string, end: string | null, entries: { id: string, start: string, end: string | null }[], undated: number, more: number }} TimelinePanel
 * @typedef {PanelBase & { type: 'graph', relation: string, nodes: string[], edges: [string, string][], outside: number, more: number }} GraphPanel
 * @typedef {TablePanel | BoardPanel | BarPanel | LinePanel | TimelinePanel | GraphPanel} BuiltinPanel
 * @typedef {PanelBase & Record<string, unknown>} AnyPanel a panel of any type, a project's own
 *   included
 *
 * @typedef {object} PanelError why views.json, or one panel in it, was refused
 * @property {string | null} panel @property {string} path @property {string} message
 *
 * @typedef {object} Views the project's own panels, resolved
 * @property {string} path
 * @property {string} title
 * @property {BuiltinPanel[]} panels
 * @property {PanelError[]} errors
 *
 * @typedef {object} Contract the dashboard data contract (schemas/dashboard-data.schema.json); the
 *   parts this client types, and the rest as it is
 * @property {number} api_version
 * @property {string} generated_at
 * @property {string} project
 * @property {Record<string, unknown>} gate
 * @property {Record<string, unknown>[]} quotas
 * @property {Record<string, unknown>} ledger
 * @property {Record<string, unknown>} usage
 * @property {Record<string, unknown>} settings
 * @property {Record<string, unknown> | null} milestones
 * @property {Work | null} work
 * @property {Views | null} views
 *
 * @typedef {object} ReadStamp when and where the contract's data was read
 * @property {string} at when it was generated
 * @property {{ commit: string | null, branch: string | null } | null} tracker the tracker it read,
 *   or null when it had none
 * @property {string} store where the ledger and quotas came from
 * @property {number} api_version
 * @property {string} text all of it in one line, as HITLD's page says it
 */

/** A contract that cannot be read, with a code to match on. */
export class ContractError extends Error {
  /** @param {'not-a-contract' | 'unsupported-version' | 'no-field' | 'no-inline-data'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read a contract: an object, or its JSON text. Refuses anything that is not one, and a version
 * this client does not know, naming it.
 * @param {unknown} input @returns {Contract}
 */
export function readContract(input) {
  /** @type {unknown} */
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ContractError(
        'not-a-contract',
        `the contract is not JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (!isObject(data)) throw new ContractError('not-a-contract', 'the contract is not an object');
  if (!Number.isInteger(data.api_version)) {
    throw new ContractError('not-a-contract', 'the contract has no api_version');
  }
  if (data.api_version !== SUPPORTED_API_VERSION) {
    throw new ContractError(
      'unsupported-version',
      `the contract is version ${data.api_version}; this client reads version ${SUPPORTED_API_VERSION}`,
    );
  }
  for (const k of ['generated_at', 'project']) {
    if (typeof data[k] !== 'string') {
      throw new ContractError('not-a-contract', `the contract has no ${k}`);
    }
  }
  if (data.work != null && !(isObject(data.work) && Array.isArray(data.work.items))) {
    throw new ContractError('not-a-contract', 'the contract work has no items');
  }
  if (data.views != null && !(isObject(data.views) && Array.isArray(data.views.panels))) {
    throw new ContractError('not-a-contract', 'the contract views have no panels');
  }
  return /** @type {Contract} */ (data);
}

/**
 * @typedef {object} Inlined what HITLD's page carries: the contract, and where its files are
 * @property {Contract} contract
 * @property {string | null} fileBase the forge's address for the repository's files, or null to
 *   link them by their repository-relative path
 */

/**
 * The contract HITLD's page carries, from its JSON script element.
 * @param {{ getElementById(id: string): { textContent: string | null } | null }} [doc] the document
 * @param {string} [id]
 * @returns {Inlined}
 */
export function readInlined(doc = /** @type {any} */ (globalThis).document, id = INLINE_ID) {
  const el = doc?.getElementById(id);
  if (!el) throw new ContractError('no-inline-data', `the page has no #${id} element`);
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(el.textContent ?? '');
  } catch (e) {
    throw new ContractError(
      'not-a-contract',
      `#${id} is not JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!isObject(payload)) throw new ContractError('not-a-contract', `#${id} is not an object`);
  return {
    contract: readContract(payload.contract),
    fileBase: typeof payload.file_base === 'string' ? payload.file_base : null,
  };
}

/**
 * Fetch a contract from a URL, as a project's own app serves the JSON file `hitld dashboard
 * --json --no-write` returns (its `report`, or the whole output).
 * @param {string} url
 * @param {{ fetch?: (url: string, init?: any) => Promise<{ ok: boolean, status: number, json(): Promise<unknown> }>, signal?: AbortSignal }} [options]
 * @returns {Promise<Contract>}
 */
export async function fetchContract(url, { fetch = globalThis.fetch, signal } = {}) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new ContractError('not-a-contract', `${url} answered ${res.status}`);
  const body = await res.json();
  return readContract(isObject(body) && isObject(body.report) ? body.report : body);
}

/** The contract's items, none without a tracker. @param {Contract} c @returns {ContractItem[]} */
export const itemsOf = (c) => c.work?.items ?? [];

/** @type {WeakMap<Contract, Map<string, ContractItem>>} */
const byIdCache = new WeakMap();

/** The contract's items by ID. @param {Contract} c @returns {Map<string, ContractItem>} */
export function itemsById(c) {
  let m = byIdCache.get(c);
  if (!m) {
    m = new Map(itemsOf(c).map((it) => [String(it.id), it]));
    byIdCache.set(c, m);
  }
  return m;
}

/** One item, or null. @param {Contract} c @param {string} id */
export const itemOf = (c, id) => itemsById(c).get(id) ?? null;

/** The project's resolved panels, none without views.json. @param {Contract} c */
export const panelsOf = (c) => c.views?.panels ?? [];

/** One resolved panel, or null. @param {Contract} c @param {string} id */
export const panelOf = (c, id) => panelsOf(c).find((p) => p.id === id) ?? null;

/** The item keys a field name can be, as views.json names them (core/lib/dashboard/panels.mjs). */
const ITEM_KEYS = new Set([
  'id',
  'kind',
  'title',
  'state',
  'stage',
  'project',
  'needs',
  'open_needs',
  'created',
  'critical',
  'waiting_on_it',
  'decider',
  'waiting_on',
  'scopes',
  'classification',
  'owner',
  'redacted',
]);

/** @type {WeakMap<Contract, Map<string, Record<string, string>>>} */
const reachedCache = new WeakMap();

/** The first date each item reached each state. @param {Contract} c */
function reached(c) {
  let m = reachedCache.get(c);
  if (!m) {
    m = new Map();
    for (const h of c.work?.history ?? []) {
      /** @type {Record<string, string>} */
      const first = {};
      for (const ch of h.changes) {
        const day = new Date(Date.parse(ch.at)).toISOString().slice(0, 10);
        if (!first[ch.to] || day < first[ch.to]) first[ch.to] = day;
      }
      m.set(h.id, first);
    }
    reachedCache.set(c, m);
  }
  return m;
}

/**
 * A getter for a field, named as views.json names it: the contract's own item key, a declared
 * field by its name or as fields.<name>, or reached.<state>. A name that is none of these is
 * refused by name, never read as empty.
 * @param {Contract} c @param {string} name @returns {(it: ContractItem) => Value}
 */
export function fieldGetter(c, name) {
  if (name.startsWith('reached.')) {
    const state = name.slice('reached.'.length);
    const r = reached(c);
    return (it) => r.get(it.id)?.[state] ?? null;
  }
  if (!name.startsWith('fields.') && ITEM_KEYS.has(name)) {
    return (it) => /** @type {Value} */ (/** @type {any} */ (it)[name] ?? null);
  }
  const bare = name.startsWith('fields.') ? name.slice('fields.'.length) : name;
  if (!(c.work?.fields ?? []).some((f) => f.name === bare)) {
    throw new ContractError(
      'no-field',
      `"${name}" is not a field of the dashboard data contract or one tracker.json declares`,
    );
  }
  return (it) => it.fields?.[bare] ?? null;
}

/** A field's value on an item. @param {Contract} c @param {ContractItem} it @param {string} name */
export const fieldValue = (c, it, name) => fieldGetter(c, name)(it);

/** When and where the contract's data was read. @param {Contract} c @returns {ReadStamp} */
export function readStamp(c) {
  const src = c.work?.source;
  return {
    at: c.generated_at,
    tracker: c.work ? { commit: src?.commit ?? null, branch: src?.branch ?? null } : null,
    store: 'the ledger and quotas in the private store on the machine that generated it',
    api_version: c.api_version,
    text: readNote(c),
  };
}

/**
 * The link to an item's file: on the forge when `base` is known, else by its repository-relative
 * path (as core/lib/tracker/files/views.mjs fileHref).
 * @param {string} path @param {string | null} [base]
 */
export const fileHref = (path, base = null) =>
  base ? `${base}/${encodeURI(path)}` : encodeURI(path);
