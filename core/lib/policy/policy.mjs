// Loading policy.json (design parts 11.2 and 16.6).
//
// The defaults are the `default` values in schemas/policy/*.schema.json, documented beside each
// setting. A project's policy.json holds only what it changes: objects merge key by key with the
// defaults; arrays and plain values replace them. The merged policy is then validated as a whole,
// so unknown keys, code-running keys and out-of-bounds values are refused with their paths.

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {import('../schema/validate.mjs').ValidationError} ValidationError
 * @typedef {import('../schema/validate.mjs').Schema} Schema
 * @typedef {import('../schema/registry.mjs').SchemaRegistry} SchemaRegistry
 * @typedef {Record<string, any>} Policy
 * @typedef {{ path: string | null, policy: Policy | null, errors: ValidationError[], hash: string | null }} PolicyResult
 */

/** Where a consuming project keeps its policy, relative to the repository root. */
export const POLICY_PATH = join('.human-in-the-lead', 'policy.json');

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The default policy, read from the policy section schemas.
 * @param {SchemaRegistry} [registry]
 * @returns {Policy}
 */
export function policyDefaults(registry = schemas()) {
  /** @param {Schema} s @param {Schema} root @returns {unknown} */
  const fromSchema = (s, root) => {
    if (s.default !== undefined) return structuredClone(s.default);
    if (s.$ref) {
      const t = registry.resolve(s.$ref, root);
      return fromSchema(t.schema, t.root);
    }
    if (!s.properties) return undefined;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, sub] of Object.entries(s.properties)) {
      const v = fromSchema(sub, root);
      if (v !== undefined && !(isObject(v) && Object.keys(v).length === 0)) out[k] = v;
    }
    return out;
  };
  const root = registry.get('policy');
  const defaults = /** @type {Policy} */ (fromSchema(root, root));
  delete defaults.schema_version;
  return { schema_version: registry.currentVersion('policy'), ...defaults };
}

/**
 * Objects merge key by key; arrays and plain values in `over` replace those in `base`.
 * Keys that could pollute prototypes are copied as plain data and refused later by validation.
 * @param {unknown} base @param {unknown} over @returns {unknown}
 */
export function mergePolicy(base, over) {
  if (!isObject(base) || !isObject(over)) return structuredClone(over);
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @param {string} k @param {unknown} value */
  const put = (k, value) =>
    // defineProperty, not assignment: a "__proto__" key stays an own data property.
    Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
  for (const [k, v] of Object.entries(base)) put(k, structuredClone(v));
  for (const [k, v] of Object.entries(over)) {
    put(k, Object.hasOwn(base, k) ? mergePolicy(base[k], v) : structuredClone(v));
  }
  return out;
}

/**
 * Merge a project's policy with the defaults and validate the result.
 * @param {unknown} raw the parsed policy.json
 * @param {SchemaRegistry} [registry]
 * @returns {{ policy: Policy | null, errors: ValidationError[] }}
 */
export function resolvePolicy(raw, registry = schemas()) {
  if (!isObject(raw)) {
    return { policy: null, errors: [{ path: '(top level)', message: 'must be a JSON object' }] };
  }
  const merged = /** @type {Policy} */ (mergePolicy(policyDefaults(registry), raw));
  // The file must say which schema version it was written for; the defaults do not supply it.
  if (!Object.hasOwn(raw, 'schema_version')) delete merged.schema_version;
  const errors = registry.validateEntity('policy', merged);
  return errors.length ? { policy: null, errors } : { policy: merged, errors };
}

// Policy sets decision rights and quotas, so it is read only from places the current user controls.
// Owner and mode checks are skipped on Windows, where POSIX owners and modes do not apply; the
// symlink and inside-the-root checks still run there.
const POSIX = process.platform !== 'win32' && typeof process.getuid === 'function';
const currentUid = () => (POSIX ? /** @type {() => number} */ (process.getuid)() : -1);
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
// Non-blocking, so a FIFO planted as the policy file can't hang the open before the regular-file check.
const O_NONBLOCK = fsConstants.O_NONBLOCK ?? 0;

/**
 * Why a file or directory may not be trusted, or null if it may: owned by `uid` (or by root, when
 * `allowRoot`), and writable by nobody else.
 * @param {{ uid: number, mode: number }} st
 * @param {number} uid
 * @param {{ allowRoot?: boolean }} [options]
 * @returns {string | null}
 */
export function ownershipProblem(st, uid, options = {}) {
  if (st.uid !== uid && !(options.allowRoot && st.uid === 0)) {
    return `owned by another user (uid ${st.uid})`;
  }
  if (st.mode & 0o022) return `writable by group or others (mode ${(st.mode & 0o777).toString(8)})`;
  return null;
}

