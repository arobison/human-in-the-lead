// Store devices (design 0003, sections 5, 6 and 9): each machine or cloud environment that keeps
// the private store has its own age X25519 key pair. Its public key is enrolled in
// .human-in-the-lead/store-devices.json, which reaches main only through the owner's merge. Every
// pushed file is encrypted to the devices on main's copy, and only a device on it may push.
//
// Where a private key lives:
//   a local machine      the operating system's keychain (env/keychain.mjs), service
//                        hitld-store-<project id>, account device-identity
//   a cloud environment  the environment variable HITLD_STORE_IDENTITY, set once by the owner in
//                        their personal cloud environment; hitld never writes it to disk
//
// Removing a device is a commit too. Format 2 has no long-lived project key: each pushed file has
// a fresh file key wrapped for each recipient, so once the removal is on main the next push is
// not encrypted to the removed key. What remains is the remote's older files, which the removed
// key still opens: the push that follows a removal prunes them (rotation, below).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keychain } from '../env/keychain.mjs';
import { schemas } from '../schema/registry.mjs';
import { parseRecipient } from './age.mjs';

/** The enrolled devices, in the repository. */
export const DEVICES_PATH = '.human-in-the-lead/store-devices.json';
/** The environment variable a cloud environment's private key arrives in. */
export const IDENTITY_ENV = 'HITLD_STORE_IDENTITY';
/** The keychain account a local machine's private key is stored under. */
export const KEYCHAIN_ACCOUNT = 'device-identity';
/** Where removals and rotations are recorded in the private store: text, so it syncs. */
export const ROTATIONS_KEY = 'devices/rotations.jsonl';
export const DEVICE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REMOTE = 'origin';

/**
 * A refusal, with a code that names the kind. Lowercase kebab-case:
 *   devices-invalid         a store-devices.json does not parse or breaks the schema
 *   devices-no-main         the checkout has no main branch, local or remote-tracking, to read
 *   device-name-invalid     a device name is not a short lower-case name
 *   device-name-required    no name was given and none could be made
 *   device-name-taken       the name is enrolled with another key
 *   device-unknown          no device has that name
 *   device-no-keychain      this machine has no keychain hitld can store a key in
 *   device-not-enrolled     this device has no key, or its key is not on main's list
 * A message never carries a private key.
 */
export class DevicesError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [detail] */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DevicesError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @typedef {object} Device
 * @property {string} name
 * @property {string} recipient the age public key, age1...
 * @property {string} added YYYY-MM-DD
 *
 * @typedef {{ schema_version: number, devices: Device[] }} DevicesFile
 * @typedef {{ file: DevicesFile | null, problems: string[], present: boolean }} DevicesRead
 */

/** @returns {DevicesFile} */
export const emptyDevices = () => ({ schema_version: 1, devices: [] });

/** The keychain service for a project's device key. @param {string} projectId */
export const keychainService = (projectId) => `hitld-store-${projectId}`;

/**
 * The keychain that holds this machine's device key for a project.
 * @param {string} projectId @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 */
export const deviceKeychain = (projectId, options = {}) =>
  keychain({ service: keychainService(projectId), ...options });

/**
 * Check a store-devices.json text: the schema, then what the schema cannot say (unique names and
 * keys, keys that parse with their checksum).
 * @param {string} text
 * @returns {{ file: DevicesFile | null, problems: string[] }}
 */
export function checkDevices(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { file: null, problems: [`does not parse: ${/** @type {Error} */ (e).message}`] };
  }
  // A private key pasted in by mistake is named, never repeated.
  const problems = schemas()
    .validateEntity('store-devices', data)
    .map(
      (e) => `${e.path}: ${e.message.replace(/AGE-SECRET-KEY-1[0-9A-Z.]*/gi, '[a private key]')}`,
    );
  if (/AGE-SECRET-KEY-1/i.test(text)) {
    problems.unshift(
      'the file holds a private key: take it out, and treat that key as leaked (remove its device and make a new key)',
    );
  }
  if (!problems.length) {
    const names = new Set();
    const keys = new Set();
    for (const d of /** @type {DevicesFile} */ (data).devices) {
      if (names.has(d.name)) problems.push(`the name "${d.name}" appears twice`);
      if (keys.has(d.recipient)) problems.push(`the key of "${d.name}" is enrolled twice`);
      names.add(d.name);
      keys.add(d.recipient);
      try {
        parseRecipient(d.recipient);
      } catch {
        problems.push(`the key of "${d.name}" is not an age public key`);
      }
    }
  }
  return problems.length
    ? { file: null, problems }
    : { file: /** @type {DevicesFile} */ (data), problems: [] };
}

