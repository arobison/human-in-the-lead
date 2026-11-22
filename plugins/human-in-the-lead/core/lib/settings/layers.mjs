// Settings in four layers (design part 13.4): person, machine, project and run.
//
// A key's home layer is where it lives; the other layers may only tighten it.
//
// - Caps take the smallest: the person's appetite, the machine's maximum, the project's cap and the
//   run's cap. The project's cap always has a value (its default), so it always counts.
// - The reserve and the thresholds take the most cautious (the largest share). Notification shares
//   from every layer apply.
// - A port range is the overlap of the machine's and the project's.
// - A limit with the same id in the person file and policy.json takes the lower amount, hard if
//   either says so, and the larger reserve. A project's run budgets (window: run) are added.
// - The worktree root is the machine's; a project may name a subdirectory under it. The secret
//   provider is the machine's; a project may narrow auto to keychain or env.
//
// For a key whose home is the person or the machine, the default is only a fallback: it applies
// when no layer sets the key, and a person may set a looser value than the default for themselves.
//
// The migration table (13.4): these keys moved out of policy.json. For one minor version they
// still load from there, with a warning naming their new home (movedKeyWarnings); a value in
// policy.json then acts as the person's or machine's until their file sets it, and `hitld config
// migrate` moves it.

import { isAbsolute, relative, resolve } from 'node:path';
import { loadPolicy, policyDefaults } from '../policy/policy.mjs';
import { effectiveAttention } from './attention.mjs';
import { loadSettingsFile } from './files.mjs';
import { personLayer, projectStore, readStoreSettings } from './store-copy.mjs';

/**
 * @typedef {import('../schema/validate.mjs').ValidationError} ValidationError
 * @typedef {'person' | 'machine' | 'project' | 'run' | 'default'} Layer
 * @typedef {{ layer: string, value: unknown, why: string }} Overridden
 * @typedef {{ key: string, value: unknown, layer: string, overridden: Overridden[] }} Entry
 * @typedef {{ path: string, home: 'person' | 'machine' | 'project', message: string }} MovedWarning
 *
 * @typedef {object} Layers
 * @property {Record<string, any>} project the project's policy merged with the defaults
 * @property {Record<string, any>} raw policy.json as written (no defaults)
 * @property {Record<string, any> | null} person
 * @property {Record<string, any> | null} machine
 * @property {Record<string, any> | null} [run] the run's scope from run-state.json
 * @property {{ person?: number, machine?: number }} [running] executors already running elsewhere:
 *   from the person's other projects, and on this machine (the machine-wide registry, HITLD-40)
 * @property {Record<string, any>} [defaults]
 *
 * @typedef {object} Effective
 * @property {Entry[]} values
 * @property {number} cap the effective executor cap
 * @property {import('./attention.mjs').AttentionSettings} attention the effective attention budget
 * @property {Record<string, any>} policy the project policy with the layered values in place
 * @property {MovedWarning[]} warnings
 * @property {ValidationError[]} errors
 */

/**
 * Each moved key, its new home, and what a project may still do with it (design 13.4).
 * @type {readonly { path: string, home: 'person' | 'machine', still: string }[]}
 */
export const MOVED_KEYS = Object.freeze([
  { path: 'quota.limits', home: 'person', still: 'set run budgets (window: run)' },
  { path: 'quota.reserve', home: 'person', still: 'set a larger reserve' },
  { path: 'quota.economize_below', home: 'person', still: 'set an earlier threshold' },
  { path: 'quota.critical_below', home: 'person', still: 'set an earlier threshold' },
  { path: 'quota.notify_used', home: 'person', still: 'add notification shares' },
  { path: 'quota.forecast_hours', home: 'person', still: 'nothing' },
  { path: 'env.port_range', home: 'machine', still: 'narrow it to a sub-range' },
  { path: 'env.worktree_root', home: 'machine', still: 'name a subdirectory under it' },
  { path: 'env.secret_provider', home: 'machine', still: 'narrow it (auto to keychain or env)' },
]);

const FILE = { person: 'person.json', machine: 'machine.json' };

/** @param {any} obj @param {string} path @returns {any} */
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The most cautious of the values the layers set (largest wins), else the default.
 * @param {string} key @param {[Layer, unknown][]} set @param {unknown} fallback
 * @returns {Entry}
 */
