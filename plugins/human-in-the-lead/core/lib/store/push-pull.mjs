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
// Recipients and the private key come from `resolveDevices` (devices-port.mjs) and nowhere else:
// a push is encrypted to the devices on main's store-devices.json, fetched from origin first, and
// a device not on that list may not push. After a removal, the first push prunes the remote's
// older files (completeRotation). No passphrase is used: nothing writes format 1 to a remote.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatOf, checkRecipients } from './sealed.mjs';
import { AgeError, parseIdentities } from './age.mjs';
import { StoreRemoteError, pushWithRetry } from './remote.mjs';
import { STORE_BRANCH, checkRemoteUrl, createGitRemote, remoteDir } from './remote-git.mjs';
import { ensureRepo, git, hasText, head as localHead } from './git.mjs';
import { importStore, sealStore } from './sync.mjs';
import { openStore } from './store.mjs';
import { assertEnrolled, completeRotation, resolveDevices } from './devices-port.mjs';

/**
 * Every code this module throws. Lowercase kebab-case.
 *   no-remote           no remote is set for this store
 *   devices-fetch-failed  main could not be fetched from origin before a push
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
 * This machine's override of the remote's address, or null when there is none.
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
 * Record this machine's override of the remote's address. The address is checked first.
 * @param {string} root the private store's directory @param {string} url
 */
export function setRemote(root, url) {
  checkRemoteUrl(url);
  ensureRepo(root);
  const before = readRemoteConfig(root);
  writeJson(root, CONFIG_FILE, { url });
  return { url, previous: before?.url ?? null };
}

/**
 * Remove this machine's override, so the project's address (policy.json) is used again.
 * @param {string} root the private store's directory
 */
export function clearRemote(root) {
  const before = readRemoteConfig(root);
  rmSync(filePath(root, CONFIG_FILE), { force: true });
  return { removed: before?.url ?? null };
}

/**
 * Which address the store uses, and where it came from: this machine's override, else the
 * project's `store.remote.url` in policy.json (which a fresh container has with the checkout),
 * else none.
 * @typedef {{ url: string, source: 'machine' | 'policy' }} RemoteChoice
 * @param {string} root the private store's directory @param {string | null | undefined} policyUrl
 * @returns {RemoteChoice | null}
 */
export function chooseRemote(root, policyUrl) {
  const override = readRemoteConfig(root);
  if (override) return { url: override.url, source: 'machine' };
  if (policyUrl) return { url: checkRemoteUrl(policyUrl), source: 'policy' };
  return null;
}

/**
 * What this store last merged from the remote at `url` or pushed to it: the remote's version id,
 * and the local commit that version holds. A record made against another address is not used.
 * @typedef {{ version: string, head: string }} Synced
 */

/** @param {string} root @param {string} url @returns {Synced | null} */
export function readSynced(root, url) {
  const v = readJson(root, STATE_FILE, 'sync-state-invalid');
  const s = /** @type {any} */ (v?.synced);
  if (!s) return null;
  if (
    typeof s.version !== 'string' ||
    typeof s.url !== 'string' ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s.head)
  ) {
    throw new PushPullError('sync-state-invalid', `${filePath(root, STATE_FILE)} is damaged`);
  }
  return s.url === url ? { version: s.version, head: s.head } : null;
}

/** @param {string} root @param {string} url @param {Synced} synced */
const writeSynced = (root, url, synced) =>
  writeJson(root, STATE_FILE, { synced: { url, ...synced } });

/**
 * The remote this store is set to use.
 * @param {string} root the private store's directory @param {string | null | undefined} policyUrl
 * @returns {RemoteChoice & { remote: import('./remote.mjs').StoreRemote }}
 */
export function openRemote(root, policyUrl) {
  const choice = chooseRemote(root, policyUrl);
  if (!choice) {
    throw new PushPullError(
      'no-remote',
      'no remote is set: put store.remote.url in policy.json, or run hitld store remote set <url> for this machine',
    );
  }
  // The remote's local copy lives inside the store's .git: make the repository first, so the
  // directory the transport creates there is not mistaken for one.
  ensureRepo(root);
  const remote = createGitRemote({ url: choice.url, dir: remoteDir(root), branch: STORE_BRANCH });
  return { ...choice, remote };
}

/**
 * @typedef {object} PushPullOptions
 * @property {string} root the private store's directory
 * @property {string} projectId
 * @property {import('./remote.mjs').StoreRemote} remote
 * @property {string} url the address `remote` was opened on; what was merged is recorded against it
 * @property {import('./devices-port.mjs').Devices} devices from `resolveDevices`
 * @property {() => Date} [now] for tests
 */

/**
 * The private keys to open the remote's files with.
 * @param {import('./devices-port.mjs').Devices} devices
 */
