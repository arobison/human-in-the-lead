// The first store transport: a private git repository, one per project (design 0003, section 7;
// Q3 and Q4).
//
// Layout on the remote. One branch (`hitld-store` unless another is named). Its tree holds
// `bundles/<seq>-<sha256>.bundle`, one file per version still kept: the sequence number is eight
// digits, the hash is of the file's bytes. The version id is the file's name without `.bundle`, so
// the newest id is the highest sequence, an id says what its bytes must hash to, and an id does not
// change when the history under it is rewritten. Each push is one commit on top of the last that
// adds one file.
//
// Compare and swap. A push builds its commit on the remote's current tip, and the plain (never
// forced) git push is refused by the remote when the tip has moved. The check against `expected`
// is made first so the caller learns the actual head; git's own refusal covers the race after it.
//
// Prune. The store repository is dumb storage that only holds ciphertext, so its branch history
// may be rewritten (design 0003, section 7). Prune writes one new root commit whose tree holds only
// the newest bundles and replaces the branch with `--force-with-lease` pinned to the tip it read,
// so it cannot overwrite a push that landed meanwhile. The head's version id does not change. The
// branch must not be protected against force pushes. The provider removes unreachable objects on
// its own schedule; prune bounds the branch, it does not promise immediate erasure.
//
// Device requests. A second branch, `hitld-devices`, holds `proposals/<name>.json`: a new
// device's name and public key, put there by `hitld store device init` for the owner to approve
// (design 0003, section 6). The branch is not protected, and anyone who can write the store
// repository can change it, so nothing on it is trusted: the devices a push is encrypted to are
// the owner's answers, recorded inside the encrypted store. A request push is never forced.
//
// The ID counter. A third branch, `hitld-ids`, holds `ids.json`: per tracker key and ID block,
// the highest number any session has taken (design part 3.4, ID allocation). A session takes the
// next number by pushing a commit that raises it on top of the tip it read; the plain push is the
// compare and swap, so two sessions never take the same number, and the one that loses the race
// reads the new tip and tries again. The file holds numbers only, nothing about the items. It is
// not trusted either: a number set too high leaves a gap, and one set too low is caught by the
// check against origin that every allocation also makes.
//
// Trust boundary. Authentication is the session's own git access: plain `git` over the configured
// URL, with no token handled here. Git runs as in git.mjs: an argument list, no shell, GIT_DIR
// pinned to a bare repository inside the private store (never the project's checkout), hooks off,
// signing off, prompts off. The owner's global and system git config are ignored, with one
// exception: the keys that say how to reach and sign in to a host (`credential.*`, `http.*`,
// `url.<base>.insteadOf`) are read from them and from GIT_CONFIG_* and passed on, so the
// credential helper or proxy the session already uses still works. Proxy, certificate and ssh
// agent variables pass through; nothing else of the environment does. Only https, ssh and file
// (a local or mounted repository) may be used. The bytes are opaque here: no key, passphrase or
// plain text reaches this module.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { StoreRemoteError, remoteMoved } from './remote.mjs';
import { DEVICES_BRANCH, PROPOSALS_DIR } from './placement.mjs';

export { DEVICES_BRANCH, PROPOSALS_DIR };

/** The branch on the remote unless another is named. */
export const STORE_BRANCH = 'hitld-store';
/** The branch on the remote that holds the shared ID counter. */
export const IDS_BRANCH = 'hitld-ids';
/** The counter's file on that branch. */
export const IDS_FILE = 'ids.json';
/** The largest bundle pushed; GitHub refuses files over 100 MiB. */
export const MAX_BUNDLE_BYTES = 90 * 1024 * 1024;
/** How often a push or prune re-reads the remote after losing a race to another writer. */
const ATTEMPTS = 4;

const BUNDLES = 'bundles';
/** Where the remote's tip is fetched to, in the local bare repository. */
const TIP_REF = 'refs/hitld/remote-tip';
const ID = /^(\d{8})-([0-9a-f]{64})$/;
const FILE = /^(\d{8}-[0-9a-f]{64})\.bundle$/;