/**
 * The repository root: the nearest directory at or above `dir` with a `.git` entry (a directory,
 * or a file in a worktree) owned by the current user. A marker owned by someone else does not
 * make a repository, so the result is then null, as it is outside any repository.
 * @param {string} dir
 * @param {{ uid?: number }} [options] uid is for tests
 * @returns {string | null}
 */
export function findRepoRoot(dir, options = {}) {
  const uid = options.uid ?? currentUid();
  for (let d = resolve(dir); ; d = dirname(d)) {
    /** @type {import('node:fs').Stats | undefined} */
    let st;
    try {
      st = lstatSync(join(d, '.git'));
    } catch {
      st = undefined;
    }
    if (st) return POSIX && st.uid !== uid ? null : d;
    if (dirname(d) === d) return null;
  }
}

/**
 * Find policy.json by walking up from `cwd`, never above the repository root, so a file planted
 * in a parent directory (a shared temporary folder, say) cannot set decision rights or quotas.
 * Outside a repository, only `cwd` itself is searched.
 * @param {string} cwd @returns {string | null}
 */
export function findPolicyFile(cwd) {
  const start = resolve(cwd);
  const root = findRepoRoot(start) ?? start;
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, POLICY_PATH);
    if (existsSync(candidate)) return candidate;
    if (dir === root || dirname(dir) === dir) return null;
  }
}

/** @param {string} message */
const refuse = (message) => ({
  error: `${message}; policy sets decision rights, so it is not read`,
});

/**
 * Read a policy file only if it can be trusted. The file is opened once, without following a
 * symbolic link, and the checks and the read use that one descriptor, so the file cannot be
 * swapped between them. It must be a regular file owned by the current user and writable by
 * nobody else; its real path must lie inside `root`; and every directory from it up to `root`
 * must be owned by the current user or root and writable by nobody else.
 * @param {string} path
 * @param {string} root the repository root, or outside a repository the directory searched
 * @returns {{ text: string } | { error: string }}
 */
export function readTrustedPolicy(path, root) {
  try {
    if (lstatSync(path).isSymbolicLink()) return refuse('is a symbolic link');
  } catch (e) {
    return { error: `cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  /** @type {number} */
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    if (code === 'ELOOP' || code === 'EMLINK') return refuse('is a symbolic link');
    return { error: `cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return refuse('is not a regular file');
    const uid = currentUid();
    if (POSIX) {
      const problem = ownershipProblem(st, uid);
      if (problem) return refuse(`is ${problem}`);
    }
    const real = realpathSync(path);
    const realRoot = realpathSync(root);
    const rel = relative(realRoot, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return refuse(`resolves to ${real}, outside the repository root ${realRoot}`);
    }
    const now = statSync(real);
    if (now.ino !== st.ino || now.dev !== st.dev) return refuse('changed while it was being read');
    if (POSIX) {
      for (let dir = dirname(real); ; dir = dirname(dir)) {
        const problem = ownershipProblem(statSync(dir), uid, { allowRoot: true });
        if (problem) return refuse(`is in ${dir}, which is ${problem}`);
        if (dir === realRoot || dirname(dir) === dir) break;
      }
    }
    return { text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}

/**
 * Read, merge and validate policy.json.
 * @param {{ path?: string, cwd?: string, registry?: SchemaRegistry }} [options]
 * @returns {PolicyResult}
 */
export function loadPolicy(options = {}) {
  const registry = options.registry ?? schemas();
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = findRepoRoot(cwd) ?? cwd;
  const path = options.path ? resolve(cwd, options.path) : findPolicyFile(cwd);
  if (!path) {
    return {
      path: null,
      policy: null,
      hash: null,
      errors: [
        {
          path: POLICY_PATH,
          message:
            'was not found in this directory or a parent within the repository; create it from templates/policy.json',
        },
      ],
    };
  }
  const read = readTrustedPolicy(path, root);
  if ('error' in read) {
    return { path, policy: null, hash: null, errors: [{ path, message: read.error }] };
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(read.text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      path,
      policy: null,
      hash: null,
      errors: [{ path, message: `cannot be read: ${message}` }],
    };
  }
  const { policy, errors } = resolvePolicy(raw, registry);
  return { path, policy, errors, hash: policy ? policyHash(policy) : null };
}

/**
 * JSON with object keys sorted, so equal data always serializes the same way.
 * @param {unknown} v @returns {string}
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObject(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * The policy hash recorded in run state, the ledger and the audit trail: SHA-256 of the
 * effective (merged) policy in canonical JSON, so a change to a default changes the hash too.
 * @param {Policy} policy @returns {string}
 */
export function policyHash(policy) {
  return createHash('sha256').update(canonicalJson(policy)).digest('hex');
}