function largest(key, set, fallback) {
  const given = /** @type {[Layer, number][]} */ (set.filter(([, v]) => typeof v === 'number'));
  if (!given.length) return { key, value: fallback, layer: 'default', overridden: [] };
  const [layer, value] = given.reduce((best, c) => (c[1] > best[1] ? c : best));
  return {
    key,
    value,
    layer,
    overridden: given
      .filter(([l, v]) => l !== layer && v !== value)
      .map(([l, v]) => ({
        layer: l,
        value: v,
        why: 'looser: the larger share is the more cautious',
      })),
  };
}

/**
 * The executor cap: the smallest of the person's and machine's maximum (less what already runs
 * under them), the project's cap and the run's cap.
 * @param {Layers} l @returns {Entry}
 */
function capEntry(l) {
  /** @type {[Layer, number][]} */
  const set = [];
  const person = get(l.person, 'max_executors');
  if (typeof person === 'number')
    set.push(['person', Math.max(0, person - (l.running?.person ?? 0))]);
  const machine = get(l.machine, 'max_executors');
  if (typeof machine === 'number') {
    set.push(['machine', Math.max(0, machine - (l.running?.machine ?? 0))]);
  }
  const projectSet = get(l.raw, 'execution.max_executors.value') !== undefined;
  set.push([projectSet ? 'project' : 'default', l.project.execution.max_executors.value]);
  const run = get(l.run, 'max_executors');
  if (typeof run === 'number') set.push(['run', run]);
  const [layer, value] = set.reduce((best, c) => (c[1] < best[1] ? c : best));
  return {
    key: 'executors.cap',
    value,
    layer,
    overridden: set
      .filter(([lay, v]) => lay !== layer && v !== value)
      .map(([lay, v]) => ({ layer: lay, value: v, why: 'looser: the smallest cap wins' })),
  };
}

/**
 * Tighten a limit with another of the same id: the lower amount, hard if either is, the larger
 * reserve. Limits that differ in unit or window cannot be compared, so the home one stands.
 * @param {Record<string, any>} home @param {Record<string, any>} extra
 * @returns {{ limit: Record<string, any>, comparable: boolean }}
 */
export function tightenLimit(home, extra) {
  if (home.unit !== extra.unit || home.window !== extra.window) {
    return { limit: home, comparable: false };
  }
  const out = { ...home };
  if (extra.limit != null && (home.limit == null || extra.limit < home.limit))
    out.limit = extra.limit;
  if (extra.hard) out.hard = true;
  if (extra.reserve !== undefined && !(home.reserve >= extra.reserve)) out.reserve = extra.reserve;
  return { limit: out, comparable: true };
}

/** @param {Record<string, any>} limit */
const isRunBudget = (limit) => limit.window === 'run';

/**
 * The effective limits. The base list is the person's, else (for now) the project's own non-run
 * limits, else the defaults. Every project limit then tightens the one with its id, or is added.
 * @param {Layers} l @param {Record<string, any>} defaults
 * @returns {{ limits: Record<string, any>[], entries: Entry[] }}
 */
function limitsOf(l, defaults) {
  const personLimits = get(l.person, 'quota.limits');
  /** @type {Record<string, any>[]} */
  const projectLimits = get(l.raw, 'quota.limits') ?? [];
  const projectHome = projectLimits.filter((x) => !isRunBudget(x));
  /** @type {Layer} */
  let baseLayer = 'default';
  /** @type {Record<string, any>[]} */
  let base = defaults.quota.limits;
  if (Array.isArray(personLimits)) {
    baseLayer = 'person';
    base = personLimits;
  } else if (projectHome.length) {
    baseLayer = 'project';
    base = projectHome;
  }
  /** @type {Map<string, Entry>} */
  const byId = new Map();
  for (const limit of base) {
    byId.set(limit.id, {
      key: `quota.limits.${limit.id}`,
      value: limit,
      layer: baseLayer,
      overridden: [],
    });
  }
  for (const limit of projectLimits) {
    const entry = byId.get(limit.id);
    if (!entry) {
      byId.set(limit.id, {
        key: `quota.limits.${limit.id}`,
        value: limit,
        layer: 'project',
        overridden: [],
      });
      continue;
    }
    if (entry.layer === 'project') continue;
    const { limit: tightened, comparable } = tightenLimit(
      /** @type {Record<string, any>} */ (entry.value),
      limit,
    );
    if (!comparable) {
      entry.overridden.push({
        layer: 'project',
        value: limit,
        why: 'a different unit or window from the limit with this id, so it has no effect',
      });
    } else if (same(tightened, entry.value)) {
      entry.overridden.push({ layer: 'project', value: limit, why: 'no stricter than this limit' });
    } else {
      entry.overridden.push({
        layer: entry.layer,
        value: entry.value,
        why: 'tightened by the project',
      });
      entry.value = tightened;
      entry.layer = `${entry.layer}+project`;
    }
  }
  const entries = [...byId.values()];
  return { limits: entries.map((e) => /** @type {Record<string, any>} */ (e.value)), entries };
}