/** The environment variables that say how to reach a host; everything else is dropped. */
const PASS_THROUGH = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'GIT_SSL_CAINFO',
  'GIT_SSL_CAPATH',
  'CURL_CA_BUNDLE',
  'SSH_AUTH_SOCK',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GCM_INTERACTIVE',
];

/** The config keys that may cross from the owner's config and GIT_CONFIG_*: how to reach a host. */
const CONNECTION_KEY = /^(credential\..+|http\..+|url\..+\.(insteadof|pushinsteadof))$/i;

/**
 * Whether a URL is a local repository path as Windows writes one: a drive path
 * (`C:\stores\store.git` or `C:/stores/store.git`), also after `file://` or `file:///` as Git for
 * Windows reads it, or a UNC path (`\\server\share\store.git`). Backslashes are its separators and
 * a space is part of it (a profile directory's name can hold one): it reaches git as one argument,
 * never through a shell. A control character, a character Windows refuses in a file name
 * (`"*:<>?|`, the colon after the drive aside) or a path that names no directory is refused.
 * @param {string} url
 */
function windowsLocalPath(url) {
  const path = url.replace(/^file:\/\/\/?(?=[A-Za-z]:)/i, '');
  const drive = /^[A-Za-z]:[\\/]/.test(path);
  const unc = path === url && /^\\\\[A-Za-z0-9][\w.-]*\\[^\\/]/.test(path);
  if (!drive && !unc) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f"*<>?|]/.test(path) || path.slice(2).includes(':')) return false;
  return path.split(/[\\/]/).filter(Boolean).length >= 2;
}

/**
 * Accept a git URL the transport may use, or refuse it. Allowed: `https://host/path`,
 * `ssh://[user@]host[:port]/path`, `user@host:path`, `file:///path` and an absolute path. Refused:
 * a password in the URL (no token is kept here), plain http, the `ext::` and other helper forms,
 * anything that starts with a dash or holds a control character or space, and a URL with no path.
 * On Windows, a local path may also be a drive or UNC path (see windowsLocalPath).
 * @param {unknown} url
 * @param {NodeJS.Platform} [platform] the system git runs on; for tests
 * @returns {string} the URL, unchanged
 */
export function checkRemoteUrl(url, platform = process.platform) {
  const bad = (/** @type {string} */ why) =>
    new StoreRemoteError('remote-url-invalid', `not a usable git URL: ${why}`);
  if (typeof url !== 'string' || url === '') throw bad('it is empty');
  if (url.length > 2048) throw bad('it is too long');
  if (platform === 'win32' && windowsLocalPath(url)) return url;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\]/.test(url)) throw bad('it holds a space, control or backslash');
  if (url.startsWith('-')) throw bad('it starts with a dash');
  if (url.includes('::')) throw bad('transport helpers are not allowed');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw bad('it does not parse');
    }
    if (!['https:', 'ssh:', 'file:'].includes(parsed.protocol)) {
      throw bad(`${parsed.protocol.slice(0, -1)} is not allowed; use https or ssh`);
    }
    if (parsed.password) throw bad('it holds a password; sign in through git, not the URL');
    if (parsed.protocol !== 'file:' && !parsed.hostname) throw bad('it has no host');
    if (parsed.pathname.length <= 1) throw bad('it names no repository');
    return url;
  }
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9.-]*:[^/\s][^\s]*$/.test(url)) return url;
  if (isAbsolute(url) && url.length > 1) return url;
  throw bad('use https://host/owner/repo.git, ssh://git@host/owner/repo.git or an absolute path');
}

/**
 * Where the private store at `root` keeps the local copy of its remote: a bare repository inside
 * the store's own .git directory.
 * @param {string} root the private store's directory
 */
export const remoteDir = (root) => join(resolve(root), '.git', 'hitld-remote');

/**
 * @typedef {object} GitRemoteOptions
 * @property {string} url the repository's git URL (see checkRemoteUrl)
 * @property {string} dir a directory in the private store for the local bare copy (see remoteDir)
 * @property {string} [branch] the branch that holds the bundles
 */

