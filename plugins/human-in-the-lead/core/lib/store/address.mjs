// The store remote's address (design 0003, section 8): where it is read from, and where `hitld
// store remote set` writes it. Never policy.json (placement.mjs says why). In this order:
//
//   environment  HITLD_STORE_REMOTE, which a cloud environment sets beside HITLD_STORE_IDENTITY,
//                so a fresh container finds the remote with nothing run first
//   person       the person file (design part 13.4), projects.<project id>.store_remote, outside
//                every repository: a local machine's own setting
//   machine      <store>/.git/hitld-remote.json, this machine's override, inside the store's .git
//                (never committed, never bundled)
//
// The address is not a secret: a password in it is refused, and credentials come from the
// session's own git access. It is checked by checkRemoteUrl wherever it is read.
//
// Light on purpose: the hooks read the address to tell whether a remote is configured before the
// push and pull code (and node:sqlite behind it) is loaded.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { replaceFile } from './host.mjs';
import { loadSettingsFile, writeSettingsFile } from '../settings/files.mjs';
import { checkRemoteUrl } from './remote-git.mjs';
import { ensureRepo } from './git.mjs';
import { REMOTE_ENV } from './placement.mjs';

export { REMOTE_ENV };

/**
 * A refusal about the address. Lowercase kebab-case:
 *   remote-config-invalid  this machine's override file is damaged
 *   settings               the person file cannot be read or written
 */
export class StoreAddressError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'StoreAddressError';
    this.code = code;
  }
}

/** The person file's key under projects.<id>. */
export const PERSON_KEY = 'store_remote';
const CONFIG_FILE = 'hitld-remote.json';

/** @param {string} root */
const overridePath = (root) => join(resolve(root), '.git', CONFIG_FILE);

/**
 * @typedef {'environment' | 'person' | 'machine'} AddressSource
 * @typedef {{ url: string, source: AddressSource }} RemoteChoice
 * @typedef {{ store: string, projectId: string, env?: NodeJS.ProcessEnv }} AddressLookup
 */

/**
 * This machine's override of the address, or null when there is none.
 * @param {string} root the private store's directory
 * @returns {{ url: string } | null}
 */
export function readRemoteConfig(root) {
  const path = overridePath(root);
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (v && typeof v === 'object' && v.schema_version === 1) return { url: checkRemoteUrl(v.url) };
  } catch {
    // Reported below.
  }
  throw new StoreAddressError(
    'remote-config-invalid',
    `${path} is damaged; delete it and run hitld store remote set --machine again`,
  );
}

/**
 * Record this machine's override. The address is checked first.
 * @param {string} root the private store's directory @param {string} url
 */
export function setRemote(root, url) {
  checkRemoteUrl(url);
  // The override lives inside the store's .git: make the repository first, so that directory is
  // not mistaken for one.
  ensureRepo(root);
  const before = readRemoteConfig(root);
  const path = overridePath(root);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema_version: 1, url }, null, 2) + '\n', { mode: 0o600 });
  replaceFile(tmp, path);
  return { url, previous: before?.url ?? null };
}

/**
 * Remove this machine's override.
 * @param {string} root the private store's directory
 */
export function clearRemote(root) {
  const before = readRemoteConfig(root);
  rmSync(overridePath(root), { force: true });
  return { removed: before?.url ?? null };
}

/**
 * The address the person file gives this project, or null. A person file that cannot be read gives
 * none, and says why in `problem`.
 * @param {string} projectId @param {NodeJS.ProcessEnv} [env]
 * @returns {{ url: string | null, path: string, problem: string | null }}
 */
export function personRemote(projectId, env = process.env) {
  const file = loadSettingsFile('person', { env });
  if (!file.data) {
    return {
      url: null,
      path: file.path,
      problem: file.present ? file.errors.map((e) => `${e.path} ${e.message}`).join('; ') : null,
    };
  }
  const url = file.data.projects?.[projectId]?.[PERSON_KEY];
  return {
    url: typeof url === 'string' ? checkRemoteUrl(url) : null,
    path: file.path,
    problem: null,
  };
}

/**
 * Write the address into the person file, under this project's ID.
 * @param {string} projectId @param {string} url
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [o]
 */
export function setPersonRemote(projectId, url, o = {}) {
  checkRemoteUrl(url);
  const env = o.env ?? process.env;
  const before = personRemote(projectId, env);
  try {
    const written = writeSettingsFile(
      'person',
      { schema_version: 1, projects: { [projectId]: { [PERSON_KEY]: url } } },
      { env, cwd: o.cwd, merge: true },
    );
    return { url, previous: before.url, path: written.path };
  } catch (e) {
    throw new StoreAddressError('settings', /** @type {Error} */ (e).message);
  }
}

/**
 * Take the address out of the person file. The project's other keys (its share) stay.
 * @param {string} projectId @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [o]
 */
export function clearPersonRemote(projectId, o = {}) {
  const env = o.env ?? process.env;
  const file = loadSettingsFile('person', { env });
  const current = file.data?.projects?.[projectId]?.[PERSON_KEY];
  if (!file.data || typeof current !== 'string') return { removed: null, path: file.path };
  const data = structuredClone(file.data);
  delete data.projects[projectId][PERSON_KEY];
  if (!Object.keys(data.projects[projectId]).length) delete data.projects[projectId];
  if (!Object.keys(data.projects).length) delete data.projects;
  try {
    writeSettingsFile('person', data, { env, cwd: o.cwd });
  } catch (e) {
    throw new StoreAddressError('settings', /** @type {Error} */ (e).message);
  }
  return { removed: current, path: file.path };
}

/**
 * Each place the address may come from, and what it holds there.
 * @param {AddressLookup} l
 */
export function addressSources(l) {
  const env = l.env ?? process.env;
  const fromEnv = env[REMOTE_ENV]?.trim() || null;
  const person = personRemote(l.projectId, env);
  return {
    environment: fromEnv,
    person: person.url,
    person_file: person.path,
    machine: readRemoteConfig(l.store)?.url ?? null,
    ...(person.problem ? { person_problem: person.problem } : {}),
  };
}

/**
 * The address the store uses, and where it came from, or null when none is set.
 * @param {AddressLookup} l
 * @returns {RemoteChoice | null}
 */
export function chooseRemote(l) {
  const env = l.env ?? process.env;
  const fromEnv = env[REMOTE_ENV]?.trim();
  if (fromEnv) return { url: checkRemoteUrl(fromEnv), source: 'environment' };
  const person = personRemote(l.projectId, env).url;
  if (person) return { url: person, source: 'person' };
  const machine = readRemoteConfig(l.store);
  if (machine) return { url: machine.url, source: 'machine' };
  return null;
}

/** The words a refusal or a line uses when no address is set. */
export const NO_ADDRESS = `no store address is set here: set ${REMOTE_ENV} in a cloud environment, or run hitld store remote set <url> on a machine`;
