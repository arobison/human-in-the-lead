// Moving the private store through its remote (design 0003, sections 7, 8 and 12): push, pull and
// status, and the remote's address.
//
// What moves is the store's committed text, as one age file (format 2) per push, encrypted to the
// devices the resolver names (devices-port.mjs). The remote only ever holds those bytes. Pull
// opens the head with this device's key and merges it as `store import` does. A push is a compare
// and swap on the remote's head; when the remote has moved, it pulls, merges and tries again.
//
// Machine-local files never move: the bundle is built from the store's git history, which keeps
// them out (git.mjs, MACHINE_LOCAL). What this machine last merged is machine-local too. It lives
// inside the store's `.git` directory, which is never committed, never bundled and refused if a
// bundle carries it:
//   <store>/.git/hitld-sync.json     the remote version this store last merged or pushed, and the
//                                    local commit that version holds, written by pull and push
// The address comes from address.mjs: HITLD_STORE_REMOTE, the person file, or this machine's
// override, never the project's repository.
//
// Recipients and the private key come from `resolveDevices` (devices-port.mjs) and nowhere else:
// a push brings in the remote's head, then is encrypted to the devices the owner's answers
// approved, and a device the owner has not approved may not push. After a removal, the first push
// prunes the remote's older files (completeRotation). No passphrase is used: nothing writes
// format 1 to a remote.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { replaceFile } from './host.mjs';
import { formatOf, checkRecipients, open as openSealed } from './sealed.mjs';
import { AgeError, parseIdentities } from './age.mjs';
import { StoreRemoteError, pushWithRetry } from './remote.mjs';
import { STORE_BRANCH, createDevicesBranch, createGitRemote, remoteDir } from './remote-git.mjs';
import { ensureRepo, git, hasText, head as localHead } from './git.mjs';
import { importStore, sealStore } from './sync.mjs';
import { openStore } from './store.mjs';
import { assertEnrolled, completeRotation, resolveDevices } from './devices-port.mjs';
import {
  DevicesError,
  fingerprint,
  openDeviceAsks,
  pendingRequests,
  readApprovals,
  requestsOnBranch,
} from './devices.mjs';
import { syncCauses } from './reach.mjs';
import { NO_ADDRESS, chooseRemote, clearRemote, readRemoteConfig, setRemote } from './address.mjs';

export { chooseRemote, clearRemote, readRemoteConfig, setRemote };

/**
 * Every code this module throws. Lowercase kebab-case.
 *   no-remote           no address is set for this store
 *   no-identity         opening the remote's head needs this device's private key
 *   nothing-to-push     the store holds no text yet
 *   remote-not-format-2 the remote's head is not an age file
 *   sync-state-invalid  the machine-local record of what was merged is damaged
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

const STATE_FILE = 'hitld-sync.json';
/** How often a push pulls, merges and tries again after losing a race. */
const ATTEMPTS = 4;

/** @param {string} root @param {string} name */
const filePath = (root, name) => join(resolve(root), '.git', name);

/**
 * Read one of the machine-local JSON files, or null when it is not there.
 * @param {string} root @param {string} name @param {'sync-state-invalid'} code
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
  throw new PushPullError(code, `${path} is damaged; delete it`);
}

/** @param {string} root @param {string} name @param {Record<string, unknown>} value */
function writeJson(root, name, value) {
  const path = filePath(root, name);
  mkdirSync(join(resolve(root), '.git'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema_version: 1, ...value }, null, 2) + '\n', {
    mode: 0o600,
  });
  replaceFile(tmp, path);
}

/**
 * What this store last merged from the remote at `url` or pushed to it: the remote's version id,
 * and the local commit that version holds, and the devices that version is sealed to (null: not
 * known, as for a file written before manifests named them). A record made against another
 * address is not used.
 * @typedef {{ version: string, head: string, recipients: string[] | null }} Synced
 */

/** @param {string} root @param {string} url @returns {Synced | null} */
export function readSynced(root, url) {
  const v = readJson(root, STATE_FILE, 'sync-state-invalid');
  const s = /** @type {any} */ (v?.synced);
  if (!s) return null;
  if (
    typeof s.version !== 'string' ||
    typeof s.url !== 'string' ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s.head) ||
    (s.recipients !== undefined &&
      !(
        Array.isArray(s.recipients) &&
        s.recipients.every((/** @type {unknown} */ r) => typeof r === 'string')
      ))
  ) {
    throw new PushPullError('sync-state-invalid', `${filePath(root, STATE_FILE)} is damaged`);
  }
  return s.url === url
    ? {
        version: s.version,
        head: s.head,
        recipients: s.recipients ? [...s.recipients].sort() : null,
      }
    : null;
}