/**
 * A StoreRemote over a git repository.
 * @param {GitRemoteOptions} options
 * @returns {import('./remote.mjs').StoreRemote}
 */
export function createGitRemote(options) {
  const url = checkRemoteUrl(options.url);
  const branch = options.branch ?? STORE_BRANCH;
  if (!usableBranch(branch)) {
    throw new StoreRemoteError('remote-argument-invalid', `not a usable branch name: ${branch}`);
  }
  const dir = checkDir(options.dir);
  const ref = `refs/heads/${branch}`;
  const { git, init, text } = localRepo(dir);

  /** The remote branch's tip commit, or null when the branch does not exist yet. */
  async function remoteSha() {
    const r = await git(['ls-remote', url, ref], { allowFail: true });
    if (!r.ok) throw unreachable(r.stderr);
    const line = r.stdout.toString('utf8').split('\n').find(Boolean);
    return line ? line.split('\t')[0] : null;
  }

  /**
   * The remote's tip, fetched into the local copy, and the bundles its tree holds, oldest first.
   * @returns {Promise<{ commit: string | null, bundles: Bundle[] }>}
   */
  async function readTip() {
    await init();
    if ((await remoteSha()) === null) return { commit: null, bundles: [] };
    const fetched = await git(
      [
        '-c',
        'transfer.fsckObjects=true',
        'fetch',
        '-q',
        '--no-tags',
        '--no-write-fetch-head',
        url,
        `+${ref}:${TIP_REF}`,
      ],
      { allowFail: true },
    );
    if (!fetched.ok) throw unreachable(fetched.stderr);
    const commit = await text(['rev-parse', '--verify', TIP_REF]);
    return { commit, bundles: await listBundles(commit) };
  }

  /** @param {string} commit @returns {Promise<Bundle[]>} */
  async function listBundles(commit) {
    const raw = (await git(['ls-tree', '-z', commit, `${BUNDLES}/`])).stdout.toString('utf8');
    /** @type {Bundle[]} */
    const out = [];
    for (const rec of raw.split('\0')) {
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const [mode, type, sha] = rec.slice(0, tab).split(' ');
      const m = FILE.exec(rec.slice(tab + 1).replace(`${BUNDLES}/`, ''));
      if (m && mode === '100644' && type === 'blob') out.push({ id: m[1], sha });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /**
   * A commit whose tree holds exactly these bundles.
   * @param {Bundle[]} bundles @param {string | null} parent @param {string} message
   */
  async function commitOf(bundles, parent, message) {
    const sub = await text(['mktree', '-z'], {
      input: Buffer.from(bundles.map((b) => `100644 blob ${b.sha}\t${b.id}.bundle\0`).join('')),
    });
    const root = await text(['mktree', '-z'], {
      input: Buffer.from(`040000 tree ${sub}\t${BUNDLES}\0`),
    });
    return text(['commit-tree', root, ...(parent ? ['-p', parent] : []), '-m', message]);
  }

  return {
    async head() {
      const { bundles } = await readTip();
      return bundles.length ? bundles[bundles.length - 1].id : null;
    },

    async fetch(version) {
      const m = typeof version === 'string' ? ID.exec(version) : null;
      if (!m) {
        throw new StoreRemoteError(
          'remote-version-invalid',
          `not a version id: ${String(version)}`,
        );
      }
      const { bundles } = await readTip();
      const found = bundles.find((b) => b.id === version);
      if (!found) {
        throw new StoreRemoteError(
          'remote-version-missing',
          `the remote does not hold version ${version}`,
          { version },
        );
      }
      const bytes = (await git(['cat-file', 'blob', found.sha])).stdout;
      if (createHash('sha256').update(bytes).digest('hex') !== m[2]) {
        throw new StoreRemoteError('remote-corrupt', `version ${version} does not match its hash`, {
          version,
        });
      }
      return bytes;
    },

    async push(bytes, { expected }) {
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        throw new StoreRemoteError(
          'remote-argument-invalid',
          'push needs bytes that are not empty',
        );
      }
      if (bytes.length > MAX_BUNDLE_BYTES) {
        throw new StoreRemoteError(
          'remote-too-large',
          `a bundle of ${bytes.length} bytes is over the ${MAX_BUNDLE_BYTES} the remote takes`,
        );
      }
      if (expected !== null && !(typeof expected === 'string' && ID.test(expected))) {
        throw new StoreRemoteError('remote-version-invalid', `not a version id: ${expected}`);
      }
      let last = '';
      for (let i = 0; i < ATTEMPTS; i++) {
        const { commit, bundles } = await readTip();
        const actual = bundles.length ? bundles[bundles.length - 1].id : null;
        if (actual !== expected) throw remoteMoved(expected, actual);
        const seq = actual ? Number(/** @type {RegExpExecArray} */ (ID.exec(actual))[1]) + 1 : 1;
        const id = `${String(seq).padStart(8, '0')}-${createHash('sha256').update(bytes).digest('hex')}`;
        const sha = await text(['hash-object', '-w', '--stdin'], { input: bytes });
        const next = await commitOf([...bundles, { id, sha }], commit, `store bundle ${id}`);
        const pushed = await git(['push', '-q', '--no-verify', url, `${next}:${ref}`], {
          allowFail: true,
        });
        if (pushed.ok) return id;
        last = pushed.stderr;
        // Refused because the tip moved: the next round reports the new head. Refused for another
        // reason (access, a size limit): the tip is unchanged, so say so below.
        if ((await readTip()).commit === commit) break;
      }
      throw new StoreRemoteError('remote-git-failed', `git push was refused: ${last}`);
    },

    async prune({ keep }) {
      if (!Number.isInteger(keep) || keep < 1) {
        throw new StoreRemoteError(
          'remote-argument-invalid',
          'keep must be a whole number, 1 or more',
        );
      }
      let last = '';
      for (let i = 0; i < ATTEMPTS; i++) {
        const { commit, bundles } = await readTip();
        const kept = bundles.slice(-keep);
        const removed = bundles.slice(0, bundles.length - kept.length);
        if (!commit || removed.length === 0) {
          return { kept: kept.map((b) => b.id), removed: [] };
        }
        const next = await commitOf(kept, null, `store prune, keeping ${kept.length}`);
        const pushed = await git(
          [
            'push',
            '-q',
            '--no-verify',
            `--force-with-lease=${ref}:${commit}`,
            url,
            `${next}:${ref}`,
          ],
          { allowFail: true },
        );
        if (pushed.ok) {
          // Let go of the old history locally too.
          await git(['update-ref', TIP_REF, next]);
          await git(['gc', '-q', '--prune=now'], { allowFail: true });
          return { kept: kept.map((b) => b.id), removed: removed.map((b) => b.id) };
        }
        last = pushed.stderr;
        if ((await readTip()).commit === commit) break;
        // Another push landed first: prune again on top of it.
      }
      throw new StoreRemoteError('remote-git-failed', `git push was refused: ${last}`);
    },
  };
}

/** @typedef {{ id: string, sha: string }} Bundle a bundle's version id and its blob in git */

/** @param {unknown} branch @returns {branch is string} */
const usableBranch = (branch) =>
  typeof branch === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(branch) &&
  !branch.includes('..') &&
  !branch.endsWith('.lock');

/**
 * The local bare repository a remote is read and written through, and git run against it, by the
 * rules at the top of this file.
 * @param {string} dir a checked directory (checkDir)
 */
function localRepo(dir) {
  /** @type {[string, string][] | undefined} */
  let connection;
  /** @type {Promise<void> | undefined} */
  let ready;

  /** @param {string[]} args @param {{ input?: Uint8Array, allowFail?: boolean }} [o] */
  async function git(args, o = {}) {
    return run(dir, envWith(dir, (connection ??= connectionConfig(dir))), args, o);
  }

  /** The local bare repository, made once. */
  const init = () =>
    (ready ??= (async () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!existsSync(join(dir, 'HEAD'))) await git(['init', '-q', '--bare']);
    })());

  /** @param {string[]} args @param {{ input?: Uint8Array }} [o] */
  const text = async (args, o) => (await git(args, o)).stdout.toString('utf8').trim();

  return { git, init, text };
}

