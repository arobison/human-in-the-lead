// Moving the private store through its remote (design 0003, sections 7, 8 and 12): push, pull and
// status, and the remote's address.
//
// What moves is the store's committed text, as one age file (format 2) per push, encrypted to the
// devices the resolver names (devices-port.mjs). The remote only ever holds those bytes. Pull
// opens the head with this device's key and merges it as `store import` does. A push is a compare
// and swap on the remote's head; when the remote has moved, it pulls, merges and tries again.
//
// Machine-local files never move: the bundle is built from the store's git history, which keeps
// them out (git.mjs, MACHINE_LOCAL). The remote's address and what this machine last merged are
// machine-local too. They live inside the store's `.git` directory, which is never committed,
// never bundled and refused if a bundle carries it:
//   <store>/.git/hitld-remote.json   the address, set by `store remote set`
//   <store>/.git/hitld-sync.json     the remote version this store last merged or pushed, and the
//                                    local commit that version holds, written by pull and push
//
// No key is read here: recipients and the private key come from `resolveDevices` through the
// caller. No passphrase is used: nothing writes format 1 to a remote.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatOf, checkRecipients } from './sealed.mjs';
import { parseIdentities, parseRecipient } from './age.mjs';
import { StoreRemoteError, pushWithRetry } from './remote.mjs';
import { STORE_BRANCH, checkRemoteUrl, createGitRemote, remoteDir } from './remote-git.mjs';
import { ensureRepo, git, hasText, head as localHead } from './git.mjs';
import { importStore, sealStore } from './sync.mjs';

/**
 * Every code this module throws. Lowercase kebab-case.
 *   no-remote           no remote is set for this store
 *   not-enrolled        this device is not on the project's device list, so it cannot push
 *   not-a-recipient     the push would not be encrypted to this device's own key
 *   no-identity         opening the remote's head needs this device's private key
 *   nothing-to-push     the store holds no text yet
 *   remote-not-format-2 the remote's head is not an age file
 *   remote-config-invalid / sync-state-invalid   a machine-local file is damaged
 */
export class PushPullError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [detail] */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PushPullError';
    this.code = code;
    this.detail = detail;
  }
}

const CONFIG_FILE = 'hitld-remote.json';
const STATE_FILE = 'hitld-sync.json';
/** How often a push pulls, merges and tries again after losing a race. */
const ATTEMPTS = 4;

/** @param {string} root @param {string} name */
const filePath = (root, name) => join(resolve(root), '.git', name);

/**
 * Read one of the machine-local JSON files, or null when it is not there.
 * @param {string} root @param {string} name @param {'remote-config-invalid' | 'sync-state-invalid'} code
 * @returns {Record<string, unknown> | null}
 */
function readJson(root, name, code) {
  const path = filePath(root, name);
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v) && v.schema_version === 1) return v;
  } catch {
    // Reported below.
  }
  throw new PushPullError(
    code,
    `${path} is damaged; delete it${name === CONFIG_FILE ? ' and run hitld store remote set again' : ''}`,
  );
}

/** @param {string} root @param {string} name @param {Record<string, unknown>} value */
function writeJson(root, name, value) {
  const path = filePath(root, name);
  mkdirSync(join(resolve(root), '.git'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema_version: 1, ...value }, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(tmp, path);
}

/**
 * The remote this store pushes to and pulls from, or null when none is set.
 * @param {string} root the private store's directory
 * @returns {{ url: string } | null}
 */
export function readRemoteConfig(root) {
  const v = readJson(root, CONFIG_FILE, 'remote-config-invalid');
  if (!v) return null;
  try {
    return { url: checkRemoteUrl(v.url) };
  } catch {
    throw new PushPullError('remote-config-invalid', `${filePath(root, CONFIG_FILE)} is damaged`);
  }
}

/**
 * Record the remote's address for this store. The address is checked first. A different address
 * forgets what was merged from the old one.
 * @param {string} root the private store's directory @param {string} url
 */
export function setRemote(root, url) {
  checkRemoteUrl(url);
  ensureRepo(root);
  const before = readRemoteConfig(root);
  writeJson(root, CONFIG_FILE, { url });
  if (before && before.url !== url) writeJson(root, STATE_FILE, { synced: null });
  return { url, previous: before?.url ?? null };
}

/**
 * What this store last merged from the remote or pushed to it: the remote's version id, and the
 * local commit that version holds.
 * @typedef {{ version: string, head: string }} Synced
 */

/** @param {string} root @returns {Synced | null} */
export function readSynced(root) {
  const v = readJson(root, STATE_FILE, 'sync-state-invalid');
  const s = /** @type {any} */ (v?.synced);
  if (!s) return null;
  if (typeof s.version !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s.head)) {
    throw new PushPullError('sync-state-invalid', `${filePath(root, STATE_FILE)} is damaged`);
  }
  return { version: s.version, head: s.head };
}

