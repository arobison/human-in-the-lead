// The owner's settings that travel in the project's private store (HITLD-148, decided in
// HITLD-162): a cloud container is discarded when its session ends, so the person file in its home
// directory is gone with it. The settings a session needs, and the owner's answers about kinds of
// machine, are kept in the project's own store and read by any enrolled session at start.
//
//   settings/person.json    the person settings that travel: the executor cap (max_executors), the
//                           quota (the reserve, the thresholds and declared limits) and the
//                           attention budget (with quiet hours), with their schema_version
//   settings/machine.json   the owner's answers about a kind of machine, keyed by kind (cloud-vm,
//                           workstation, ...): max_executors, memory_ceiling_mb, load, disk_floor_mb
//                           and capacity. The probe gives the rest each time.
//
// What travels names no other project (HITLD-490, HITLD-549): each project keeps its own store,
// and the person file's `projects` keys (another project's store address, a share set against
// other projects) never enter it. A copy that holds any other key is refused, not read.
//
// Written only by `hitld config write`, in the owner's own turn (executors are refused there), and
// carried to the remote by the next `hitld store push`. Read only after this machine's last pull
// reached the remote (store/last-pull.mjs) when a remote is configured: a copy the session could
// not bring up to date is not used (HITLD-163), and the session runs on the conservative defaults
// and says why.

import { chooseRemote } from '../store/address.mjs';
import { readLastPull } from '../store/last-pull.mjs';
import { cloudSession } from '../store/reach.mjs';
import { openStore, privateStorePath } from '../store/store.mjs';
import { validateSettings } from './files.mjs';
import { newerRefusal, stampLowest } from './versions.mjs';

export const PERSON_KEY = 'settings/person.json';
export const MACHINE_KEY = 'settings/machine.json';

/** The person settings that travel in the store; everything else in the person file stays here. */
export const PERSON_TRAVELS = Object.freeze(['max_executors', 'quota', 'attention']);

/** The owner's answers about a kind of machine that travel; the probe gives the rest. */
export const MACHINE_ANSWERS = Object.freeze([
  'max_executors',
  'memory_ceiling_mb',
  'load',
  'disk_floor_mb',
  'capacity',
]);

/**
 * @typedef {object} StoreSettings
 * @property {'read' | 'none' | 'unreadable'} state read: the copy is there and this machine's last
 *   pull reached the remote (or no remote is configured); none: nothing to read, and the setup asks
 *   as before; unreadable: a remote is configured and this machine could not bring the store up to
 *   date, or the copy does not load
 * @property {string | null} store the store's directory
 * @property {Record<string, any> | null} person the traveling person settings, when read
 * @property {Record<string, Record<string, any>> | null} machine the owner's answers per kind of
 *   machine, when read
 * @property {string} [pulled_at] when this machine last pulled the store from its remote
 * @property {string} [reason] unreadable: what could not be read and why
 */

/**
 * The traveling part of person settings: the keys that travel, with its schema_version.
 * @param {Record<string, any>} data @returns {Record<string, any>}
 */
export function travelingPerson(data) {
  /** @type {Record<string, any>} */
  const out = { schema_version: data.schema_version ?? 1 };
  for (const k of PERSON_TRAVELS) if (data[k] !== undefined) out[k] = structuredClone(data[k]);
  return out;
}

/**
 * The owner's answers in machine settings: the keys that travel.
 * @param {Record<string, any>} data @returns {Record<string, any>}
 */
export function machineAnswers(data) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of MACHINE_ANSWERS) if (data[k] !== undefined) out[k] = structuredClone(data[k]);
  return out;
}

/**
 * The project's store directory, or null when there is no project.
 * @param {string | null | undefined} projectId
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, repoRoot?: string }} [options]
 */
export function projectStore(projectId, options = {}) {
  if (!projectId) return null;
  try {
    return privateStorePath(projectId, options);
  } catch {
    return null;
  }
}

