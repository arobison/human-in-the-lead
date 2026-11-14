// The person and machine settings files (design part 13.4): where they live, how they are read,
// and how they are written.
//
// Both are data only, with a schema_version, and are read with the same trusted loading as
// policy.json (readTrustedFile): a regular file, not a link, owned by the current user, writable by
// nobody else, in directories under the same rule. On top of that, a settings file inside a git
// working tree is refused, so personal plans, limits and local paths are never committed.
//
// Seams: the machine-wide registry (HITLD-40) lives in machineDir(), beside the machine file;
// `hitld machine detect` (HITLD-38) writes the machine profile through writeSettingsFile.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { schemas } from '../schema/registry.mjs';
import { mergePolicy, ownershipProblem, readTrustedFile } from '../policy/policy.mjs';
import { executorSignal } from '../cli/executor.mjs';

/**
 * @typedef {import('../schema/validate.mjs').ValidationError} ValidationError
 * @typedef {import('../schema/registry.mjs').SchemaRegistry} SchemaRegistry
 * @typedef {'person' | 'machine'} SettingsKind
 * @typedef {{ env?: NodeJS.ProcessEnv, home?: string }} LocationOptions env and home are for tests
 *
 * @typedef {object} SettingsLocation
 * @property {SettingsKind} kind
 * @property {string} base the XDG base directory; the file must stay inside it
 * @property {string} dir the directory that holds the file
 * @property {string} path the file
 *
 * @typedef {object} SettingsFile
 * @property {SettingsKind} kind
 * @property {string} path
 * @property {boolean} present
 * @property {Record<string, any> | null} data the validated file, or null when absent or refused
 * @property {ValidationError[]} errors
 */

export const SETTINGS_KINDS = /** @type {const} */ (['person', 'machine']);

/** What each file sets, for refusals. */
const WHY = 'settings set caps and limits';

const POSIX = process.platform !== 'win32' && typeof process.getuid === 'function';
const currentUid = () => (POSIX ? /** @type {() => number} */ (process.getuid)() : -1);

/**
 * An XDG base directory: the variable when it holds an absolute path, else the fallback under home.
 * @param {string | undefined} value @param {string} home @param {string[]} fallback
 */
const xdg = (value, home, fallback) =>
  value && isAbsolute(value) ? value : join(home, ...fallback);

/**
 * Where a settings file lives (design part 13.4). The person file is configuration:
 * $XDG_CONFIG_HOME/human-in-the-lead/person.json. The machine file sits beside the machine-wide
 * registry, next to the private stores: $XDG_DATA_HOME/human-in-the-lead/_machine/machine.json.
 * A project ID never starts with "_", so _machine cannot be a project's store.
 * @param {SettingsKind} kind @param {LocationOptions} [options]
 * @returns {SettingsLocation}
 */
export function settingsLocation(kind, options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (kind === 'person') {
    const base = xdg(env.XDG_CONFIG_HOME, home, ['.config']);
    const dir = join(base, 'human-in-the-lead');
    return { kind, base, dir, path: join(dir, 'person.json') };
  }
  if (kind === 'machine') {
    const base = xdg(env.XDG_DATA_HOME, home, ['.local', 'share']);
    const dir = join(base, 'human-in-the-lead', '_machine');
    return { kind, base, dir, path: join(dir, 'machine.json') };
  }
  throw new Error(`no settings file "${kind}": person or machine`);
}

/**
 * The machine directory: the machine file, and later the machine-wide registry (HITLD-40).
 * @param {LocationOptions} [options]
 */
export function machineDir(options = {}) {
  return settingsLocation('machine', options).dir;
}

/**
 * The git working tree that holds `dir`: the nearest directory at or above it with a `.git` entry,
 * whoever owns it. Null outside every working tree.
 * @param {string} dir @returns {string | null}
 */