/**
 * Whether the devices a version was sealed to are these.
 * @param {string[] | null} sealedTo sorted, or null when not known @param {string[]} now sorted
 */
const sameSet = (sealedTo, now) =>
  sealedTo !== null && sealedTo.length === now.length && sealedTo.every((r, i) => r === now[i]);

/** @param {string} root @param {string} url @param {Synced} synced */
const writeSynced = (root, url, synced) =>
  writeJson(root, STATE_FILE, { synced: { url, ...synced } });

/** @typedef {import('./address.mjs').RemoteChoice} RemoteChoice */

/**
 * The remote at the address this store uses.
 * @param {string} root the private store's directory
 * @param {RemoteChoice | null} choice from chooseRemote (address.mjs)
 * @returns {RemoteChoice & { remote: import('./remote.mjs').StoreRemote }}
 */
export function openRemote(root, choice) {
  if (!choice) throw new PushPullError('no-remote', NO_ADDRESS);
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
    writeSynced(o.root, o.url, {
      version,
      head: /** @type {string} */ (merged.incoming),
      recipients: /** @type {string[] | null} */ (merged.sealed_to ?? null),
    });
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
 * Seal the store's text for the approved devices and push it as the remote's new head. The
 * remote's head is brought in first when this store has not merged it, so the approved set the
 * push encrypts to holds every owner's answer another device pushed (a removal included). A push
 * the remote refuses because it moved pulls the new head, merges it, resolves the devices again
 * and pushes on top of it; a conflict, or a remote that keeps moving, stops it.
 * @param {PushPullOptions & { refresh?: () => import('./devices-port.mjs').Devices }} o refresh:
 *   resolve this device again from the store, after a merge; without it, `devices` stands
 */
export async function pushStore(o) {
  // Refused unless the owner has approved this device's key, as far as this store knows. Enrolled
  // means its own key is among the recipients, so the device can always open what it pushed.
  assertEnrolled(o.devices);
  ensureRepo(o.root);
  if (!hasText(o.root)) {
    throw new PushPullError('nothing-to-push', 'the store holds no text to push yet');
  }
  /** @type {Array<{ version: string, result: string }>} */
  const merges = [];
  /** @param {string} version */
  const bringIn = async (version) => {
    let merged;
    try {
      merged = await mergeVersion(o, version);
    } catch (e) {
      // The head does not open with this key: the owner removed this device, or its approval was
      // pushed in a file sealed before it. Either way it may not push.
      if (e instanceof AgeError && e.code === 'age-no-match') {
        throw new DevicesError(
          'device-not-enrolled',
          "this device may not push the store: the remote's head does not open with its key, so the owner removed it, or no approved device has pushed since its approval",
        );
      }
      throw e;
    }
    if (!merged.ok) throw new Conflict(merged, version);
    merges.push({ version, result: /** @type {string} */ (merged.result) });
  };
  let devices = o.devices;
  const current = () => {
    devices = o.refresh ? assertEnrolled(o.refresh()) : devices;
    const recipients = checkRecipients(devices.recipients);
    return { recipients, mine: [...recipients].sort() };
  };

  const before = readSynced(o.root, o.url);
  const remoteHead = await o.remote.head();
  try {
    if (remoteHead !== null && remoteHead !== before?.version) await bringIn(remoteHead);
  } catch (e) {
    if (e instanceof Conflict) return { ...e.merged, remote_version: e.version };
    throw e;
  }
  let { recipients, mine } = current();
  const sealOptions = () => ({ root: o.root, projectId: o.projectId, recipients, now: o.now });
  let sealed = sealStore(sealOptions());
  const synced = readSynced(o.root, o.url);
  const rotating = () => devices.rotation.pending.length > 0;
  // Nothing new is still pushed while a rotation is pending (the remote's head was encrypted to
  // the removed key, and must be replaced by one that is not) and when the approved set is not
  // the one the head was sealed to (an approved device could not open it).
  if (
    !rotating() &&
    synced &&
    sameSet(synced.recipients, mine) &&
    remoteHead === synced.version &&
    sealed.head === synced.head
  ) {
    return {
      ok: true,
      result: 'up-to-date',
      project: o.projectId,
      version: remoteHead,
      head: sealed.head,
    };
  }
  const version = await pushWithRetry(o.remote, {
    bytes: sealed.bytes,
    expected: synced?.version ?? null,
    attempts: ATTEMPTS,
    async reconcile(actual) {
      if (actual !== null) await bringIn(actual);
      ({ recipients, mine } = current());
      sealed = sealStore(sealOptions());
      return { bytes: sealed.bytes, expected: actual };
    },
  }).catch((e) => {
    if (e instanceof Conflict) return e;
    throw e;
  });
  if (version instanceof Conflict) {
    return { ...version.merged, remote_version: version.version };
  }
  writeSynced(o.root, o.url, { version, head: sealed.head, recipients: mine });
  const rotation = await completeRotation({
    remote: o.remote,
    store: openStore(o.root),
    resolution: devices,
    version,
    now: o.now,
  });
  return {
    ok: true,
    result: 'pushed',
    project: o.projectId,
    version,
    previous_version: before?.version ?? null,
    head: sealed.head,
    recipients: recipients.length,
    bytes: sealed.bytes.length,
    merged: merges,
    device: devices.device,
    rotation,
  };
}

/**
 * @typedef {object} DeviceLookup
 * @property {string} store the private store's directory
 * @property {NodeJS.ProcessEnv} env
 * @property {string} projectId
 */

/**
 * This device as the store it holds sees it: the owner's answers in it.
 * @param {DeviceLookup} l
 */
export const devicesHere = (l) =>
  resolveDevices({ store: l.store, env: l.env, projectId: l.projectId });

/**
 * This device for a push: refuse it unless the owner has approved its key (device-not-enrolled).
 * The push itself brings in the remote's head and resolves again (pushStore, refresh).
 * @param {DeviceLookup} l
 */
export const devicesForPush = (l) => assertEnrolled(devicesHere(l));

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
 * Whether this device's key opens the remote's head. A device whose approval is only in its own
 * copy of the store (the owner removed it, or no approved device has sealed the store to it yet)
 * is told apart from one the remote's head is sealed to. `opens` is null when it cannot be told:
 * the remote has no head, the device has no key, or the remote cannot be read.
 * @param {{ remote: Pick<import('./remote.mjs').StoreRemote, 'head' | 'fetch'>, devices: import('./devices-port.mjs').Devices, version?: string | null }} o
 *   version: the remote's head, when the caller already has it
 * @returns {Promise<{ opens: boolean | null, problem: string | null }>}
 */
export async function headAccess(o) {
  if (!o.devices.identity) return { opens: null, problem: null };
  try {
    const version = o.version === undefined ? await o.remote.head() : o.version;
    if (version === null) return { opens: null, problem: null };
    const bytes = await o.remote.fetch(version);
    if (formatOf(bytes) !== 2) return { opens: null, problem: null };
    openSealed(bytes, { identities: parseIdentities(o.devices.identity) });
    return { opens: true, problem: null };
  } catch (e) {
    if (e instanceof AgeError && e.code === 'age-no-match') {
      return {
        opens: false,
        problem:
          "this device cannot open the store: the remote's head does not open with its key, so the owner has probably removed this device, or no approved device has sealed the store to it yet. What this device's own copy says about its approval is out of date",
      };
    }
    return { opens: null, problem: null };
  }
}

/**
 * This device as the remote's head sees it: when the head does not open with its key, it is not
 * enrolled, whatever its own copy of the approvals says.
 * @param {import('./devices-port.mjs').Devices} devices
 * @param {{ opens: boolean | null, problem: string | null }} access
 * @returns {import('./devices-port.mjs').Devices}
 */
export function seenFromRemote(devices, access) {
  if (access.opens !== false) return devices;
  return { ...devices, enrolled: false, problem: access.problem };
}

/**
 * Where the store stands against its remote, and what this device may do. It changes nothing in
 * the store. A remote that cannot be reached is reported, not raised.
 * @param {{
 *   root: string,
 *   projectId: string,
 *   devices: import('./devices-port.mjs').Devices,
 *   opened: (RemoteChoice & { remote: import('./remote.mjs').StoreRemote }) | null,
 *   required?: boolean,
 *   warnings?: string[],
 *   requests?: { requests: import('./devices.mjs').Device[], problems: string[] } | null,
 *   requestsError?: { code: string, message: string } | null,
 *   env?: NodeJS.ProcessEnv,
 * }} o required: policy.json store.remote.required; warnings: the caller's; requests: what the
 *   store repository's hitld-devices branch holds, fetched by the caller; env: to tell a cloud
 *   session, where an unattached store repository is a cause of its own
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
  // The remote's head decides whether this device is enrolled: its own copy of the approvals may be
  // from before the owner removed it.
  const access =
    o.opened && !remoteError
      ? await headAccess({ remote: o.opened.remote, devices: o.devices, version: remoteVersion })
      : { opens: null, problem: null };
  const devices = seenFromRemote(o.devices, access);
  const holdsText = local !== null || changed;
  const now = [...devices.recipients].sort();
  /** @type {'never-pushed' | 'local-changes' | 'recipients-changed' | null} */
  let pushReason = null;
  if (o.opened && holdsText) {
    if (!synced) pushReason = 'never-pushed';
    else if (changed || synced.head !== local) pushReason = 'local-changes';
    else if (devices.enrolled && !sameSet(synced.recipients, now)) {
      pushReason = 'recipients-changed';
    }
  }
  /** @type {string[]} */
  const problems = [];
  if (!o.opened && o.required) {
    problems.push(`policy.json store.remote.required is true, and ${NO_ADDRESS}`);
  }
  if (access.problem) problems.push(access.problem);
  // The one check a run's first-run setup makes: whether the store syncs here, and if not, why.
  const sync = syncCauses({
    address: o.opened?.url ?? null,
    required: o.required === true,
    env: o.env ?? {},
    remoteError,
    remoteEmpty: !remoteError && remoteVersion === null,
    opens: access.opens,
    devices: o.devices,
  });
  return {
    ok: true,
    project: o.projectId,
    remote: o.opened && { url: o.opened.url, source: o.opened.source },
    remote_required: o.required === true,
    override_url: override?.url ?? null,
    local_version: local,
    local_changed: changed,
    remote_version: remoteVersion,
    remote_error: remoteError,
    synced: synced && { version: synced.version, head: synced.head },
    push_due: pushReason !== null,
    push_reason: pushReason,
    pull_due:
      o.opened && !remoteError ? remoteVersion !== null && remoteVersion !== synced?.version : null,
    device: {
      name: devices.device,
      enrolled: devices.enrolled,
      has_identity: devices.identity !== null,
      recipients: devices.recipients.length,
      opens_remote: access.opens,
      ...(access.problem ? { problem: access.problem } : {}),
    },
    devices: deviceSummary(o.root, devices, o.requests ?? null, o.requestsError ?? null),
    sync,
    ...(problems.length ? { problems } : {}),
    ...(o.warnings?.length ? { warnings: o.warnings } : {}),
  };
}

