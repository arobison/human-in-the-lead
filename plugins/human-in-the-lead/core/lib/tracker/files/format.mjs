// The reference file format (generalized by settings; design part 16.7):
// kinds, statuses, the allowlist of front-matter keys per kind, and how the stored keys map to
// the tracker's entity fields (design part 3.2).
//
// The stored names are the consumer's: `status`, `project` (an item's parent), `initiative` (a
// project's parent), `decided-by`, `claimed`. The entity the adapter hands out uses the model's
// names: `state`, `parent`, `decider`. The mapping is here, in one place. A milestone's parent is
// a project or an initiative, stored under the key of its kind.

import { ITEM_KINDS, list } from './graph.mjs';
import { MILESTONE_KINDS, milestoneFields, storedMilestoneField } from './milestones.mjs';

export const KINDS = ['work', 'decision', 'external', 'project', 'initiative', ...MILESTONE_KINDS];
export const STATUSES = ['Proposed', 'Planned', 'In progress', 'Done', 'Dropped'];

/** Folder group per kind: containers and milestones have their own, every item kind shares one. */
export const FOLDER_GROUP = /** @type {const} */ ({
  initiative: 'initiative',
  project: 'project',
  work: 'item',
  decision: 'item',
  external: 'item',
  capability: 'milestone',
  learning: 'milestone',
});

const COMMON_KEYS = ['id', 'title', 'kind', 'status', 'created'];

/** The stored milestone keys (design part 3.2, Milestone). */
const MILESTONE_KEYS = [
  ...COMMON_KEYS,
  'project',
  'initiative',
  'outcome',
  'done_when',
  'needs',
  'serves',
  'appetite_tokens',
  'deadline',
  'check',
  'check_results',
  'reason',
];

/**
 * The stored keys of an answered decision (design part 3.2, Decision), under the model's own
 * names: the answer, its rationale, when, through which channel and by whom, the precedent made
 * from it, and the precedent that resolved it when no person answered. Filled on answering.
 */
export const DECISION_ANSWER_KEYS = [
  'answer',
  'rationale',
  'answered_at',
  'answered_via',
  'answered_by',
  'precedent',
  'resolved_by_precedent',
];

/** The allowlist: any key not listed for an item's kind is an error. */
export const KEYS = /** @type {Record<string, string[]>} */ ({
  work: [...COMMON_KEYS, 'project', 'needs', 'claimed', 'reason'],
  decision: [
    ...COMMON_KEYS,
    'project',
    'needs',
    'claimed',
    'reason',
    'decided-by',
    ...DECISION_ANSWER_KEYS,
  ],
  external: [...COMMON_KEYS, 'project', 'needs', 'claimed', 'reason', 'party'],
  project: [...COMMON_KEYS, 'initiative', 'lead', 'plan', 'reason'],
  initiative: [...COMMON_KEYS, 'lead', 'reason'],
  capability: MILESTONE_KEYS,
  learning: MILESTONE_KEYS,
});

/**
 * Keys the format no longer has, and why. `hitld work migrate` removes them (the migrations
 * milestone-entities and retire-priority); the check names them with this reason.
 */
