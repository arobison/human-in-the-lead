// Store devices (design 0003, sections 5, 6 and 9): each machine or cloud environment that keeps
// the private store has its own age X25519 key pair. Every pushed file is encrypted to the
// approved devices, and only an approved device may push.
//
// Who is approved is the owner's own answer to a device decision, and nothing else:
//
//   request   `hitld store device init` puts the device's name and public key on the store
//             repository's hitld-devices branch (proposals/<name>.json). That branch is not
//             protected, so a request is never trusted by itself.
//   decision  an approved device turns each request into a decision only the owner settles
//             (`hitld store device ask`, through `hitld rights ask`); removal is the same
//             (`hitld store device remove`). Such a decision never takes a default.
//   answer    the owner's answer, recorded by `hitld rights answer` from the owner's own turn,
//             writes `approved`, `removed` or `refused` to devices/approvals.jsonl in the private
//             store. That file is encrypted with the rest of the store, so every device learns
//             the approved set on its next pull.
//
// Nothing of it is in the project's repository, which may be public (placement.mjs). The
// limit: a process that already holds an approved key can write the store, approvals included;
// the approval guards against anyone who can write the store repository but holds no key.
//
// Where a private key lives:
//   a local machine      the operating system's keychain (env/keychain.mjs), service
//                        hitld-store-<project id>, account device-identity
//   a cloud environment  the environment variable HITLD_STORE_IDENTITY, set once by the owner in
//                        their personal cloud environment; hitld never writes it to disk
//
// Format 2 has no long-lived project key: each pushed file has a fresh file key wrapped for each
// recipient, so once a removal is approved the next push is not encrypted to the removed key.
// What remains is the remote's older files, which the removed key still opens: the push that
// follows a removal prunes them (rotation, below).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { keychain } from '../env/keychain.mjs';
import { schemas } from '../schema/registry.mjs';
import { parseRecipient } from './age.mjs';
import { hostEnv } from './host.mjs';
import { DEVICES_BRANCH, PROPOSALS_DIR, devicesRef, remoteDir } from './remote-git.mjs';
import { LEGACY_DEVICES_PATH } from './placement.mjs';

export { DEVICES_BRANCH, LEGACY_DEVICES_PATH, PROPOSALS_DIR };
/** The environment variable a cloud environment's private key arrives in. */
export const IDENTITY_ENV = 'HITLD_STORE_IDENTITY';
/** The keychain account a local machine's private key is stored under. */
export const KEYCHAIN_ACCOUNT = 'device-identity';
/** Where removals and rotations are recorded in the private store: text, so it syncs. */
export const ROTATIONS_KEY = 'devices/rotations.jsonl';
/** Where the owner's device decisions and answers are recorded in the private store. */
export const APPROVALS_KEY = 'devices/approvals.jsonl';
export const DEVICE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * A refusal, with a code that names the kind. Lowercase kebab-case:
 *   devices-fetch-failed      the store repository's requests could not be read
 *   device-name-invalid       a device name is not a short lower-case name
 *   device-name-required      no name was given and none could be made
 *   device-name-taken         the name is used by another key
 *   device-unknown            no approved device has that name
 *   device-no-keychain        this machine has no keychain hitld can store a key in
 *   device-not-enrolled       this device has no key, or the owner has not approved its key
 *   device-ask-refused        a device decision could not be asked
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
 * A short fingerprint of a public key, for the owner to compare: the decision shows it, and so
 * does the device that asked. Sixteen hex digits of its SHA-256, in groups of four.
 * @param {string} recipient
 */
export const fingerprint = (recipient) =>
  (createHash('sha256').update(recipient).digest('hex').slice(0, 16).match(/.{4}/g) ?? []).join(
    '-',
  );

/**
 * Check a store-devices.json text: the schema, then what the schema cannot say (unique names and
 * keys, keys that parse with their checksum). A request on the hitld-devices branch is one such
 * text with one device.
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

/** A request's text: a device list with this one device. @param {Device} device */
export const requestText = (device) => serializeDevices({ schema_version: 1, devices: [device] });

// --- requests, on the store repository's hitld-devices branch ------------------------------------

/**
 * Git against the store's local bare repository, read only. Nothing of the owner's configuration
 * is read, and hooks are off.
 * @param {string} storeRoot @param {string[]} args
 */
function bare(storeRoot, args) {
  const dir = remoteDir(storeRoot);
  if (!existsSync(join(dir, 'HEAD'))) return { ok: false, out: '' };
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...hostEnv(null),
      GIT_DIR: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      LANG: 'C',
      LC_ALL: 'C',
    },
  });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/**
 * The requests on the store repository's hitld-devices branch, as last fetched from `url`: one
 * device each, checked. A request that fails the check is left out and named in `problems`.
 * None of them is trusted: they say only who asked.
 * @param {string} storeRoot the private store's directory @param {string} url the store's address
 * @returns {{ requests: Device[], problems: string[], commit: string | null }}
 */