/**
 * @param {Layers} l @param {Record<string, any>} defaults @param {ValidationError[]} errors
 * @returns {Entry}
 */
function portRangeOf(l, defaults, errors) {
  const m = get(l.machine, 'env.port_range');
  const p = get(l.raw, 'env.port_range');
  const key = 'env.port_range';
  for (const [layer, r] of /** @type {[string, any][]} */ ([
    ['machine', m],
    ['project', p],
  ])) {
    if (r && r.min > r.max) {
      errors.push({ path: `${layer} ${key}`, message: `is empty (${r.min} to ${r.max})` });
    }
  }
  if (!m && !p) return { key, value: defaults.env.port_range, layer: 'default', overridden: [] };
  if (!m) return { key, value: p, layer: 'project', overridden: [] };
  if (!p) return { key, value: m, layer: 'machine', overridden: [] };
  const value = { min: Math.max(m.min, p.min), max: Math.min(m.max, p.max) };
  if (value.min > value.max) {
    errors.push({
      path: key,
      message: `the project's range ${p.min} to ${p.max} does not overlap the machine's ${m.min} to ${m.max}`,
    });
  }
  if (same(value, p)) {
    return {
      key,
      value,
      layer: 'project',
      overridden: same(m, p)
        ? []
        : [{ layer: 'machine', value: m, why: 'narrowed by the project' }],
    };
  }
  if (same(value, m)) {
    return {
      key,
      value,
      layer: 'machine',
      overridden: [{ layer: 'project', value: p, why: 'wider than the machine allows' }],
    };
  }
  return {
    key,
    value,
    layer: 'machine+project',
    overridden: [
      { layer: 'machine', value: m, why: 'the overlap of the two ranges' },
      { layer: 'project', value: p, why: 'the overlap of the two ranges' },
    ],
  };
}

/** @param {string} parent @param {string} child */
const inside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** @param {Layers} l @param {ValidationError[]} errors @returns {Entry} */
function worktreeRootOf(l, errors) {
  const key = 'env.worktree_root';
  const m = get(l.machine, key);
  const p = get(l.raw, key);
  if (m !== undefined && !isAbsolute(m)) {
    errors.push({
      path: `machine ${key}`,
      message: `must be an absolute path; got ${JSON.stringify(m)}`,
    });
  }
  if (m === undefined) {
    return p === undefined
      ? { key, value: null, layer: 'default', overridden: [] }
      : { key, value: p, layer: 'project', overridden: [] };
  }
  if (p === undefined) return { key, value: m, layer: 'machine', overridden: [] };
  const candidate = isAbsolute(p) ? p : resolve(m, p);
  if (inside(m, candidate)) {
    return {
      key,
      value: candidate,
      layer: 'machine+project',
      overridden: [
        { layer: 'machine', value: m, why: 'the project names a subdirectory under it' },
      ],
    };
  }
  return {
    key,
    value: m,
    layer: 'machine',
    overridden: [
      {
        layer: 'project',
        value: p,
        why: "outside the machine's worktree root, so it has no effect",
      },
    ],
  };
}

/** @param {Layers} l @param {Record<string, any>} defaults @returns {Entry} */
function secretProviderOf(l, defaults) {
  const key = 'env.secret_provider';
  const m = get(l.machine, key);
  const p = get(l.raw, key);
  if (m === undefined) {
    return p === undefined
      ? { key, value: defaults.env.secret_provider, layer: 'default', overridden: [] }
      : { key, value: p, layer: 'project', overridden: [] };
  }
  if (p === undefined || p === m) return { key, value: m, layer: 'machine', overridden: [] };
  if (m === 'auto') {
    return {
      key,
      value: p,
      layer: 'project',
      overridden: [{ layer: 'machine', value: m, why: 'narrowed by the project' }],
    };
  }
  return {
    key,
    value: m,
    layer: 'machine',
    overridden: [
      { layer: 'project', value: p, why: 'a project may narrow auto, never widen or change it' },
    ],
  };
}