/**
 * Where the local bare repository keeps the last copy of a remote's device requests it fetched:
 * one ref per address, so requests read from one address are never taken for another's.
 * @param {string} url
 */
export const devicesRef = (url) =>
  `refs/hitld/devices/${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

/**
 * @typedef {object} DevicesBranch
 * @property {() => Promise<{ commit: string | null }>} fetch
 *   Fetch the requests branch into devicesRef(url), or drop that ref when the remote has no such
 *   branch (no device has asked). Throws remote-unreachable when the remote cannot be read.
 * @property {(request: { name: string, text: string, message: string }) => Promise<{ commit: string, pushed: boolean, existing: string | null }>} propose
 *   Put `text` at proposals/<name>.json on top of the branch and push it, never forced; when
 *   another push lands first, fetch and try again. A request already there with the same text
 *   pushes nothing. `existing` is the text the branch held at that path before, if any.
 */

/**
 * The store repository's requests branch (design 0003, section 6): where a new device puts its
 * name and public key for the owner to approve. Git runs as for the store's own branch: the same
 * local bare repository, the same rules, no token of its own. What is on this branch is never
 * trusted by itself; the approved set is the owner's answers, inside the encrypted store.
 * @param {GitRemoteOptions} options `branch` is the requests branch (default hitld-devices)
 * @returns {DevicesBranch}
 */
export function createDevicesBranch(options) {
  const url = checkRemoteUrl(options.url);
  const branch = options.branch ?? DEVICES_BRANCH;
  if (!usableBranch(branch)) {
    throw new StoreRemoteError('remote-argument-invalid', `not a usable branch name: ${branch}`);
  }
  const dir = checkDir(options.dir);
  const { git, init, text } = localRepo(dir);
  const local = devicesRef(url);
  const ref = `refs/heads/${branch}`;

  /** @returns {Promise<string | null>} */
  async function remoteSha() {
    const r = await git(['ls-remote', url, ref], { allowFail: true });
    if (!r.ok) throw unreachable(r.stderr);
    const line = r.stdout.toString('utf8').split('\n').find(Boolean);
    return line ? line.split('\t')[0] : null;
  }

  /** @returns {Promise<{ commit: string | null }>} */
  async function fetchBranch() {
    await init();
    if ((await remoteSha()) === null) {
      await git(['update-ref', '-d', local], { allowFail: true });
      return { commit: null };
    }
    const r = await git(
      [
        '-c',
        'transfer.fsckObjects=true',
        'fetch',
        '-q',
        '--no-tags',
        '--no-write-fetch-head',
        url,
        `+${ref}:${local}`,
      ],
      { allowFail: true },
    );
    if (!r.ok) throw unreachable(r.stderr);
    return { commit: await text(['rev-parse', '--verify', local]) };
  }

  /** The requests a commit holds: name to blob. @param {string} commit */
  async function requestsAt(commit) {
    const raw = (await git(['ls-tree', '-z', commit, `${PROPOSALS_DIR}/`])).stdout.toString('utf8');
    /** @type {Map<string, string>} */
    const out = new Map();
    for (const rec of raw.split('\0')) {
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const [mode, type, sha] = rec.slice(0, tab).split(' ');
      const name = rec.slice(tab + 1).replace(`${PROPOSALS_DIR}/`, '');
      if (mode === '100644' && type === 'blob' && /^[a-z0-9][a-z0-9._-]{0,63}\.json$/.test(name)) {
        out.set(name, sha);
      }
    }
    return out;
  }

  return {
    fetch: fetchBranch,

    async propose(request) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(request.name)) {
        throw new StoreRemoteError('remote-argument-invalid', `not a device name: ${request.name}`);
      }
      const file = `${request.name}.json`;
      let last = '';
      for (let i = 0; i < ATTEMPTS; i++) {
        const { commit } = await fetchBranch();
        const files = commit ? await requestsAt(commit) : new Map();
        const was = files.get(file);
        const existing = was
          ? (await git(['cat-file', 'blob', was])).stdout.toString('utf8')
          : null;
        if (commit && existing === request.text) return { commit, pushed: false, existing };
        const blob = await text(['hash-object', '-w', '--stdin'], {
          input: Buffer.from(request.text),
        });
        files.set(file, blob);
        const sub = await text(['mktree', '-z'], {
          input: Buffer.from(
            [...files.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([n, sha]) => `100644 blob ${sha}\t${n}\0`)
              .join(''),
          ),
        });
        const tree = await text(['mktree', '-z'], {
          input: Buffer.from(`040000 tree ${sub}\t${PROPOSALS_DIR}\0`),
        });
        const next = await text([
          'commit-tree',
          tree,
          ...(commit ? ['-p', commit] : []),
          '-m',
          request.message,
        ]);
        const pushed = await git(['push', '-q', '--no-verify', url, `${next}:${ref}`], {
          allowFail: true,
        });
        if (pushed.ok) return { commit: next, pushed: true, existing };
        last = pushed.stderr;
        // Refused because another request landed first: the next round builds on it.
        if ((await remoteSha()) === commit) break;
      }
      throw new StoreRemoteError('remote-git-failed', `git push was refused: ${last}`);
    },
  };
}

/**
 * The counter file's numbers: key, then block, then the highest number taken. Anything that is not
 * that shape is read as no number taken, so a damaged file never stops a session; the check
 * against origin covers what it lost.
 * @param {string} text @returns {Record<string, Record<string, number>>}
 */
function parseCounter(text) {
  /** @type {Record<string, Record<string, number>>} */
  const out = {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  const taken = data && typeof data === 'object' ? data.taken : null;
  if (!taken || typeof taken !== 'object' || Array.isArray(taken)) return out;
  for (const [key, blocks] of Object.entries(taken)) {
    if (!ID_KEY.test(key) || !blocks || typeof blocks !== 'object') continue;
    for (const [block, n] of Object.entries(blocks)) {
      if (BLOCK_NAME.test(block) && Number.isSafeInteger(n) && n > 0) {
        (out[key] ??= {})[block] = /** @type {number} */ (n);
      }
    }
  }
  return out;
}

const ID_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const BLOCK_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * @typedef {object} IdCounter
 * @property {(request: { key: string, block: string, from: number }) => number} take
 *   Take the next number for a tracker key and ID block: at least `from`, and above every number
 *   taken from this counter before. The raised counter is pushed, never forced; when another
 *   session pushed first, the new tip is read and the number taken again. Synchronous, since an
 *   ID is taken inside a create. Throws remote-unreachable when the remote cannot be read, and
 *   remote-git-failed when the push is refused for another reason.
 */

/**
 * The store repository's ID counter (design part 3.4, ID allocation): the `hitld-ids` branch,
 * through the same local bare repository and rules as the store's own branch.
 * @param {GitRemoteOptions} options `branch` is the counter's branch (default hitld-ids)
 * @returns {IdCounter}
 */
export function createIdCounter(options) {
  const url = checkRemoteUrl(options.url);
  const branch = options.branch ?? IDS_BRANCH;
  if (!usableBranch(branch)) {
    throw new StoreRemoteError('remote-argument-invalid', `not a usable branch name: ${branch}`);
  }
  const dir = checkDir(options.dir);
  const ref = `refs/heads/${branch}`;
  const local = `refs/hitld/ids/${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
  /** @type {[string, string][] | undefined} */
  let connection;
  /** @param {string[]} args @param {{ input?: Uint8Array, allowFail?: boolean }} [o] */
  const git = (args, o = {}) =>
    runSync(dir, envWith(dir, (connection ??= connectionConfig(dir))), args, o);
  /** @param {string[]} args @param {{ input?: Uint8Array }} [o] */
  const text = (args, o) => git(args, o).stdout.toString('utf8').trim();

  function init() {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(join(dir, 'HEAD'))) git(['init', '-q', '--bare']);
  }

  /** @returns {string | null} */
  function remoteSha() {
    const r = git(['ls-remote', url, ref], { allowFail: true });
    if (!r.ok) throw unreachable(r.stderr);
    const line = r.stdout.toString('utf8').split('\n').find(Boolean);
    return line ? line.split('\t')[0] : null;
  }

  /** @returns {{ commit: string | null, taken: Record<string, Record<string, number>> }} */
  function readTip() {
    init();
    if (remoteSha() === null) return { commit: null, taken: {} };
    const fetched = git(
      [
        '-c',
        'transfer.fsckObjects=true',
        'fetch',
        '-q',
        '--no-tags',
        '--no-write-fetch-head',
        url,
        `+${ref}:${local}`,
      ],
      { allowFail: true },
    );
    if (!fetched.ok) throw unreachable(fetched.stderr);
    const commit = text(['rev-parse', '--verify', local]);
    const blob = git(['cat-file', 'blob', `${commit}:${IDS_FILE}`], { allowFail: true });
    return { commit, taken: blob.ok ? parseCounter(blob.stdout.toString('utf8')) : {} };
  }

  return {
    take({ key, block, from }) {
      if (!ID_KEY.test(key) || !BLOCK_NAME.test(block) || !Number.isSafeInteger(from) || from < 1) {
        throw new StoreRemoteError(
          'remote-argument-invalid',
          'take needs a tracker key, a block name and a number from 1',
        );
      }
      let last = '';
      // More rounds than a push: every session that files at once can win one round ahead.
      for (let i = 0; i < ATTEMPTS * 2; i++) {
        const { commit, taken } = readTip();
        const n = Math.max(from, (taken[key]?.[block] ?? 0) + 1);
        const next = { ...taken, [key]: { ...taken[key], [block]: n } };
        const blob = text(['hash-object', '-w', '--stdin'], {
          input: Buffer.from(`${JSON.stringify({ schema_version: 1, taken: next }, null, 2)}\n`),
        });
        const tree = text(['mktree', '-z'], {
          input: Buffer.from(`100644 blob ${blob}\t${IDS_FILE}\0`),
        });
        const made = text([
          'commit-tree',
          tree,
          ...(commit ? ['-p', commit] : []),
          '-m',
          // A nonce: two sessions taking the same number at the same second must not make the
          // same commit, or the second push would succeed as already up to date.
          `take ${key}-${n} (${block}) ${randomBytes(8).toString('hex')}`,
        ]);
        const pushed = git(['push', '-q', '--no-verify', url, `${made}:${ref}`], {
          allowFail: true,
        });
        if (pushed.ok) {
          git(['update-ref', local, made], { allowFail: true });
          return n;
        }
        last = pushed.stderr;
        // Refused because another session took a number first: the next round reads it.
        if (remoteSha() === commit) break;
      }
      throw new StoreRemoteError('remote-git-failed', `git push was refused: ${last}`);
    },
  };
}

