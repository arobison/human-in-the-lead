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

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { StoreRemoteError, remoteMoved } from './remote.mjs';

/** The branch on the remote unless another is named. */
export const STORE_BRANCH = 'hitld-store';
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
 * Accept a git URL the transport may use, or refuse it. Allowed: `https://host/path`,
 * `ssh://[user@]host[:port]/path`, `user@host:path`, `file:///path` and an absolute path. Refused:
 * a password in the URL (no token is kept here), plain http, the `ext::` and other helper forms,
 * anything that starts with a dash or holds a control character or space, and a URL with no path.
 * @param {unknown} url
 * @returns {string} the URL, unchanged
 */
export function checkRemoteUrl(url) {
  const bad = (/** @type {string} */ why) =>
    new StoreRemoteError('remote-url-invalid', `not a usable git URL: ${why}`);
  if (typeof url !== 'string' || url === '') throw bad('it is empty');
  if (url.length > 2048) throw bad('it is too long');
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
  if (
    typeof branch !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(branch) ||
    branch.includes('..') ||
    branch.endsWith('.lock')
  ) {
    throw new StoreRemoteError('remote-argument-invalid', `not a usable branch name: ${branch}`);
  }
  const dir = checkDir(options.dir);
  const ref = `refs/heads/${branch}`;

  /** @type {Promise<[string, string][]> | undefined} */
  let connection;
  /** @type {Promise<void> | undefined} */
  let ready;

  /** @param {string[]} args @param {{ input?: Uint8Array, allowFail?: boolean }} [o] */
  async function git(args, o = {}) {
    const env = baseEnv(dir);
    const pairs = await (connection ??= connectionConfig(dir));
    env.GIT_CONFIG_COUNT = String(pairs.length);
    pairs.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k;
      env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    return run(dir, env, args, o);
  }

  /** The local bare repository, made once. */
  const init = () =>
    (ready ??= (async () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!existsSync(join(dir, 'HEAD'))) await git(['init', '-q', '--bare']);
    })());

  /** @param {string[]} args @param {{ input?: Uint8Array }} [o] */
  const text = async (args, o) => (await git(args, o)).stdout.toString('utf8').trim();

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
 * @param {string} dir @returns {Promise<[string, string][]>}
 */
async function connectionConfig(dir) {
  /** @type {[string, string][]} */
  const out = [];
  for (const scope of ['--system', '--global']) {
    const env = baseEnv(dir);
    delete env.GIT_CONFIG_NOSYSTEM;
    delete env.GIT_CONFIG_GLOBAL;
    const r = await run(dir, env, ['config', scope, '--includes', '--list', '-z'], {
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
 * Run git without a shell. Hooks, signing, the file monitor and garbage collection on its own are
 * off.
 * @param {string} cwd @param {Record<string, string>} env @param {string[]} args
 * @param {{ input?: Uint8Array, allowFail?: boolean }} o
 * @returns {Promise<{ ok: boolean, stdout: Buffer, stderr: string }>}
 */
function run(cwd, env, args, o) {
  const full = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'commit.gpgSign=false',
    '-c',
    'gc.auto=0',
    ...args,
  ];
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