export function requestsOnBranch(storeRoot, url) {
  const ref = devicesRef(url);
  const tip = bare(storeRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!tip.ok) return { requests: [], problems: [], commit: null };
  const commit = tip.out.trim();
  const ls = bare(storeRoot, ['ls-tree', '--name-only', commit, `${PROPOSALS_DIR}/`]);
  /** @type {Device[]} */
  const requests = [];
  /** @type {string[]} */
  const problems = [];
  for (const path of ls.out.split('\n').filter(Boolean)) {
    const file = path.slice(PROPOSALS_DIR.length + 1);
    const shown = bare(storeRoot, ['show', `${commit}:${path}`]);
    const read = shown.ok ? checkDevices(shown.out) : { file: null, problems: ['cannot be read'] };
    const one = read.file?.devices.length === 1 ? read.file.devices[0] : null;
    if (!one || `${one.name}.json` !== file) {
      problems.push(
        `${path}: ${read.problems.join('; ') || 'a request names one device, under its own name'}`,
      );
      continue;
    }
    requests.push(one);
  }
  return { requests: requests.sort((a, b) => a.name.localeCompare(b.name)), problems, commit };
}

// --- the owner's answers, inside the encrypted store ---------------------------------------------

/**
 * The action of a record in its current spelling. Records written before HITLD-121 hold the old
 * spelling of enroll, and the file is append-only, so they are read as `enroll` and never
 * rewritten.
 * @param {unknown} action
 */
export const currentAction = (action) => (action === 'enrol' ? 'enroll' : action); // spelling-ok

/**
 * One line of devices/approvals.jsonl.
 *   asked     a device decision was asked: `action` enroll or remove, for this key
 *   approved  the owner's answer enrolled the key
 *   removed   the owner's answer removed it
 *   refused   the owner's answer said no, to an enrollment or a removal
 * An `asked` line also carries the check code of the question asked (`check`, rights/flow.mjs).
 * @typedef {{ event: 'asked' | 'approved' | 'removed' | 'refused', decision: string, action: 'enroll' | 'remove', name: string, recipient: string, added?: string, at: string, check?: string }} ApprovalRecord
 */

/**
 * What a device decision applies when answered: its action, the device's name and its key's
 * fingerprint. Part of the question's check code, and checked by `hitld rights answer` against
 * the question asked under that ID before anything is recorded.
 * @param {{ action: 'enroll' | 'remove', name: string, recipient: string }} r
 * @returns {Record<string, string>}
 */
export const deviceBinds = (r) => ({
  action: r.action,
  name: r.name,
  fingerprint: fingerprint(r.recipient),
});

/**
 * The device decisions and answers recorded in the private store, oldest first. A line that does
 * not parse is skipped.
 * @param {import('./store.mjs').PrivateStore} store
 * @returns {ApprovalRecord[]}
 */