/**
 * Why a remote is expected and not known to be up to date here, or null when the copy may be read.
 * @param {string} root @param {string} projectId @param {NodeJS.ProcessEnv} env
 * @returns {{ problem: string | null, pulled_at?: string }}
 */
function freshness(root, projectId, env) {
  /** @type {ReturnType<typeof chooseRemote>} */
  let address = null;
  try {
    address = chooseRemote({ store: root, projectId, env });
  } catch (e) {
    return {
      problem: `the store's address cannot be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // No address: the store is this machine's own (or this session's, not enrolled), and what it
  // holds was written here.
  if (!address) return { problem: null };
  const last = readLastPull(root);
  if (!last) {
    return {
      problem:
        'the store has not been pulled in this session yet: run hitld store status for why, then hitld store pull',
    };
  }
  if (last.status !== 'done') {
    return {
      problem: `the last pull (${last.at}) ${last.status === 'unreachable' ? 'could not reach the remote' : 'failed'}: ${last.code ? `${last.code}: ` : ''}${last.message ?? 'no detail'}`,
    };
  }
  return { problem: null, pulled_at: last.at };
}

/**
 * Parse and check the traveling person settings. Returns the data, or why it is refused.
 * @param {string} text @returns {{ data: Record<string, any> } | { why: string }}
 */
function parsePerson(text) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { why: `${PERSON_KEY} is not JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { why: `${PERSON_KEY} is not an object` };
  }
  const newer = newerRefusal('person', data);
  if (newer) return { why: `${PERSON_KEY}: ${newer.message}` };
  const extra = Object.keys(data).filter(
    (k) => k !== 'schema_version' && !PERSON_TRAVELS.includes(k),
  );
  if (extra.length) {
    return {
      why: `${PERSON_KEY} holds ${extra.join(', ')}, which never travel in the store (only ${PERSON_TRAVELS.join(', ')} do)`,
    };
  }
  const errors = validateSettings('person', data);
  if (errors.length) {
    return { why: `${PERSON_KEY}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}` };
  }
  return { data };
}

/**
 * Parse and check the owner's machine answers, keyed by kind of machine.
 * @param {string} text @returns {{ data: Record<string, Record<string, any>> } | { why: string }}
 */
function parseMachine(text) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { why: `${MACHINE_KEY} is not JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { why: `${MACHINE_KEY} is not an object` };
  }
  for (const [kind, answers] of Object.entries(data)) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return { why: `${MACHINE_KEY}: ${kind} is not an object` };
    }
    const extra = Object.keys(answers).filter((k) => !MACHINE_ANSWERS.includes(k));
    if (extra.length) {
      return { why: `${MACHINE_KEY}: ${kind} holds ${extra.join(', ')}, which never travel` };
    }
    const errors = validateSettings('machine', { schema_version: 1, kind, ...answers });
    if (errors.length) {
      return {
        why: `${MACHINE_KEY}: ${kind}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
      };
    }
  }
  return { data };
}

/**
 * Read the settings that travel in the project's store.
 * @param {string | null} root the project's store, or null when there is no project
 * @param {{ projectId: string, env?: NodeJS.ProcessEnv }} o
 * @returns {StoreSettings}
 */
export function readStoreSettings(root, o) {
  /** @type {StoreSettings} */
  const none = { state: 'none', store: root, person: null, machine: null };
  if (!root) return none;
  const env = o.env ?? process.env;
  const fresh = freshness(root, o.projectId, env);
  const store = openStore(root);
  /** @type {string | null} */
  let personText = null;
  /** @type {string | null} */
  let machineText = null;
  try {
    personText = store.read(PERSON_KEY);
    machineText = store.read(MACHINE_KEY);
  } catch (e) {
    return {
      ...none,
      state: 'unreadable',
      reason: `the store cannot be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (fresh.problem) return { ...none, state: 'unreadable', reason: fresh.problem };
  const at = fresh.pulled_at ? { pulled_at: fresh.pulled_at } : {};
  if (personText === null && machineText === null) return { ...none, ...at };
  const person = personText === null ? null : parsePerson(personText);
  const machine = machineText === null ? null : parseMachine(machineText);
  const why = [person, machine].flatMap((p) => (p && 'why' in p ? [p.why] : []));
  if (why.length) {
    return {
      ...none,
      state: 'unreadable',
      reason: `the store's copy is refused: ${why.join('; ')}`,
    };
  }
  return {
    state: 'read',
    store: root,
    person: person && 'data' in person ? person.data : null,
    machine: machine && 'data' in machine ? machine.data : null,
    ...at,
  };
}