/**
 * Warnings for moved keys that policy.json still sets and that still act as their home's value.
 * @param {Layers} l @param {{ person: string, machine: string }} [paths] the settings files, for messages
 * @returns {MovedWarning[]}
 */
export function movedKeyWarnings(l, paths = FILE) {
  /** @type {MovedWarning[]} */
  const out = [];
  for (const { path, home, still } of MOVED_KEYS) {
    const value = get(l.raw, path);
    if (value === undefined) continue;
    const homeData = home === 'person' ? l.person : l.machine;
    const homeSets = get(homeData, path) !== undefined;
    let acts;
    if (path === 'quota.limits') acts = value.some((/** @type {any} */ x) => !isRunBudget(x));
    else if (path === 'quota.forecast_hours') acts = true;
    else if (path === 'env.worktree_root') acts = isAbsolute(value);
    else acts = !homeSets;
    if (!acts) continue;
    const what = path === 'quota.limits' ? 'its limits other than run budgets' : path;
    out.push({
      path,
      home,
      message: `policy.json sets ${what}, which moved to the ${home} file (${paths[home]}); it still loads for now. A project may still ${still}. Run hitld config migrate to move it.`,
    });
  }
  return out;
}

/**
 * Layer the settings and build the effective policy.
 * @param {Layers} l @returns {Effective}
 */
export function effectiveSettings(l) {
  const defaults = l.defaults ?? policyDefaults();
  /** @type {ValidationError[]} */
  const errors = [];
  const cap = capEntry(l);
  /** @type {Entry[]} */
  const values = [cap];
  for (const k of ['reserve', 'economize_below', 'critical_below']) {
    values.push(
      largest(
        `quota.${k}`,
        [
          ['person', get(l.person, `quota.${k}`)],
          ['project', get(l.raw, `quota.${k}`)],
        ],
        defaults.quota[k],
      ),
    );
  }
  const notify = /** @type {[Layer, number[] | undefined][]} */ ([
    ['person', get(l.person, 'quota.notify_used')],
    ['project', get(l.raw, 'quota.notify_used')],
  ]).filter(([, v]) => Array.isArray(v));
  values.push(
    notify.length
      ? {
          key: 'quota.notify_used',
          value: [...new Set(notify.flatMap(([, v]) => /** @type {number[]} */ (v)))].sort(
            (a, b) => a - b,
          ),
          layer: notify.map(([lay]) => lay).join('+'),
          overridden: [],
        }
      : {
          key: 'quota.notify_used',
          value: defaults.quota.notify_used,
          layer: 'default',
          overridden: [],
        },
  );
  const fhPerson = get(l.person, 'quota.forecast_hours');
  const fhProject = get(l.raw, 'quota.forecast_hours');
  values.push(
    fhPerson !== undefined
      ? {
          key: 'quota.forecast_hours',
          value: fhPerson,
          layer: 'person',
          overridden:
            fhProject !== undefined && fhProject !== fhPerson
              ? [
                  {
                    layer: 'project',
                    value: fhProject,
                    why: 'a person setting; the project value has no effect',
                  },
                ]
              : [],
        }
      : fhProject !== undefined
        ? { key: 'quota.forecast_hours', value: fhProject, layer: 'project', overridden: [] }
        : {
            key: 'quota.forecast_hours',
            value: defaults.quota.forecast_hours,
            layer: 'default',
            overridden: [],
          },
  );
  const limits = limitsOf(l, defaults);
  values.push(...limits.entries);
  const ports = portRangeOf(l, defaults, errors);
  const root = worktreeRootOf(l, errors);
  const secrets = secretProviderOf(l, defaults);
  values.push(ports, root, secrets);
  const attention = effectiveAttention(l, errors);
  values.push(...attention.entries);
  // The orchestrator's handover thresholds live in the project only (HITLD-795).
  for (const k of ['handover_context_share', 'handover_after_completions']) {
    const set = get(l.raw, `orchestrator.${k}`);
    values.push({
      key: `orchestrator.${k}`,
      value: set ?? l.project.orchestrator?.[k] ?? defaults.orchestrator[k],
      layer: set === undefined ? 'default' : 'project',
      overridden: [],
    });
  }

  const policy = structuredClone(l.project);
  const valueOf = (/** @type {string} */ key) => values.find((e) => e.key === key)?.value;
  for (const k of [
    'reserve',
    'economize_below',
    'critical_below',
    'notify_used',
    'forecast_hours',
  ]) {
    policy.quota[k] = valueOf(`quota.${k}`);
  }
  policy.quota.limits = limits.limits;
  policy.env.port_range = ports.value;
  if (root.value == null) delete policy.env.worktree_root;
  else policy.env.worktree_root = root.value;
  policy.env.secret_provider = secrets.value;

  return {
    values,
    cap: /** @type {number} */ (cap.value),
    attention: attention.attention,
    policy,
    warnings: movedKeyWarnings(l),
    errors,
  };
}