/** @param {string} root @param {Synced} synced */
const writeSynced = (root, synced) => writeJson(root, STATE_FILE, { synced });

/**
 * The remote this store is set to use.
 * @param {string} root the private store's directory
 * @returns {import('./remote.mjs').StoreRemote}
 */
export function openRemote(root) {
  const config = readRemoteConfig(root);
  if (!config) {
    throw new PushPullError(
      'no-remote',
      'no remote is set for this store: run hitld store remote set <url>',
    );
  }
  return createGitRemote({ url: config.url, dir: remoteDir(root), branch: STORE_BRANCH });
}

/**
 * @typedef {object} PushPullOptions
 * @property {string} root the private store's directory
 * @property {string} projectId
 * @property {import('./remote.mjs').StoreRemote} remote
 * @property {import('./devices-port.mjs').Devices} devices from `resolveDevices`
 * @property {() => Date} [now] for tests
 */

/**
 * The private keys to open the remote's files with.
 * @param {import('./devices-port.mjs').Devices} devices
 */
function identitiesOf(devices) {
  if (!devices.identity) {
    throw new PushPullError(
      'no-identity',
      "opening what the remote holds needs this device's age private key: set HITLD_STORE_IDENTITY or pass --identity-fd <n>; never on the command line",
    );
  }
  return parseIdentities(devices.identity);
}

/**
 * Fetch one remote version, open it with this device's key and merge it into the store, as
 * `store import` does. Records what was merged when it succeeds.
 * @param {PushPullOptions} o @param {string} version
 */
async function mergeVersion(o, version) {
  const identities = identitiesOf(o.devices);
  const bytes = await o.remote.fetch(version);
  if (formatOf(bytes) !== 2) {
    throw new PushPullError(
      'remote-not-format-2',
      `the remote's ${version} is not an age file; nothing writes another format to a remote`,
    );
  }
  const merged = await importStore({ root: o.root, projectId: o.projectId, bytes, identities });
  if (merged.ok) {
    writeSynced(o.root, { version, head: /** @type {string} */ (merged.incoming) });
  }
  return merged;
}

/**
 * Bring the remote's head into the store. An empty remote, or a head this store already merged,
 * changes nothing. A conflict stops the pull with nothing merged.
 * @param {PushPullOptions} o
 */
export async function pullStore(o) {
  const version = await o.remote.head();
  if (version === null) {
    return { ok: true, result: 'empty', project: o.projectId, remote_version: null };
  }
  if (readSynced(o.root)?.version === version) {
    return { ok: true, result: 'up-to-date', project: o.projectId, remote_version: version };
  }
  const merged = await mergeVersion(o, version);
  if (!merged.ok) return { ...merged, remote_version: version };
  return {
    ok: true,
    result: merged.result,
    project: merged.project,
    remote_version: version,
    head: merged.head,
    changed: merged.changed,
    index: merged.index,
  };
}

/**
 * Seal the store's text for the devices and push it as the remote's new head. A push the remote
 * refuses because it moved pulls the new head, merges it and pushes on top of it; a conflict, or
 * a remote that keeps moving, stops it.
 * @param {PushPullOptions} o
 */