export function gitWorkTreeOf(dir) {
  for (let d = dir; ; d = dirname(d)) {
    try {
      lstatSync(join(d, '.git'));
      return d;
    } catch {
      // no marker here
    }
    if (dirname(d) === d) return null;
  }
}

/** @param {string} dir the nearest directory at or above `dir` that exists */
function nearestExisting(dir) {
  for (let d = dir; ; d = dirname(d)) {
    try {
      statSync(d);
      return d;
    } catch {
      if (dirname(d) === d) return d;
    }
  }
}

/** The file each layer's keys belong in, for wrong-layer refusals. */
const FILE_OF = { person: 'person.json', machine: 'machine.json', project: 'policy.json' };

/**
 * The layer a key belongs to when it is not this file's, or null.
 * @param {SettingsKind} kind @param {string} path a validation error's path, such as env.port_range
 * @param {SchemaRegistry} registry
 * @returns {'person' | 'machine' | 'project' | null}
 */
function homeOf(kind, path, registry) {
  const [top, sub] = path.split('.');
  const known = (/** @type {string} */ id, /** @type {string[]} */ parts) => {
    /** @type {any} */
    let s = registry.get(id);
    for (const p of parts) {
      while (s?.$ref) s = registry.resolve(s.$ref, registry.get(id)).schema;
      s = s?.properties?.[p];
    }
    return s !== undefined;
  };
  const parts = sub === undefined ? [top] : [top, sub];
  const other = kind === 'person' ? 'machine' : 'person';
  if (known(other, parts)) return other;
  if (registry.policySections.includes(top)) {
    if (sub === undefined || known(`policy/${top}`, [sub])) return 'project';
  }
  return null;
}

/**
 * Validate settings data for a file, naming the home of a key that belongs to another layer.
 * @param {SettingsKind} kind @param {unknown} data @param {SchemaRegistry} [registry]
 * @returns {ValidationError[]}
 */
export function validateSettings(kind, data, registry = schemas()) {
  return registry.validateEntity(kind, data).map((e) => {
    if (!e.message.startsWith('is not a known key')) return e;
    const home = homeOf(kind, e.path, registry);
    return home
      ? { path: e.path, message: `is a ${home} setting; it belongs in ${FILE_OF[home]}` }
      : e;
  });
}

/**
 * Read a settings file. Absent is not an error: that layer is simply not set.
 * @param {SettingsKind} kind
 * @param {LocationOptions & { uid?: number, registry?: SchemaRegistry }} [options] uid is for tests
 * @returns {SettingsFile}
 */
export function loadSettingsFile(kind, options = {}) {
  const loc = settingsLocation(kind, options);
  const out = /** @type {SettingsFile} */ ({
    kind,
    path: loc.path,
    present: false,
    data: null,
    errors: [],
  });
  try {
    lstatSync(loc.path);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return out;
    out.present = true;
    out.errors.push({ path: loc.path, message: `cannot be read: ${String(e)}` });
    return out;
  }
  out.present = true;
  const read = readTrustedFile(loc.path, loc.base, { why: WHY, uid: options.uid });
  if ('error' in read) {
    out.errors.push({ path: loc.path, message: read.error });
    return out;
  }
  const tree = gitWorkTreeOf(dirname(read.real));
  if (tree) {
    out.errors.push({
      path: loc.path,
      message: `is inside the git working tree ${tree}; settings files live outside every repository, so it is not read`,
    });
    return out;
  }
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(read.text);
  } catch (e) {
    out.errors.push({
      path: loc.path,
      message: `cannot be read: ${e instanceof Error ? e.message : e}`,
    });
    return out;
  }
  const errors = validateSettings(kind, data, options.registry);
  if (errors.length) {
    out.errors.push(...errors.map((e) => ({ path: `${loc.path}: ${e.path}`, message: e.message })));
    return out;
  }
  out.data = /** @type {Record<string, any>} */ (data);
  return out;
}