/** The file's text: sorted by name, so a diff shows only what changed. @param {DevicesFile} file */
export function serializeDevices(file) {
  const devices = [...file.devices]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ name: d.name, recipient: d.recipient, added: d.added }));
  return `${JSON.stringify({ schema_version: file.schema_version, devices }, null, 2)}\n`;
}

/**
 * The file in a working tree. No file is an empty list.
 * @param {string} repoRoot @returns {DevicesRead}
 */
export function readDevices(repoRoot) {
  const path = join(repoRoot, DEVICES_PATH);
  if (!existsSync(path)) return { file: emptyDevices(), problems: [], present: false };
  return { ...checkDevices(readFileSync(path, 'utf8')), present: true };
}

/**
 * Write the file in a working tree, for the owner to commit.
 * @param {string} repoRoot @param {DevicesFile} file
 */
export function writeDevices(repoRoot, file) {
  const path = join(repoRoot, DEVICES_PATH);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, serializeDevices(file));
  renameSync(tmp, path);
  return path;
}

/** @param {string} repoRoot @param {string[]} args */
function git(repoRoot, args) {
  const r = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/**
 * The file as a commit holds it. A commit without one has an empty list.
 * @param {string} repoRoot @param {string} ref a commit or ref
 * @returns {DevicesRead}
 */
export function devicesAt(repoRoot, ref) {
  const r = git(repoRoot, ['show', `${ref}:${DEVICES_PATH}`]);
  if (!r.ok) return { file: emptyDevices(), problems: [], present: false };
  return { ...checkDevices(r.out), present: true };
}

/**
 * The copies of main this checkout has: the local branch and the remote-tracking one, those that
 * exist. Nothing is fetched.
 * @param {string} repoRoot @param {string} mainBranch
 * @returns {string[]}
 */
export function mainRefs(repoRoot, mainBranch) {
  return [`refs/heads/${mainBranch}`, `refs/remotes/${REMOTE}/${mainBranch}`].filter(
    (ref) => git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok,
  );
}

/**
 * The devices enrolled on main: on every copy of main this checkout has. When the local branch and
 * the remote-tracking branch differ, a device counts only if both list it, so a removal on either
 * takes effect at once, and an enrolment counts once both have it. A list on main that fails the
 * check refuses: nothing is enrolled until it is fixed on main.
 * @param {string} repoRoot @param {string} mainBranch
 * @returns {{ devices: Device[], refs: string[] }}
 */
export function enrolledOnMain(repoRoot, mainBranch) {
  const refs = mainRefs(repoRoot, mainBranch);
  if (!refs.length) {
    throw new DevicesError(
      'devices-no-main',
      `this checkout has no ${mainBranch} branch (local or ${REMOTE}/${mainBranch}) to read ${DEVICES_PATH} from; fetch it`,
    );
  }
  /** @type {Device[] | null} */
  let devices = null;
  for (const ref of refs) {
    const at = devicesAt(repoRoot, ref);
    if (!at.file) {
      throw new DevicesError(
        'devices-invalid',
        `${DEVICES_PATH} on ${ref} is refused, so no device is enrolled: ${at.problems.join('; ')}`,
        { ref, problems: at.problems },
      );
    }
    const here = new Set(at.file.devices.map((d) => d.recipient));
    devices = devices
      ? devices.filter((d) => here.has(d.recipient))
      : [...at.file.devices].sort((a, b) => a.name.localeCompare(b.name));
  }
  return { devices: devices ?? [], refs };
}

/**
 * @typedef {object} Removal
 * @property {string} name
 * @property {string} recipient
 * @property {string} at when it happened: the commit time on main, or when `device remove` ran
 * @property {string | null} commit the commit on main that removed it, when known
 */

/**
 * Every key main's list has lost, from the history of the file on main (first parents only, so a
 * merge counts as the commit that changed it). A version that fails the check is skipped.
 * @param {string} repoRoot @param {string} ref
 * @returns {Removal[]}
 */
export function removalsOnMain(repoRoot, ref) {
  const log = git(repoRoot, [
    'log',
    '--first-parent',
    '--reverse',
    '--format=%H %cI',
    ref,
    '--',
    DEVICES_PATH,
  ]);
  if (!log.ok) return [];
  /** @type {Removal[]} */
  const out = [];
  /** @type {Map<string, string>} recipient to name */
  let before = new Map();
  for (const line of log.out.split('\n').filter(Boolean)) {
    const [commit, at] = line.split(' ');
    const read = devicesAt(repoRoot, commit);
    if (!read.file) continue;
    const now = new Map(read.file.devices.map((d) => [d.recipient, d.name]));
    for (const [recipient, name] of before) {
      if (!now.has(recipient)) out.push({ name, recipient, at, commit });
    }
    before = now;
  }
  return out;
}

/**
 * Add a device. The same name with the same key changes nothing; a taken name, or a key already
 * enrolled under another name, is refused.
 * @param {DevicesFile} file @param {Device} device
 * @returns {{ file: DevicesFile, changed: boolean, entry: Device }}
 */
export function addDevice(file, device) {
  checkName(device.name);
  parseRecipient(device.recipient);
  const byName = file.devices.find((d) => d.name === device.name);
  const byKey = file.devices.find((d) => d.recipient === device.recipient);
  // The key is enrolled already, perhaps under another name: nothing to add.
  if (byKey) return { file, changed: false, entry: byKey };
  if (byName) {
    throw new DevicesError(
      'device-name-taken',
      `"${device.name}" is enrolled with another key; choose another name with --name, or remove "${device.name}" first`,
    );
  }
  const entry = { name: device.name, recipient: device.recipient, added: device.added };
  return { file: { ...file, devices: [...file.devices, entry] }, changed: true, entry };
}

/**
 * Remove a device by name.
 * @param {DevicesFile} file @param {string} name
 * @returns {{ file: DevicesFile, removed: Device }}
 */
export function removeDevice(file, name) {
  const removed = file.devices.find((d) => d.name === name);
  if (!removed) {
    throw new DevicesError(
      'device-unknown',
      `no device is named "${name}" in ${DEVICES_PATH}; hitld store device list shows them`,
    );
  }
  return { file: { ...file, devices: file.devices.filter((d) => d !== removed) }, removed };
}

/** @param {unknown} name */
export function checkName(name) {
  if (typeof name !== 'string' || !DEVICE_NAME.test(name)) {
    throw new DevicesError(
      'device-name-invalid',
      `a device name is lower-case letters, digits, ".", "_" and "-", at most 64 characters; got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

/**
 * A default name from a host name, or null when nothing usable is left of it.
 * @param {string} host
 */
export function nameFromHost(host) {
  const name = String(host)
    .toLowerCase()
    .split('.')[0]
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
  return DEVICE_NAME.test(name) ? name : null;
}

/**
 * @typedef {{ event: 'removed', name: string, recipient: string, at: string }
 *   | { event: 'rotated', name: string, recipient: string, at: string, version: string | null }} RotationRecord
 */

/**
 * The removals and rotations recorded in the private store. A line that does not parse is skipped.
 * @param {import('./store.mjs').PrivateStore} store
 * @returns {RotationRecord[]}
 */
export function readRotations(store) {
  const text = store.read(ROTATIONS_KEY) ?? '';
  /** @type {RotationRecord[]} */
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (
        (r.event === 'removed' || r.event === 'rotated') &&
        typeof r.recipient === 'string' &&
        typeof r.at === 'string' &&
        !Number.isNaN(Date.parse(r.at))
      ) {
        out.push(r);
      }
    } catch {
      // skipped
    }
  }
  return out;
}

/**
 * Append one record. The file is append-only, so copies on several devices merge line by line.
 * @param {import('./store.mjs').PrivateStore} store @param {RotationRecord} record
 */
export function recordRotation(store, record) {
  store.append(ROTATIONS_KEY, `${JSON.stringify(record)}\n`);
}

/**
 * The removals whose rotation has not happened yet: the key is off main's list now, and no
 * rotation of it is recorded since it was removed. A key removed, enrolled again and removed again
 * is pending again.
 * @param {{ removals: Removal[], records: RotationRecord[], current: string[] }} input
 * @returns {Removal[]} one per key, the latest removal, sorted by name
 */
export function pendingRotations({ removals, records, current }) {
  const enrolled = new Set(current);
  /** @type {Map<string, Removal>} */
  const latest = new Map();
  const all = [
    ...removals,
    ...records
      .filter((r) => r.event === 'removed')
      .map((r) => ({ name: r.name, recipient: r.recipient, at: r.at, commit: null })),
  ];
  for (const r of all) {
    if (enrolled.has(r.recipient)) continue;
    const seen = latest.get(r.recipient);
    if (!seen || Date.parse(r.at) > Date.parse(seen.at)) latest.set(r.recipient, r);
  }
  const rotated = records.filter((r) => r.event === 'rotated');
  return [...latest.values()]
    .filter(
      (r) =>
        !rotated.some((x) => x.recipient === r.recipient && Date.parse(x.at) >= Date.parse(r.at)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