/**
 * Whether the first-run setup is done (design part 13.4): both the person settings and the machine
 * file exist. Until then, conservative defaults apply and autonomous dispatch waits.
 *
 * The person settings may come from the project's store (HITLD-148): then they are not missing,
 * and `from_store` says so. When the store was expected and could not be read, nothing is asked
 * that the store would answer: the person settings are not missing, the session runs on the
 * conservative defaults (one executor, the default reserve, no declared limits), and
 * `conservative` says what could not be read and why (HITLD-163).
 * @param {{ person: { present: boolean, store?: { state: string, reason?: string, machine?: boolean } | null, source?: string }, machine: { present: boolean } }} files
 *   the `files` that loadEffectivePolicy reports
 * @returns {{ done: boolean, missing: string[], reason: string | null, from_store: string[], conservative: string | null }}
 */
export function setupState(files) {
  const person = files.person ?? { present: false };
  const store = person.store ?? null;
  const fromStore = [
    ...(person.source === 'store' || person.source === 'store-and-file' ? ['person'] : []),
    ...(store?.state === 'read' && store.machine ? ['machine answers'] : []),
  ];
  const conservative =
    store?.state === 'unreadable' && person.source === 'none'
      ? `the person settings were not read from the project's store (${store.reason ?? 'no reason given'}); conservative defaults apply: one executor, the default reserve, no declared limits`
      : null;
  const has = {
    person:
      person.present ||
      (person.source !== undefined && person.source !== 'none') ||
      conservative !== null,
    machine: files.machine?.present === true,
  };
  const missing = /** @type {const} */ (['person', 'machine']).filter((k) => !has[k]);
  return {
    done: missing.length === 0,
    missing,
    reason: missing.length
      ? `setup not done: run the first-run setup (missing the ${missing.join(' and ')} file)`
      : null,
    from_store: fromStore,
    conservative,
  };
}

/**
 * Load policy.json and the person and machine files, and layer them.
 * @param {{ cwd?: string, path?: string, env?: NodeJS.ProcessEnv, home?: string, run?: Record<string, any> | null,
 *   running?: { person?: number, machine?: number }, uid?: number,
 *   policyResult?: import('../policy/policy.mjs').PolicyResult, store?: string | null }} [options]
 *   policyResult: an already loaded policy, so it is not read twice; store: the project's private
 *   store, where the settings that travel are read (default: the project's own, from its ID)
 */
export function loadEffectivePolicy(options = {}) {
  const loaded = options.policyResult ?? loadPolicy({ cwd: options.cwd, path: options.path });
  const fileOptions = { env: options.env, home: options.home, uid: options.uid };
  const person = loadSettingsFile('person', fileOptions);
  const machine = loadSettingsFile('machine', fileOptions);
  // The settings that travel in the project's own store (HITLD-148), for a project read from a file.
  const env = options.env ?? process.env;
  const projectId = loaded.path !== null ? loaded.policy?.project?.id : null;
  const storeRoot =
    options.store !== undefined
      ? options.store
      : projectStore(projectId, { env, ...(options.home ? { home: options.home } : {}) });
  const fromStore = projectId
    ? readStoreSettings(storeRoot, { projectId, env })
    : readStoreSettings(null, { projectId: '', env });
  const layer = personLayer(person.errors.length ? null : person.data, fromStore, env);
  const files = {
    policy: { path: loaded.path, present: loaded.path !== null },
    person: {
      path: person.path,
      present: person.present,
      source: layer.source,
      store: storeSummary(fromStore, layer),
    },
    machine: { path: machine.path, present: machine.present },
  };
  if (!loaded.policy) {
    return { ...loaded, project: null, policy: null, settings: null, files, warnings: [] };
  }
  const layers = {
    project: loaded.policy,
    raw: loaded.raw ?? {},
    person: layer.person,
    machine: machine.data,
    run: options.run ?? null,
    running: options.running,
  };
  const eff = effectiveSettings(layers);
  // The person settings were expected from the store and not read (HITLD-163): one executor, so
  // every reader of the cap (the plan, config explain, idle slots) sees the same number.
  const conservative = setupState(files).conservative;
  if (conservative && eff.cap > 1) {
    const entry = eff.values.find((e) => e.key === 'executors.cap');
    if (entry) {
      entry.overridden = [
        { layer: entry.layer, value: entry.value, why: 'the store was not read: one executor' },
        ...entry.overridden,
      ];
      entry.value = 1;
      entry.layer = 'default';
    }
    eff.cap = 1;
  }
  const errors = [...person.errors, ...machine.errors, ...eff.errors];
  return {
    path: loaded.path,
    hash: loaded.hash,
    raw: loaded.raw,
    project: loaded.policy,
    policy: errors.length ? null : eff.policy,
    errors,
    warnings: [
      ...movedKeyWarnings(layers, { person: person.path, machine: machine.path }),
      ...renamedWarnings(loaded.renamed, person.renamed, machine.renamed),
      ...storeWarnings(person.path, layer, fromStore),
    ],
    settings: { cap: eff.cap, attention: eff.attention, values: eff.values },
    layers: { person: layer.person, machine: machine.data },
    store_settings: fromStore,
    files,
  };
}