/**
 * After the owner's own `config write`: put what travels in the project's store, for the next
 * `hitld store push`. The caller has already written the settings file, which refuses executors.
 * @param {'person' | 'machine'} kind @param {Record<string, any>} data the file as written
 * @param {string} root the project's store
 * @returns {{ key: string, written: boolean, why?: string }}
 */
export function writeStoreSettings(kind, data, root) {
  const store = openStore(root);
  if (kind === 'person') {
    // Stamped with the lowest schema_version its own content needs, not the whole file's.
    const copy = stampLowest('person', travelingPerson(data));
    store.write(PERSON_KEY, JSON.stringify(copy, null, 2) + '\n');
    return { key: PERSON_KEY, written: true };
  }
  const machineKind = data.kind ?? data.role;
  if (typeof machineKind !== 'string') {
    return { key: MACHINE_KEY, written: false, why: 'the machine file names no kind of machine' };
  }
  /** @type {Record<string, any>} */
  let all = {};
  const text = store.read(MACHINE_KEY);
  if (text !== null) {
    const parsed = parseMachine(text);
    if ('data' in parsed) all = parsed.data;
  }
  all[machineKind] = machineAnswers(data);
  store.write(MACHINE_KEY, JSON.stringify(all, null, 2) + '\n');
  return { key: MACHINE_KEY, written: true };
}

/**
 * The person layer a session uses, from the local person file and the store's copy:
 *   - the store's copy read: its traveling keys over the local file's (the store is the synced
 *     source); the local file keeps what never travels
 *   - the store expected and unreadable: in a cloud session, the local file's traveling keys are
 *     not used either, since a container's leftover copy may be stale (HITLD-163); on a machine,
 *     the person's own file stands
 *   - nothing in the store: the local file as before
 * @param {Record<string, any> | null} local the local person file's data
 * @param {StoreSettings} fromStore @param {NodeJS.ProcessEnv} env
 * @returns {{ person: Record<string, any> | null, source: 'store' | 'file' | 'store-and-file' | 'none', differs: string[], ignored: boolean }}
 *   differs: traveling keys whose local value the store's replaced; ignored: the local file's
 *   traveling keys were set aside because the store could not be read in a cloud session
 */
export function personLayer(local, fromStore, env) {
  if (fromStore.state === 'read' && fromStore.person) {
    const kept = local
      ? Object.fromEntries(Object.entries(local).filter(([k]) => !PERSON_TRAVELS.includes(k)))
      : {};
    const differs = local
      ? PERSON_TRAVELS.filter(
          (k) =>
            local[k] !== undefined &&
            JSON.stringify(local[k]) !== JSON.stringify(fromStore.person?.[k]),
        )
      : [];
    return {
      person: { ...kept, ...fromStore.person },
      source: local ? 'store-and-file' : 'store',
      differs,
      ignored: false,
    };
  }
  if (fromStore.state === 'unreadable' && local && cloudSession(env)) {
    const kept = Object.fromEntries(
      Object.entries(local).filter(([k]) => !PERSON_TRAVELS.includes(k)),
    );
    const left = Object.keys(kept).some((k) => k !== 'schema_version');
    return { person: left ? kept : null, source: 'none', differs: [], ignored: true };
  }
  return { person: local, source: local ? 'file' : 'none', differs: [], ignored: false };
}