export async function pushStore(o) {
  if (!o.devices.enrolled) {
    throw new PushPullError(
      'not-enrolled',
      "this device is not on the project's device list; it cannot push until its enrolment is merged",
    );
  }
  const recipients = checkRecipients(o.devices.recipients);
  if (o.devices.identity) {
    const own = parseIdentities(o.devices.identity).map((i) => i.publicKey);
    const to = recipients.map(parseRecipient);
    if (!own.some((k) => to.some((r) => r.equals(k)))) {
      throw new PushPullError(
        'not-a-recipient',
        "the push is not encrypted to this device's own key, so this device could not open it afterwards; add its public key to the recipients",
      );
    }
  }
  ensureRepo(o.root);
  if (!hasText(o.root)) {
    throw new PushPullError('nothing-to-push', 'the store holds no text to push yet');
  }
  const sealOptions = { root: o.root, projectId: o.projectId, recipients, now: o.now };
  let sealed = sealStore(sealOptions);
  const synced = readSynced(o.root);
  const remoteHead = await o.remote.head();
  if (synced && remoteHead === synced.version && sealed.head === synced.head) {
    return {
      ok: true,
      result: 'up-to-date',
      project: o.projectId,
      version: remoteHead,
      head: sealed.head,
    };
  }
  /** @type {Array<{ version: string, result: string }>} */
  const merges = [];
  const version = await pushWithRetry(o.remote, {
    bytes: sealed.bytes,
    expected: synced?.version ?? null,
    attempts: ATTEMPTS,
    async reconcile(actual) {
      if (actual !== null) {
        const merged = await mergeVersion(o, actual);
        if (!merged.ok) throw new Conflict(merged, actual);
        merges.push({ version: actual, result: /** @type {string} */ (merged.result) });
      }
      sealed = sealStore(sealOptions);
      return { bytes: sealed.bytes, expected: actual };
    },
  }).catch((e) => {
    if (e instanceof Conflict) return e;
    throw e;
  });
  if (version instanceof Conflict) {
    return { ...version.merged, remote_version: version.version };
  }
  writeSynced(o.root, { version, head: sealed.head });
  return {
    ok: true,
    result: 'pushed',
    project: o.projectId,
    version,
    previous_version: synced?.version ?? null,
    head: sealed.head,
    recipients: recipients.length,
    bytes: sealed.bytes.length,
    merged: merges,
  };
}

/** A merge during a push stopped on a conflict. */
class Conflict extends Error {
  /** @param {{ ok: boolean } & Record<string, unknown>} merged @param {string} version */
  constructor(merged, version) {
    super('conflict');
    this.merged = merged;
    this.version = version;
  }
}

/**
 * Whether the store's text differs from its last commit, without committing anything.
 * @param {string} root
 */
function hasUncommitted(root) {
  const out = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']).stdout.toString(
    'utf8',
  );
  return out
    .split('\0')
    .filter(Boolean)
    .some((l) => l.slice(3) !== '.gitignore');
}

/**
 * Where the store stands against its remote, and what this device may do. It changes nothing in
 * the store. A remote that cannot be reached is reported, not raised.
 * @param {Omit<PushPullOptions, 'remote'> & { remote: import('./remote.mjs').StoreRemote | null }} o
 */
export async function storeStatus(o) {
  const config = readRemoteConfig(o.root);
  const exists = existsSync(join(resolve(o.root), '.git'));
  if (exists) ensureRepo(o.root);
  const local = exists ? localHead(o.root) : null;
  const changed = exists && hasUncommitted(o.root);
  const synced = readSynced(o.root);
  /** @type {string | null} */
  let remoteVersion = null;
  /** @type {{ code: string, message: string } | null} */
  let remoteError = null;
  if (o.remote) {
    try {
      remoteVersion = await o.remote.head();
    } catch (e) {
      if (!(e instanceof StoreRemoteError)) throw e;
      remoteError = { code: e.code, message: e.message };
    }
  }
  const holdsText = local !== null || changed;
  return {
    ok: true,
    project: o.projectId,
    remote: config,
    local_version: local,
    local_changed: changed,
    remote_version: remoteVersion,
    remote_error: remoteError,
    synced: synced,
    push_due: config ? holdsText && (changed || !synced || synced.head !== local) : false,
    pull_due:
      config && !remoteError ? remoteVersion !== null && remoteVersion !== synced?.version : null,
    device: {
      name: o.devices.device,
      enrolled: o.devices.enrolled,
      has_identity: o.devices.identity !== null,
      recipients: o.devices.recipients.length,
    },
  };
}