/**
 * What files.person says about the store's copy: its state, and why it was not read.
 * @param {import('./store-copy.mjs').StoreSettings} s
 * @param {ReturnType<typeof personLayer>} layer
 */
const storeSummary = (s, layer) =>
  s.state === 'none' && !s.pulled_at
    ? null
    : {
        state: s.state,
        ...(s.pulled_at ? { pulled_at: s.pulled_at } : {}),
        ...(s.reason ? { reason: s.reason } : {}),
        ...(s.machine ? { machine: true } : {}),
        ...(layer.differs.length ? { replaced: layer.differs } : {}),
        ...(layer.ignored ? { local_file_ignored: true } : {}),
      };

/**
 * The warnings about the store's copy: a local value it replaced, a local file set aside, or a
 * copy that could not be read while the local file stands.
 * @param {string} path the person file
 * @param {ReturnType<typeof personLayer>} layer
 * @param {import('./store-copy.mjs').StoreSettings} s
 * @returns {MovedWarning[]}
 */
function storeWarnings(path, layer, s) {
  /** @type {MovedWarning[]} */
  const out = [];
  if (layer.differs.length) {
    out.push({
      path,
      home: 'person',
      message: `${layer.differs.join(', ')} in ${path} differ from the project's store, whose values apply: the store is where these settings live (change them with hitld config write person, then hitld store push)`,
    });
  }
  if (layer.ignored) {
    out.push({
      path,
      home: 'person',
      message: `${path} is not used for the settings that travel in the store: in a cloud session a copy left in the container may be stale, and ${s.reason}`,
    });
  } else if (s.state === 'unreadable' && layer.source === 'file') {
    out.push({
      path,
      home: 'person',
      message: `the project's store was not read (${s.reason}); ${path} applies`,
    });
  }
  return out;
}

/**
 * The warnings for settings read under their names before HITLD-82.
 * @param {...(import('./renamed.mjs').RenamedSetting[] | undefined)} lists
 * @returns {MovedWarning[]}
 */
const renamedWarnings = (...lists) =>
  lists.flatMap((l, i) =>
    (l ?? []).map((r) => ({
      path: r.from,
      home: /** @type {MovedWarning['home']} */ (['project', 'person', 'machine'][i]),
      message: r.message,
    })),
  );

/** A value for people: limits and ranges in words, everything else as JSON. @param {any} v */
const show = (v) => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'unit' in v && 'window' in v) {
    const extras = [
      v.hard ? 'hard' : 'soft',
      ...(v.reserve != null ? [`reserve ${v.reserve}`] : []),
    ];
    return `${v.limit ?? 'unknown'} ${v.unit} per ${v.window} (${extras.join(', ')})`;
  }
  if (v && typeof v === 'object' && 'min' in v && 'max' in v) return `${v.min} to ${v.max}`;
  return JSON.stringify(v);
};

/**
 * The explanation for people: one line per value, its layer, and what it overrode.
 * @param {Entry[]} values @returns {string}
 */
export function explainText(values) {
  const width = Math.max(...values.map((e) => e.key.length)) + 2;
  return values
    .map((e) => {
      const head = `${e.key.padEnd(width)}${show(e.value)}  [${e.layer}]`;
      const over = e.overridden.map(
        (o) => `\n${' '.repeat(width)}  over ${o.layer} ${show(o.value)}: ${o.why}`,
      );
      return head + over.join('');
    })
    .join('\n');
}
