// Settings renamed by HITLD-82 (consistent names) and HITLD-121 (American spelling), read under
// their old names until the next minor release, each with a warning (design part 16.5). policy.json
// keeps its old names until the owner renames them; `hitld config migrate` rewrites the person and
// machine files.
//
// A path is dot-separated; `*` stands for any one key (a tier's number) or array member.

/**
 * @typedef {'policy' | 'person' | 'machine'} SettingsLayer
 * @typedef {{ from: string, to: string, message: string }} RenamedSetting
 */

/** Old path to new path, per file. */
export const RENAMED_SETTINGS = Object.freeze(
  /** @type {Record<SettingsLayer, readonly [string, string][]>} */ ({
    policy: [
      ['quota.owner_reserve', 'quota.reserve'],
      ['quota.economize_at', 'quota.economize_below'],
      ['quota.critical_at', 'quota.critical_below'],
      ['quota.notify_at', 'quota.notify_used'],
      ['dispatch.report_at', 'dispatch.report_at_budget_multiple'],
      ['dispatch.overlap_serialize', 'dispatch.serialize_overlap_share'],
      ['dispatch.in_person_areas', 'dispatch.owner_review_areas'],
      ['dispatch.familiar_yield', 'dispatch.familiar_min_yield'],
      ['orchestrator.context_handoff', 'orchestrator.handover_context_share'],
      ['env.lock_expiry', 'env.lock_expiry_seconds'],
      ['run.lease_expiry', 'run.lease_expiry_seconds'],
      ['rights.agent_spend_max', 'rights.agent_spend_max_tokens'],
      ['execution.concurrency', 'execution.max_executors'],
      ['tiers.*.executor', 'tiers.*.runs_as'],
      ['judgement', 'judgment'], // spelling-ok: the section before HITLD-121
    ],
    person: [
      ['executors_max', 'max_executors'],
      ['quota.owner_reserve', 'quota.reserve'],
      ['quota.economize_at', 'quota.economize_below'],
      ['quota.critical_at', 'quota.critical_below'],
      ['quota.notify_at', 'quota.notify_used'],
    ],
    machine: [
      ['executors_max', 'max_executors'],
      ['role', 'kind'],
      ['detected.role', 'detected.kind'],
      ['detected.role_hints', 'detected.kind_hints'],
    ],
  }),
);

/** Values renamed by HITLD-82: lowercase kebab-case. */
const RENAMED_VALUES = Object.freeze(
  /** @type {Record<SettingsLayer, Record<string, Record<string, string>>>} */ ({
    policy: { 'quota.limits.*.unit': { plan_percent: 'plan-percent' } },
    person: { 'quota.limits.*.unit': { plan_percent: 'plan-percent' } },
    machine: { kind: { cloud_vm: 'cloud-vm' }, 'detected.kind': { cloud_vm: 'cloud-vm' } },
  }),
);

const FILE = { policy: 'policy.json', person: 'the person file', machine: 'the machine file' };

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An object or an array (a `*` walks an array's members). @param {unknown} v @returns {v is Record<string, any>} */
const isContainer = (v) => typeof v === 'object' && v !== null;

/**
 * Every concrete path a pattern names in `data`, with the parent object and the last key.
 * @param {Record<string, any>} data @param {string[]} parts
 * @returns {{ path: string[], parent: Record<string, any>, key: string }[]}
 */
function find(data, parts) {
  /** @type {{ path: string[], parent: Record<string, any>, key: string }[]} */
  const out = [];
  /** @param {Record<string, any>} obj @param {number} i @param {string[]} at */
  const walk = (obj, i, at) => {
    const keys = parts[i] === '*' ? Object.keys(obj) : [parts[i]];
    for (const k of keys) {
      if (!Object.hasOwn(obj, k)) continue;
      if (i === parts.length - 1) out.push({ path: [...at, k], parent: obj, key: k });
      else if (isContainer(obj[k])) walk(obj[k], i + 1, [...at, k]);
    }
  };
  walk(data, 0, []);
  return out;
}

/**
 * The new path for a concrete hit: each `*` in `to` takes, in order, the key the matching `*` in
 * `from` stood for, so a pattern with several wildcards renames every one of them.
 * @param {string} from @param {string} to @param {string[]} path
 */
export function fillWildcards(from, to, path) {
  const stars = from
    .split('.')
    .map((part, i) => (part === '*' ? path[i] : null))
    .filter((k) => k !== null);
  let n = 0;
  return to
    .split('.')
    .map((part) => (part === '*' ? (stars[n++] ?? '*') : part))
    .join('.');
}

/**
 * The settings in their current names, from a file that may hold the names before HITLD-82. A
 * value under the new name wins over one under the old. The input is not changed.
 * @template T
 * @param {SettingsLayer} layer @param {T} data
 * @returns {{ data: T, renamed: RenamedSetting[] }}
 */
export function renameSettings(layer, data) {
  if (!isObject(data)) return { data, renamed: [] };
  const out = structuredClone(data);
  /** @type {RenamedSetting[]} */
  const renamed = [];
  for (const [from, to] of RENAMED_SETTINGS[layer]) {
    for (const hit of find(out, from.split('.'))) {
      const target = fillWildcards(from, to, hit.path);
      const newKey = target.split('.').at(-1) ?? target;
      if (!Object.hasOwn(hit.parent, newKey)) hit.parent[newKey] = hit.parent[hit.key];
      delete hit.parent[hit.key];
      renamed.push({
        from: hit.path.join('.'),
        to: target,
        message: `${FILE[layer]}: ${hit.path.join('.')} is now ${target}; rename it (the old name is read until the next minor release)${layer === 'policy' ? '' : ', or run hitld config migrate'}`,
      });
    }
  }
  for (const [path, values] of Object.entries(RENAMED_VALUES[layer])) {
    for (const hit of find(out, path.split('.'))) {
      const v = hit.parent[hit.key];
      if (typeof v === 'string' && Object.hasOwn(values, v)) {
        hit.parent[hit.key] = values[v];
        renamed.push({
          from: `${path}=${v}`,
          to: `${path}=${values[v]}`,
          message: `${FILE[layer]}: ${path} "${v}" is now "${values[v]}"${layer === 'policy' ? '' : '; run hitld config migrate'}`,
        });
      }
    }
  }
  return { data: /** @type {T} */ (out), renamed };
}