export function readApprovals(store) {
  const text = store.read(APPROVALS_KEY) ?? '';
  /** @type {ApprovalRecord[]} */
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object') r.action = currentAction(r.action);
      if (
        ['asked', 'approved', 'removed', 'refused'].includes(r.event) &&
        ['enroll', 'remove'].includes(r.action) &&
        typeof r.decision === 'string' &&
        typeof r.name === 'string' &&
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
  // Lines from two devices merge in either order; the time orders them.
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Date.parse(a.r.at) - Date.parse(b.r.at) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Append one record. The file is append-only, so copies on several devices merge line by line.
 * @param {import('./store.mjs').PrivateStore} store @param {ApprovalRecord} record
 */
export function recordApproval(store, record) {
  store.append(APPROVALS_KEY, `${JSON.stringify(record)}\n`);
}

/**
 * The approved set: every key the owner's answers enrolled and have not removed since.
 * @param {ApprovalRecord[]} records
 * @returns {Device[]} sorted by name
 */
export function approvedDevices(records) {
  /** @type {Map<string, Device>} */
  const on = new Map();
  for (const r of records) {
    if (r.event === 'approved') {
      on.set(r.recipient, {
        name: r.name,
        recipient: r.recipient,
        added: r.added ?? r.at.slice(0, 10),
      });
    } else if (r.event === 'removed') {
      on.delete(r.recipient);
    }
  }
  return [...on.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @typedef {object} Removal
 * @property {string} name
 * @property {string} recipient
 * @property {string} at when it happened: the owner's answer
 * @property {string | null} commit the decision that removed it
 */

/** Every removal the owner's answers made. @param {ApprovalRecord[]} records @returns {Removal[]} */
export const deviceRemovals = (records) =>
  records
    .filter((r) => r.event === 'removed')
    .map((r) => ({ name: r.name, recipient: r.recipient, at: r.at, commit: r.decision }));

/**
 * The device decisions asked and not answered yet, oldest first.
 * @param {ApprovalRecord[]} records
 * @returns {ApprovalRecord[]}
 */
export function openDeviceAsks(records) {
  const answered = new Set(records.filter((r) => r.event !== 'asked').map((r) => r.decision));
  return records.filter((r) => r.event === 'asked' && !answered.has(r.decision));
}

/**
 * The requests still waiting to be put to the owner: not approved, not asked about already, and
 * never answered for that key before. A key the owner refused or removed stays out: a device asks
 * again with a new key.
 * @param {Device[]} requests @param {ApprovalRecord[]} records
 * @returns {Device[]}
 */
export function pendingRequests(requests, records) {
  const seen = new Set(records.filter((r) => r.action === 'enroll').map((r) => r.recipient));
  const approved = new Set(approvedDevices(records).map((d) => d.recipient));
  return requests.filter((d) => !seen.has(d.recipient) && !approved.has(d.recipient));
}

/**
 * The question that puts a device to the owner. It names the device only by its key's
 * fingerprint: the decision item is a file in the project's tracker, which may be public, and
 * the device's name stays in the private store and the store repository. `hitld store device
 * list` shows the name beside the fingerprint.
 * @param {'enroll' | 'remove'} action @param {Device} device @param {string | undefined} parent
 */
export function deviceQuestion(action, device, parent) {
  const fp = fingerprint(device.recipient);
  const enroll = action === 'enroll';
  return {
    title: enroll ? 'Approve a store device' : 'Remove a store device',
    question: enroll
      ? `Enroll the store device whose key fingerprint is ${fp}?`
      : `Remove the store device whose key fingerprint is ${fp}?`,
    context: enroll
      ? `A device asked to read and write this project's private store. Once you approve it, every push is encrypted to it too. Check that the fingerprint is the one the device showed when it asked (hitld store device init); hitld store device list shows its name. Only your own answer approves it: no default and no precedent ever does.`
      : `Once you approve the removal, no push is encrypted to this device's key, and the next push prunes the older files it can open. What it already pulled, it keeps. hitld store device list shows its name.`,
    options: enroll
      ? [
          {
            label: 'Enroll it',
            what_happens:
              'Every push from now on is encrypted to this device too, and it may push.',
            reversible: true,
          },
          {
            label: 'Do not enroll it',
            what_happens:
              'Nothing is encrypted to it, and it may not push. A new key must ask again.',
            reversible: true,
          },
        ]
      : [
          {
            label: 'Remove it',
            what_happens:
              'The next push is encrypted to the other devices only, and prunes the older files.',
            reversible: true,
          },
          {
            label: 'Keep it',
            what_happens: 'Nothing changes.',
            reversible: true,
          },
        ],
    recommendation: {
      option: 'A',
      why: enroll
        ? 'if the fingerprint matches the one the device showed you; otherwise B'
        : 'if this is the device you meant to remove; otherwise B',
    },
    triggers: [
      { basis: 'rule-change', reason: 'it changes who can read the private store' },
      { basis: 'security', reason: 'a device key opens every file pushed after it is approved' },
    ],
    reversibility: /** @type {const} */ ('two-way'),
    classification: 'public',
    tags: ['store-device'],
    ...(parent ? { parent } : {}),
  };
}

/**
 * Turn the owner's answer to a device decision into the record that changes the approved set.
 * Called by `hitld rights answer` once the answer is recorded; any other decision is left alone.
 * Option A approves (enrolls or removes); anything else refuses. An answer to a decision already
 * answered changes nothing. With `binds` (what the question asked names, deviceBinds), only the
 * waiting decision it names is answered; without, only a sole waiting one under that ID.
 * @param {import('./store.mjs').PrivateStore} store
 * @param {{ decision: string, option: string | null, at: string, binds?: Record<string, string> | null }} answer
 * @returns {ApprovalRecord | null} the record written, or null when it is not a device decision
 */
export function applyDeviceAnswer(store, answer) {
  const records = readApprovals(store);
  const open = openDeviceAsks(records).filter((r) => r.decision === answer.decision);
  const binds = answer.binds;
  const asked = binds
    ? open.find((r) => {
        const b = deviceBinds(r);
        return (
          b.action === currentAction(binds.action) &&
          b.name === binds.name &&
          b.fingerprint === binds.fingerprint
        );
      })
    : open.length === 1
      ? open[0]
      : undefined;
  if (!asked) return null;
  const yes = answer.option === 'A';
  /** @type {ApprovalRecord} */
  const record = {
    event: yes ? (asked.action === 'enroll' ? 'approved' : 'removed') : 'refused',
    decision: asked.decision,
    action: asked.action,
    name: asked.name,
    recipient: asked.recipient,
    ...(asked.added ? { added: asked.added } : {}),
    at: answer.at,
  };
  recordApproval(store, record);
  return record;
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
 * The removals whose rotation has not happened yet: the key is off the approved set now, and no
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