export const RETIRED_KEYS = /** @type {Record<string, string>} */ ({
  milestone: 'milestones are their own files now (design part 3.2)',
  milestones: 'milestones are their own files now (design part 3.2)',
  priority: 'order is derived (design part 2.4, Q30)',
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

/** Stored keys that hold a list, whatever the settings. */
const LIST_KEYS = ['needs', 'done_when', 'serves', 'check_results'];

/**
 * The keys that hold a list, given the settings.
 * @param {import('./config.mjs').Layout} layout
 */
export const listKeys = (layout) =>
  new Set([
    ...LIST_KEYS,
    ...layout.optionalKeys.filter((k) => OPTIONAL_LISTS.includes(k)),
    ...layout.fields.filter((f) => f.list).map((f) => f.name),
  ]);

/**
 * The allowed keys for a kind, given the settings.
 * @param {string} kind @param {import('./config.mjs').Layout} layout
 */
export const allowedKeys = (kind, layout) => [
  ...KEYS[kind],
  ...layout.optionalKeys,
  ...layout.fields.map((f) => f.name),
];

/** The key order a file is written in: the reference order, then the optional keys. */
export const keyOrder = (
  /** @type {string} */ kind,
  /** @type {import('./config.mjs').Layout} */ layout,
) => allowedKeys(kind, layout);

/** The stored keys with no entity field of their own: carried through under the same names. */
export const NATIVE_EXTRAS = ['created', 'claimed', 'reason', 'party', 'lead', 'plan'];

/**
 * Names a declared field may not take: every key and entity field the format already uses, and
 * every key some tool would run as code. Computed from the lists above, so a new key is covered.
 * @param {string[]} optionalNames the names tracker.json optional_keys may turn on
 * @returns {Set<string>}
 */
export const reservedFieldNames = (optionalNames) =>
  new Set([
    ...Object.values(KEYS).flat(),
    ...Object.keys(RETIRED_KEYS),
    ...optionalNames,
    ...NATIVE_EXTRAS,
    ...CODE_KEYS,
    'state',
    'parent',
    'decider',
    'body',
    'path',
    'version',
    'schema_version',
    'api_version',
  ]);

/** @param {unknown} v */
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

/**
 * Read one value as a declared field's type.
 * @param {import('./config.mjs').DeclaredField} def
 * @param {unknown} raw a stored string, or a value of the type already
 * @returns {{ value: string | number | boolean } | { error: string }}
 */
export function parseFieldValue(def, raw) {
  const text = typeof raw === 'string' ? raw : typeof raw === 'object' ? '' : String(raw);
  const bad = (/** @type {string} */ want) => ({ error: `must be ${want}, got ${show(raw)}` });
  if (def.type === 'integer') {
    return typeof raw === 'number' && Number.isInteger(raw)
      ? { value: raw }
      : /^-?\d+$/.test(text)
        ? { value: Number(text) }
        : bad('a whole number');
  }
  if (def.type === 'number') {
    return typeof raw === 'number' && Number.isFinite(raw)
      ? { value: raw }
      : /^-?\d+(\.\d+)?$/.test(text)
        ? { value: Number(text) }
        : bad('a number');
  }
  if (def.type === 'boolean') {
    return typeof raw === 'boolean'
      ? { value: raw }
      : text === 'true' || text === 'false'
        ? { value: text === 'true' }
        : bad('true or false');
  }
  if (typeof raw !== 'string') return bad('text');
  if (def.values && !def.values.includes(raw)) return bad(`one of ${def.values.join(', ')}`);
  return { value: raw };
}

/**
 * A declared field's entity value from its stored form: typed, a list for a list field. A value
 * that is not of the type is carried through as stored, so the check can name it.
 * @param {import('./config.mjs').DeclaredField} def @param {unknown} stored
 */
export function fieldValue(def, stored) {
  const one = (/** @type {unknown} */ v) => {
    const r = parseFieldValue(def, v);
    return 'value' in r ? r.value : v;
  };
  return def.list ? list(stored).map(one) : one(stored);
}

/**
 * Problems with a file's declared field values.
 * @param {Record<string, unknown>} d stored keys @param {import('./config.mjs').Layout} layout
 * @returns {string[]}
 */
export function fieldProblems(d, layout) {
  /** @type {string[]} */
  const problems = [];
  for (const def of layout.fields) {
    if (d[def.name] === undefined) continue;
    for (const v of list(d[def.name])) {
      const r = parseFieldValue(def, v);
      if ('error' in r) problems.push(`"${def.name}" ${r.error}`);
    }
  }
  return problems;
}

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
  const milestone = MILESTONE_KINDS.includes(kind);
  if ((ITEM_KINDS.includes(kind) || milestone) && d.project !== undefined) e.parent = d.project;
  if ((kind === 'project' || milestone) && d.initiative !== undefined) e.parent = d.initiative;
  if (milestone) Object.assign(e, milestoneFields(d));
  else if (d.needs !== undefined) e.needs = d.needs;
  if (d['decided-by'] !== undefined) e.decider = d['decided-by'];
  if (kind === 'decision') {
    for (const k of DECISION_ANSWER_KEYS) if (d[k] !== undefined) e[k] = d[k];
  }
  e.classification = d.classification ?? layout.defaultClassification;
  for (const k of layout.optionalKeys) {
    if (k === 'classification' || d[k] === undefined) continue;
    e[k] = k === 'estimate_tokens' || k === 'tier_hint' ? intOrSame(d[k]) : d[k];
  }
  for (const def of layout.fields) {
    if (d[def.name] !== undefined) e[def.name] = fieldValue(def, d[def.name]);
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
  const milestone = MILESTONE_KINDS.includes(kind);
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'state') stored.status = v;
    else if (k === 'parent' && milestone) {
      // A milestone's parent is a project unless parent_kind names an initiative.
      const key = fields.parent_kind === 'initiative' ? 'initiative' : 'project';
      stored[key] = v;
      stored[key === 'project' ? 'initiative' : 'project'] = null;
    } else if (k === 'parent_kind' && milestone) continue;
    else if (k === 'parent') stored[ITEM_KINDS.includes(kind) ? 'project' : 'initiative'] = v;
    else if (k === 'decider') stored['decided-by'] = v;
    else if (k === 'schema_version' || k === 'body' || k === 'path' || k === 'version') continue;
    else if (allowed.has(k)) {
      const value = storedField(k, v, layout);
      stored[k] = milestone ? storedMilestoneField(k, value) : value;
    } else unsupported.push(k);
  }
  if (kind === 'initiative' && 'parent' in fields) {
    unsupported.push('parent');
    delete stored.initiative;
  }
  return { stored, unsupported };
}

/**
 * A declared field's value for writing: checked against its type and turned into the strings the
 * file holds. Other keys pass through. A null removes the key.
 * @param {string} key @param {unknown} v @param {import('./config.mjs').Layout} layout
 */
function storedField(key, v, layout) {
  const def = layout.fields.find((f) => f.name === key);
  if (!def || v === null || v === undefined) return v;
  if (!def.list && Array.isArray(v)) throw new Error(`${key} holds one value, not a list`);
  const out = (def.list ? list(v) : [v]).map((m) => {
    const r = parseFieldValue(def, m);
    if ('error' in r) throw new Error(`${key} ${r.error}`);
    return String(r.value);
  });
  return def.list ? out : out[0];
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