/** @param {string} why */
const unreachable = (why) =>
  new StoreRemoteError('remote-unreachable', `could not reach the remote: ${why}`);

/** @param {string} dirPath the local bare repository's directory */
function checkDir(dirPath) {
  const bad = (/** @type {string} */ why) =>
    new StoreRemoteError('remote-dir-invalid', `the local remote directory ${dirPath} ${why}`);
  if (typeof dirPath !== 'string' || !isAbsolute(dirPath)) throw bad('must be an absolute path');
  const dir = resolve(dirPath);
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw bad('is not a directory');
    if (existsSync(join(dir, '.git'))) throw bad('is a repository checkout; use a store directory');
    const mine = existsSync(join(dir, 'HEAD')) && existsSync(join(dir, 'objects'));
    if (!mine && readdirSync(dir).length > 0) throw bad('is not empty and not a bare repository');
  }
  return dir;
}

/** @param {string} dir the pinned repository */
function baseEnv(dir) {
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? dir,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_DIR: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https:ssh:file',
    GIT_AUTHOR_NAME: 'hitld',
    GIT_AUTHOR_EMAIL: 'hitld@localhost',
    GIT_COMMITTER_NAME: 'hitld',
    GIT_COMMITTER_EMAIL: 'hitld@localhost',
  };
  for (const name of PASS_THROUGH) {
    const v = process.env[name];
    if (v !== undefined) env[name] = v;
  }
  return env;
}