/**
 * Why this process may not write settings, or null. Executors never write them (design part 13.4,
 * first run): `config write` refuses when HITLD_ROLE=executor or HITLD_DISPATCH is set, as answers
 * do, and when the process runs in a linked worktree (see executorSignal).
 * @param {NodeJS.ProcessEnv | undefined} env @param {string} cwd
 * @returns {string | null}
 */
export function writerRefusal(env, cwd) {
  if (env?.HITLD_ROLE === 'executor') return 'HITLD_ROLE is executor';
  if (env?.HITLD_DISPATCH) return 'HITLD_DISPATCH is set, so this process runs for a dispatch';
  return executorSignal(env, cwd);
}

/**
 * Validate and write a settings file, replacing it atomically with mode 600 in directories created
 * with mode 700. With merge, objects in `data` merge key by key into the current file and arrays
 * replace. Refused when the file or its directories would not pass trusted loading, or when the
 * location is inside a git working tree.
 * @param {SettingsKind} kind
 * @param {unknown} data
 * @param {LocationOptions & { cwd?: string, merge?: boolean, registry?: SchemaRegistry, uid?: number }} [options]
 *   cwd: the caller's working directory, for the executor check (default: the process's)
 * @returns {{ path: string, data: Record<string, any> }}
 */
export function writeSettingsFile(kind, data, options = {}) {
  const refusal = writerRefusal(options.env ?? process.env, options.cwd ?? process.cwd());
  if (refusal) throw new Error(`executors never write settings: ${refusal}`);
  const registry = options.registry ?? schemas();
  const loc = settingsLocation(kind, options);
  const uid = options.uid ?? currentUid();
  const tree = gitWorkTreeOf(nearestExisting(loc.dir));
  if (tree) {
    throw new Error(
      `${loc.path} is inside the git working tree ${tree}; settings files live outside every repository`,
    );
  }
  /** @type {import('node:fs').Stats | null} */
  let existing = null;
  try {
    existing = lstatSync(loc.path);
  } catch {
    existing = null;
  }
  let next = data;
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error(`${loc.path} is a symbolic link; not replaced`);
    if (!existing.isFile()) throw new Error(`${loc.path} is not a regular file; not replaced`);
    const problem = POSIX ? ownershipProblem(existing, uid) : null;
    if (problem) throw new Error(`${loc.path} is ${problem}; not replaced`);
    if (options.merge) {
      const current = loadSettingsFile(kind, { ...options, registry });
      if (!current.data) {
        throw new Error(
          `${loc.path} cannot be merged into: ${current.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
        );
      }
      next = mergePolicy(current.data, data);
    }
  }
  const errors = validateSettings(kind, next, registry);
  if (errors.length) {
    throw new Error(`refused: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }
  // Trust boundary: the directory comes from the current user's own XDG variables or home, never
  // from a repository; it is checked below before anything is written into it.
  mkdirSync(loc.dir, { recursive: true, mode: 0o700 });
  const realBase = realpathSync(loc.base);
  const realDir = realpathSync(loc.dir);
  const rel = relative(realBase, realDir);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${loc.dir} resolves to ${realDir}, outside ${realBase}; not written`);
  }
  if (POSIX) {
    for (let d = realDir; ; d = dirname(d)) {
      const problem = ownershipProblem(statSync(d), uid, { allowRoot: true });
      if (problem) throw new Error(`${d} is ${problem}; ${loc.path} not written`);
      if (d === realBase || dirname(d) === d) break;
    }
  }
  const tmp = join(realDir, `.${kind}.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  // Trust boundary: a new, exclusive file in the checked directory; the content passed the schema.
  const fd = openSync(tmp, flags, 0o600);
  try {
    writeSync(fd, JSON.stringify(next, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, join(realDir, `${kind}.json`));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  const back = loadSettingsFile(kind, { ...options, registry });
  if (!back.data) {
    throw new Error(
      `${loc.path} was written but does not load: ${back.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return { path: loc.path, data: back.data };
}
