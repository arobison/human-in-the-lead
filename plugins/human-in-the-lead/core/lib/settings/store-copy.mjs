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

import { chmodSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chooseRemote } from '../store/address.mjs';
import { MAX_AGE_HOURS, readLastPull } from '../store/last-pull.mjs';
import { cloudSession } from '../store/reach.mjs';
import { openStore, privateStorePath } from '../store/store.mjs';
import { ROLES } from '../machine/detect.mjs';
import { readTrustedFile } from '../policy/policy.mjs';
import { schemas } from '../schema/registry.mjs';
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

/** A resource name in `capacity`: plain, as policy.json names what work needs. */
const RESOURCE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

/** Why the copies are read with trusted loading, for refusals. */
const WHY = "the store's settings set caps and limits";

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
 * The last pull must have reached the remote at the address in use, within MAX_AGE_HOURS.
 * @param {string} root @param {string} projectId @param {NodeJS.ProcessEnv} env
 * @param {() => Date} now
 * @returns {{ problem: string | null, pulled_at?: string }}
 */
function freshness(root, projectId, env, now) {
  /** @type {ReturnType<typeof chooseRemote>} */
  let address = null;
  try {
    address = chooseRemote({ store: root, projectId, env });
  } catch (e) {
    return {
      problem: `the store's address cannot be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // No address: the session is not enrolled, so there is no store to bring up to date, and what
  // this store holds was written here. The setup runs as before (HITLD-148, Done when).
  if (!address) return { problem: null };
  const pull = 'run hitld store status for why, then hitld store pull';
  const last = readLastPull(root);
  if (!last) return { problem: `the store has not been pulled in this session yet: ${pull}` };
  if (last.status !== 'done') {
    return {
      problem: `the last pull (${last.at}) ${last.status === 'unreachable' ? 'could not reach the remote' : 'failed'}: ${last.code ? `${last.code}: ` : ''}${last.message ?? 'no detail'}`,
    };
  }
  if (last.url !== address.url) {
    return {
      problem: `the last pull (${last.at}) was made against another store address than the one in use: ${pull}`,
    };
  }
  const age = now().getTime() - Date.parse(last.at);
  if (!(age >= 0 && age <= MAX_AGE_HOURS * 3600_000)) {
    return {
      problem: `the last pull that reached the remote (${last.at}) is more than ${MAX_AGE_HOURS} hours old: ${pull}`,
    };
  }
  return { problem: null, pulled_at: last.at };
}

/** The top-level keys a file of this kind may name, so a refusal names only those. */
const known = (/** @type {'person' | 'machine'} */ kind) =>
  new Set(Object.keys(/** @type {any} */ (schemas().get(kind))?.properties ?? {}));

/**
 * The keys of an object that are not allowed, named only when the schema knows them; the rest are
 * counted, so a refusal never echoes the file's own content.
 * @param {string[]} extra @param {'person' | 'machine'} kind
 */
function extraKeys(extra, kind) {
  const names = known(kind);
  const named = extra.filter((k) => names.has(k));
  const others = extra.length - named.length;
  return [...named, ...(others ? [`${others} unknown key${others === 1 ? '' : 's'}`] : [])].join(
    ', ',
  );
}

/** @param {unknown} v */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Parse and check the traveling person settings. Returns the data, or why it is refused. A reason
 * never holds the file's own text.
 * @param {string} text @returns {{ data: Record<string, any> } | { why: string }}
 */
function parsePerson(text) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { why: `${PERSON_KEY} is not valid JSON` };
  }
  if (!isObject(data)) return { why: `${PERSON_KEY} is not an object` };
  const newer = newerRefusal('person', data);
  if (newer) return { why: `${PERSON_KEY}: ${newer.message}` };
  const extra = Object.keys(data).filter(
    (k) => k !== 'schema_version' && !PERSON_TRAVELS.includes(k),
  );
  if (extra.length) {
    return {
      why: `${PERSON_KEY} holds ${extraKeys(extra, 'person')}, which never travel in the store (only ${PERSON_TRAVELS.join(', ')} do)`,
    };
  }
  const errors = validateSettings('person', data);
  if (errors.length) {
    return {
      why: `${PERSON_KEY} does not match the person schema (${errors.length} problem${errors.length === 1 ? '' : 's'}); hitld config write person replaces it`,
    };
  }
  return { data };
}

/**
 * Parse and check the owner's machine answers, keyed by kind of machine. A reason never holds the
 * file's own text.
 * @param {string} text @returns {{ data: Record<string, Record<string, any>> } | { why: string }}
 */
function parseMachine(text) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { why: `${MACHINE_KEY} is not valid JSON` };
  }
  if (!isObject(data)) return { why: `${MACHINE_KEY} is not an object` };
  for (const [kind, answers] of Object.entries(data)) {
    if (!(/** @type {readonly string[]} */ (ROLES).includes(kind))) {
      return {
        why: `${MACHINE_KEY} names a kind of machine that is not one of ${ROLES.join(', ')}`,
      };
    }
    if (!isObject(answers)) return { why: `${MACHINE_KEY}: ${kind} is not an object` };
    const extra = Object.keys(answers).filter((k) => !MACHINE_ANSWERS.includes(k));
    if (extra.length) {
      return {
        why: `${MACHINE_KEY}: ${kind} holds ${extraKeys(extra, 'machine')}, which never travel (only ${MACHINE_ANSWERS.join(', ')} do)`,
      };
    }
    const capacity = /** @type {any} */ (answers).capacity;
    if (isObject(capacity) && !Object.keys(capacity).every((n) => RESOURCE_NAME.test(n))) {
      return {
        why: `${MACHINE_KEY}: ${kind} capacity names a resource that is not a plain name (lower-case letters, digits, "_" and "-")`,
      };
    }
    const errors = validateSettings('machine', { schema_version: 1, kind, ...answers });
    if (errors.length) {
      return {
        why: `${MACHINE_KEY}: ${kind} does not match the machine schema (${errors.length} problem${errors.length === 1 ? '' : 's'}); hitld config write machine replaces it`,
      };
    }
  }
  return { data };
}

/**
 * Read one copy with the trusted loading the settings files get (readTrustedFile): a regular file
 * owned by the current user, writable by nobody else, not a symbolic link, inside the store.
 * @param {string} root @param {string} key @param {number | undefined} uid for tests
 * @returns {{ text: string | null } | { why: string }}
 */
function readCopy(root, key, uid) {
  const path = join(resolve(root), key);
  try {
    lstatSync(path);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return { text: null };
    return { why: `${key} cannot be read` };
  }
  const read = readTrustedFile(path, root, {
    why: WHY,
    rootName: 'the store',
    ...(uid !== undefined ? { uid } : {}),
  });
  return 'error' in read ? { why: `${key} ${read.error}` } : { text: read.text };
}

/**
 * Read the settings that travel in the project's store.
 * @param {string | null} root the project's store, or null when there is no project
 * @param {{ projectId: string, env?: NodeJS.ProcessEnv, now?: () => Date, uid?: number }} o
 *   now and uid are for tests
 * @returns {StoreSettings}
 */
export function readStoreSettings(root, o) {
  /** @type {StoreSettings} */
  const none = { state: 'none', store: root, person: null, machine: null };
  if (!root) return none;
  const env = o.env ?? process.env;
  const fresh = freshness(root, o.projectId, env, o.now ?? (() => new Date()));
  if (fresh.problem) return { ...none, state: 'unreadable', reason: fresh.problem };
  const at = fresh.pulled_at ? { pulled_at: fresh.pulled_at } : {};
  const personRead = readCopy(root, PERSON_KEY, o.uid);
  const machineRead = readCopy(root, MACHINE_KEY, o.uid);
  const refused = [personRead, machineRead].flatMap((r) => ('why' in r ? [r.why] : []));
  if (refused.length) {
    return {
      ...none,
      state: 'unreadable',
      reason: `the store's copy is refused: ${refused.join('; ')}`,
    };
  }
  const personText = 'text' in personRead ? personRead.text : null;
  const machineText = 'text' in machineRead ? machineRead.text : null;
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
 * Why `config write` may not put what travels in the store now, or null. When the store is
 * expected and this machine could not bring it up to date, a write would start from a stale copy
 * (or a container's leftover file) and the next push would spread it: pull first. A cloud session
 * writes nothing then; a machine writes its own file and leaves the store's copy.
 * @param {StoreSettings} s
 * @returns {string | null}
 */
export function storeWriteRefusal(s) {
  if (s.state !== 'unreadable') return null;
  return `the project's store is not up to date here (${s.reason}), and writing it now could replace newer settings with older ones. Run hitld store pull, then write again`;
}

/**
 * Make a copy the owner's alone (mode 600), so trusted loading reads it whatever the umask.
 * @param {string} root @param {string} key
 */
function keepPrivate(root, key) {
  try {
    chmodSync(join(resolve(root), key), 0o600);
  } catch {
    // A platform without modes: trusted loading checks nothing there either.
  }
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
    keepPrivate(root, PERSON_KEY);
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
  keepPrivate(root, MACHINE_KEY);
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