/**
 * The device side of status and of the device list: the approved set, the requests waiting to be
 * put to the owner, and the device decisions waiting for the owner's answer.
 * @param {string} root the private store's directory
 * @param {import('./devices-port.mjs').Devices} devices
 * @param {{ requests: import('./devices.mjs').Device[], problems: string[] } | null} requests
 * @param {{ code: string, message: string } | null} requestsError
 */
export function deviceSummary(root, devices, requests, requestsError) {
  const records = existsSync(resolve(root)) ? readApprovals(openStore(root)) : [];
  /** @param {{ name: string, recipient: string }} d */
  const shown = (d) => ({
    name: d.name,
    fingerprint: fingerprint(d.recipient),
    recipient: d.recipient,
  });
  return {
    approved: devices.approved.map((d) => ({ ...shown(d), status: 'approved', added: d.added })),
    requests: requests
      ? pendingRequests(requests.requests, records).map((d) => ({
          ...shown(d),
          status: 'requested',
        }))
      : null,
    decisions: openDeviceAsks(records).map((r) => ({
      ...shown(r),
      status: 'waiting-for-owner',
      decision: r.decision,
      action: r.action,
      ...(r.check ? { check: r.check } : {}),
      answer_with: `hitld rights answer ${r.decision} --answer A${r.check ? ` --code ${r.check}` : ''}`,
    })),
    ...(requests?.problems.length ? { request_problems: requests.problems } : {}),
    ...(requestsError ? { requests_error: requestsError } : {}),
  };
}

/**
 * The requests on the store repository's hitld-devices branch, fetched now. Best effort: a store
 * repository that cannot be read gives the copy last fetched, and says why.
 * @param {string} root the private store's directory @param {string | null} url
 */
export async function fetchRequests(root, url) {
  if (!url) return { requests: null, error: null };
  ensureRepo(root);
  /** @type {{ code: string, message: string } | null} */
  let error = null;
  try {
    await createDevicesBranch({ url, dir: remoteDir(root) }).fetch();
  } catch (e) {
    if (!(e instanceof StoreRemoteError)) throw e;
    error = { code: 'devices-fetch-failed', message: e.message };
  }
  return { requests: requestsOnBranch(root, url), error };
}