/**
 * The connection keys from the owner's system and global git config and from GIT_CONFIG_COUNT,
 * in the order git reads them. No other key crosses.
 * @param {string} dir @returns {[string, string][]}
 */
function connectionConfig(dir) {
  /** @type {[string, string][]} */
  const out = [];
  for (const scope of ['--system', '--global']) {
    const env = baseEnv(dir);
    delete env.GIT_CONFIG_NOSYSTEM;
    delete env.GIT_CONFIG_GLOBAL;
    const r = runSync(dir, env, ['config', scope, '--includes', '--list', '-z'], {
      allowFail: true,
    });
    if (!r.ok) continue;
    for (const rec of r.stdout.toString('utf8').split('\0')) {
      if (!rec) continue;
      const nl = rec.indexOf('\n');
      const key = nl < 0 ? rec : rec.slice(0, nl);
      if (CONNECTION_KEY.test(key)) out.push([key, nl < 0 ? '' : rec.slice(nl + 1)]);
    }
  }
  const count = Number(process.env.GIT_CONFIG_COUNT);
  if (Number.isInteger(count) && count > 0) {
    for (let i = 0; i < count; i++) {
      const key = process.env[`GIT_CONFIG_KEY_${i}`];
      const value = process.env[`GIT_CONFIG_VALUE_${i}`];
      if (key !== undefined && value !== undefined && CONNECTION_KEY.test(key)) {
        out.push([key, value]);
      }
    }
  }
  return out;
}

