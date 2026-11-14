// The reference file format (generalized by settings; design part 16.7):
// kinds, statuses, the allowlist of front-matter keys per kind, and how the stored keys map to
// the tracker's entity fields (design part 3.2).
//
// The stored names are the consumer's: `status`, `project` (an item's parent), `initiative` (a
// project's parent), `decided-by`, `claimed`. The entity the adapter hands out uses the model's
// names: `state`, `parent`, `decider`. The mapping is here, in one place.

import { ITEM_KINDS, list } from './graph.mjs';

export const KINDS = ['work', 'decision', 'external', 'project', 'initiative'];
export const STATUSES = ['Proposed', 'Planned', 'In progress', 'Done', 'Dropped'];
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

/** Folder group per kind: containers have their own, every item kind shares one. */
export const FOLDER_GROUP = /** @type {const} */ ({
  initiative: 'initiative',
  project: 'project',
  work: 'item',
  decision: 'item',
  external: 'item',
});

const COMMON_KEYS = ['id', 'title', 'kind', 'status', 'priority', 'created'];

/** The allowlist: any key not listed for an item's kind is an error. */
export const KEYS = /** @type {Record<string, string[]>} */ ({
  work: [...COMMON_KEYS, 'project', 'milestone', 'needs', 'claimed', 'reason'],
  decision: [...COMMON_KEYS, 'project', 'milestone', 'needs', 'claimed', 'reason', 'decided-by'],
  external: [...COMMON_KEYS, 'project', 'milestone', 'needs', 'claimed', 'reason', 'party'],
  project: [...COMMON_KEYS, 'initiative', 'lead', 'plan', 'milestones', 'reason'],
  initiative: [...COMMON_KEYS, 'lead', 'reason'],
});

/** Keys some tool would run as code. Refused with their own message. */
export const CODE_KEYS = [
  'onStatusChange',
  'on_status_change',
  'hooks',
  'hook',
  'script',
  'scripts',
  'run',
  'exec',
  'command',
  'cmd',
  'shell',
];

/** Optional keys (tracker.json optional_keys) that hold a list. */
const OPTIONAL_LISTS = ['opened_from', 'touches', 'serial', 'credit'];

/**
 * The keys that hold a list, given the settings.
 * @param {import('./config.mjs').Layout} layout
 */
export const listKeys = (layout) =>
  new Set([
    'needs',
    'milestones',
    ...layout.optionalKeys.filter((k) => OPTIONAL_LISTS.includes(k)),
  ]);

/**
 * The allowed keys for a kind, given the settings.
 * @param {string} kind @param {import('./config.mjs').Layout} layout
 */
export const allowedKeys = (kind, layout) => [...KEYS[kind], ...layout.optionalKeys];

/** The key order a file is written in: the reference order, then the optional keys. */
export const keyOrder = (
  /** @type {string} */ kind,
  /** @type {import('./config.mjs').Layout} */ layout,
) => allowedKeys(kind, layout);

/** The stored keys with no entity field of their own: carried through under the same names. */
export const NATIVE_EXTRAS = [
  'priority',
  'created',
  'milestone',
  'milestones',
  'claimed',
  'reason',
  'party',
  'lead',
  'plan',
];

/** @param {unknown} v */
const intOrSame = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);

/**
 * The entity as the model names it, from a file's stored keys: `status` becomes `state`, the
 * parent key becomes `parent`, `decided-by` becomes `decider`, and a missing classification is
 * the project's default. Keys the model has no field for are carried through under their own
 * names. `schema_version` is added so the schemas can validate it.
 * @param {Record<string, unknown>} d stored keys
 * @param {import('./config.mjs').Layout} layout
 * @returns {Record<string, unknown>}
 */
export function toEntity(d, layout) {
  /** @type {Record<string, unknown>} */
  const e = { schema_version: 1, id: d.id, kind: d.kind, title: d.title, state: d.status };
  const kind = String(d.kind);
  if (ITEM_KINDS.includes(kind) && d.project !== undefined) e.parent = d.project;
  if (kind === 'project' && d.initiative !== undefined) e.parent = d.initiative;
  if (d.needs !== undefined) e.needs = d.needs;
  if (d['decided-by'] !== undefined) e.decider = d['decided-by'];
  e.classification = d.classification ?? layout.defaultClassification;
  for (const k of layout.optionalKeys) {
    if (k === 'classification' || d[k] === undefined) continue;
    e[k] = k === 'estimate_tokens' || k === 'tier_hint' ? intOrSame(d[k]) : d[k];
  }
  return e;
}

/**
 * The stored keys from entity fields (the reverse of `toEntity`, for writing). Fields the
 * format has no key for are returned in `unsupported` so the caller can refuse them.
 * @param {Record<string, unknown>} fields entity fields (`state`, `parent`, ...) and stored extras
 * @param {string} kind
 * @param {import('./config.mjs').Layout} layout
 * @returns {{ stored: Record<string, unknown>, unsupported: string[] }}
 */
export function toStored(fields, kind, layout) {
  /** @type {Record<string, unknown>} */
  const stored = {};
  /** @type {string[]} */
  const unsupported = [];
  const allowed = new Set(allowedKeys(kind, layout));
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'state') stored.status = v;
    else if (k === 'parent') stored[ITEM_KINDS.includes(kind) ? 'project' : 'initiative'] = v;
    else if (k === 'decider') stored['decided-by'] = v;
    else if (k === 'schema_version' || k === 'body' || k === 'path' || k === 'version') continue;
    else if (allowed.has(k)) stored[k] = v;
    else unsupported.push(k);
  }
  if (kind === 'initiative' && 'parent' in fields) {
    unsupported.push('parent');
    delete stored.initiative;
  }
  return { stored, unsupported };
}

/**
 * Apply a patch to stored keys. A null value removes a key. The result keeps list keys as lists.
 * @param {Record<string, unknown>} stored
 * @param {Record<string, unknown>} patch stored-key names
 * @param {import('./config.mjs').Layout} layout
 */
export function applyPatch(stored, patch, layout) {
  const out = { ...stored };
  const lists = listKeys(layout);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = lists.has(k) ? list(v) : Array.isArray(v) ? v : String(v);
  }
  return out;
}