function identitiesOf(devices) {
  if (!devices.identity && devices.key_source) {
    const where =
      devices.key_source === 'environment' ? 'HITLD_STORE_IDENTITY' : "the keychain's device key";
    throw new AgeError(
      'age-bad-identity',
      `${where} is not an age private key (AGE-SECRET-KEY-1...)`,
    );
  }
  if (!devices.identity) {
    throw new PushPullError(
      'no-identity',
      "opening what the remote holds needs this device's age private key: run hitld store device init (the OS keychain), or set HITLD_STORE_IDENTITY or pass --identity-fd <n>; never on the command line",
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
    writeSynced(o.root, o.url, { version, head: /** @type {string} */ (merged.incoming) });
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
  if (readSynced(o.root, o.url)?.version === version) {
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
  // Refused unless this device's key is on main's list. Enrolled means its own key is among the
  // recipients, so the device can always open what it pushed.
  assertEnrolled(o.devices);
  const recipients = checkRecipients(o.devices.recipients);
  const rotating = o.devices.rotation.pending.length > 0;
  ensureRepo(o.root);
  if (!hasText(o.root)) {
    throw new PushPullError('nothing-to-push', 'the store holds no text to push yet');
  }
  const sealOptions = { root: o.root, projectId: o.projectId, recipients, now: o.now };
  let sealed = sealStore(sealOptions);
  const synced = readSynced(o.root, o.url);
  const remoteHead = await o.remote.head();
  // Nothing new is still pushed while a rotation is pending: the remote's head was encrypted to
  // the removed key, and must be replaced by one that is not.
  if (!rotating && synced && remoteHead === synced.version && sealed.head === synced.head) {
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
  writeSynced(o.root, o.url, { version, head: sealed.head });
  const rotation = await completeRotation({
    remote: o.remote,
    store: openStore(o.root),
    resolution: o.devices,
    version,
    now: o.now,
  });
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
    device: o.devices.device,
    rotation,
  };
}

/**
 * @typedef {object} DeviceLookup
 * @property {string} checkout the project's checkout, where main and store-devices.json are read
 * @property {string} store the private store's directory
 * @property {NodeJS.ProcessEnv} env
 * @property {string} projectId
 * @property {string} mainBranch policy.json merge.main_branch
 */

/**
 * This device as main's list sees it, without fetching: for pull and status.
 * @param {DeviceLookup} l
 */
export const devicesHere = (l) =>
  resolveDevices({
    root: l.checkout,
    store: l.store,
    env: l.env,
    projectId: l.projectId,
    mainBranch: l.mainBranch,
  });

/**
 * This device for a push: fetch main from origin so the list is current, resolve, and refuse a
 * device that is not on it (device-not-enrolled). A fetch that fails refuses the push rather than
 * use a list that may still hold a removed device. A checkout with no origin remote has nothing
 * to fetch, and its local main is the list.
 * @param {DeviceLookup} l
 */
export function devicesForPush(l) {
  const fetched = fetchMain(l.checkout, l.mainBranch, l.env);
  return { ...assertEnrolled(devicesHere(l)), fetched };
}

/**
 * Fetch the main branch from origin into its remote-tracking ref. Run as git.mjs runs git: an
 * argument list, hooks and fsmonitor off, no prompt. The owner's own git configuration is used, so
 * the credential helper or proxy their checkout already uses keeps working.
 * @param {string} checkout @param {string} mainBranch @param {NodeJS.ProcessEnv} env
 * @returns {'fetched' | 'no-origin'}
 */
export function fetchMain(checkout, mainBranch, env) {
  /** @param {string[]} args */
  const run = (args) =>
    spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
      cwd: checkout,
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  if (run(['remote', 'get-url', 'origin']).status !== 0) return 'no-origin';
  const r = run([
    'fetch',
    '--quiet',
    '--no-tags',
    'origin',
    `+refs/heads/${mainBranch}:refs/remotes/origin/${mainBranch}`,
  ]);
  if (r.status !== 0) {
    const why = (r.stderr || r.error?.message || 'failed').trim().split('\n')[0];
    throw new PushPullError(
      'devices-fetch-failed',
      `could not fetch ${mainBranch} from origin to read the current store-devices.json (${why}); nothing was pushed. Fix the connection and push again`,
    );
  }
  return 'fetched';
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
 * @param {{
 *   root: string,
 *   projectId: string,
 *   devices: import('./devices-port.mjs').Devices,
 *   opened: (RemoteChoice & { remote: import('./remote.mjs').StoreRemote }) | null,
 *   policyUrl?: string | null,
 * }} o
 */
export async function storeStatus(o) {
  // A store that holds files but no repository yet (a fresh one) gets its git bookkeeping, so its
  // text can be told from its machine-local files. Nothing is committed.
  const exists = existsSync(resolve(o.root));
  if (exists) ensureRepo(o.root);
  const local = exists ? localHead(o.root) : null;
  const changed = exists && hasUncommitted(o.root);
  const synced = o.opened ? readSynced(o.root, o.opened.url) : null;
  const override = readRemoteConfig(o.root);
  /** @type {string | null} */
  let remoteVersion = null;
  /** @type {{ code: string, message: string } | null} */
  let remoteError = null;
  if (o.opened) {
    try {
      remoteVersion = await o.opened.remote.head();
    } catch (e) {
      if (!(e instanceof StoreRemoteError)) throw e;
      remoteError = { code: e.code, message: e.message };
    }
  }
  const holdsText = local !== null || changed;
  return {
    ok: true,
    project: o.projectId,
    remote: o.opened && { url: o.opened.url, source: o.opened.source },
    policy_url: o.policyUrl ?? null,
    override_url: override?.url ?? null,
    local_version: local,
    local_changed: changed,
    remote_version: remoteVersion,
    remote_error: remoteError,
    synced: synced,
    push_due: o.opened ? holdsText && (changed || !synced || synced.head !== local) : false,
    pull_due:
      o.opened && !remoteError ? remoteVersion !== null && remoteVersion !== synced?.version : null,
    device: {
      name: o.devices.device,
      enrolled: o.devices.enrolled,
      has_identity: o.devices.identity !== null,
      recipients: o.devices.recipients.length,
    },
  };
}