/**
 * The environment git runs in against `dir`: the base, with the connection keys passed on.
 * @param {string} dir @param {[string, string][]} pairs
 */
function envWith(dir, pairs) {
  const env = baseEnv(dir);
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

/** The options every git run starts with: hooks, signing, the file monitor and gc on its own off. */
const FIXED = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'gc.auto=0',
];

/**
 * Run git without a shell and wait for it, as `run` does. For a caller that cannot wait on a
 * promise: an ID is taken inside a synchronous create.
 * @param {string} cwd @param {Record<string, string>} env @param {string[]} args
 * @param {{ input?: Uint8Array, allowFail?: boolean, timeout?: number }} o
 * @returns {{ ok: boolean, stdout: Buffer, stderr: string }}
 */
function runSync(cwd, env, args, o) {
  const r = spawnSync('git', [...FIXED, ...args], {
    cwd,
    env,
    input: o.input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: o.timeout ?? 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = r.stdout ?? Buffer.alloc(0);
  const stderr = (r.stderr ?? Buffer.alloc(0)).toString('utf8').trim() || (r.error?.message ?? '');
  if (r.status === 0) return { ok: true, stdout, stderr: '' };
  if (o.allowFail) return { ok: false, stdout, stderr };
  throw new StoreRemoteError('remote-git-failed', `git ${args[0]} failed: ${stderr}`);
}

/**
 * Run git without a shell. Hooks, signing, the file monitor and garbage collection on its own are
 * off.
 * @param {string} cwd @param {Record<string, string>} env @param {string[]} args
 * @param {{ input?: Uint8Array, allowFail?: boolean }} o
 * @returns {Promise<{ ok: boolean, stdout: Buffer, stderr: string }>}
 */
function run(cwd, env, args, o) {
  const full = [...FIXED, ...args];
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', full, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.stdin.on('error', () => {
      // Git exited before it read its input; the exit code reports it.
    });
    child.on('error', (e) =>
      reject(new StoreRemoteError('remote-git-failed', `could not run git: ${e.message}`)),
    );
    child.on('close', (code) => {
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code === 0) return resolvePromise({ ok: true, stdout, stderr: '' });
      if (o.allowFail) return resolvePromise({ ok: false, stdout, stderr });
      reject(new StoreRemoteError('remote-git-failed', `git ${args[0]} failed: ${stderr}`));
    });
    child.stdin.end(o.input);
  });
}
