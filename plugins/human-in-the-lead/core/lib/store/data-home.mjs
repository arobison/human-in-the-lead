// Where human-in-the-lead keeps its data on this machine: the private stores, one directory per
// project ID, and _machine beside them (design part 3.3 and 13.4).
//
//   XDG_DATA_HOME set (an absolute path)  $XDG_DATA_HOME/human-in-the-lead, on every platform
//   Windows                               %LOCALAPPDATA%\human-in-the-lead
//   elsewhere                             ~/.local/share/human-in-the-lead
//
// Windows used ~/.local/share until the owner moved it (HITLD-245). Each entry (a project's store,
// or _machine) is resolved on its own: while it is still at the old place it resolves there, so no
// process makes a second, empty one at the new place. The first time a process resolves an entry
// that is still at the old place, it tries to move it, holding a lock for that entry:
//
//   - not while it is in use: a project store with executor worktrees or a run lease that is live,
//     or _machine with a resource lock whose holder is alive; the old releases that may still be
//     running use the old place, and moving it from under them would split the ledger or the locks
//   - not by an executor, and not when the old directory is a link (a relocation someone made)
//   - on one volume, one rename; across volumes, the source is first renamed aside in the old
//     directory (.<name>.moved), then copied to a temporary name in the new one (.<name>.moving-
//     <pid>), renamed into place, and the aside copy removed. A run that finds the aside copy
//     finishes the job: it copies again if the target is not there, else removes the copy. Names
//     that start with "." can never be a project ID, so a leftover is never taken for a project.
//
// Each outcome is said once per process, on standard error; a skip or a failure is noted for ten
// minutes in the new directory (.move-notes.json), so the status line and the hooks, which run as
// a new process each time, neither retry nor repeat it every time. Retries of a busy rename share
// one small budget per process.
//
// It imports only the platform layer and the cross-process mutex, so the store and the settings
// files may both use it.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { RM_RETRY } from '../platform/fs.mjs';
import { withMutexSync } from '../env/mutex.mjs';
import { isAlive } from '../env/proc.mjs';

export const DIR_NAME = 'human-in-the-lead';

/**
 * @typedef {{ rename?: (from: string, to: string) => void,
 *   rm?: (path: string, o: import('node:fs').RmOptions) => void }} MoveSeam
 * @typedef {{ env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform,
 *   report?: (message: string) => void, now?: () => number, seam?: MoveSeam }} DataHomeOptions
 *   env, home, platform, now and seam are for tests; report receives the move's messages
 *   (standard error by default)
 */

/** How long a skip or failure is remembered across processes. */
const NOTE_MS = 10 * 60_000;
/** A run lease renewed this recently, and not released, is live (twice the default expiry). */
const LEASE_LIVE_MS = 60 * 60_000;
/** The waits between attempts at a busy rename; all entries in a process share one budget. */
const WAITS = [10, 20, 40, 80, 160];
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES']);
let budgetMs = WAITS.reduce((a, b) => a + b, 0);
const NOTES = '.move-notes.json';

/**
 * A variable by name; on Windows, names are not case-sensitive (a test's plain object is).
 * @param {NodeJS.ProcessEnv} env @param {string} name @param {NodeJS.Platform} platform
 */
function lookup(env, name, platform) {
  if (env[name] !== undefined || platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** @param {string | undefined} v */
const absolute = (v) => (v && isAbsolute(v) ? v : null);

/** @param {DataHomeOptions} o */
const settings = (o) => {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  return { env, platform, home: o.home ?? homedir(), xdg: absolute(env.XDG_DATA_HOME) };
};

/**
 * The directory that holds the private stores and _machine, without moving anything.
 * @param {DataHomeOptions} [options]
 * @returns {string}
 */
export function dataDirPath(options = {}) {
  const { env, platform, home, xdg } = settings(options);
  if (xdg) return join(xdg, DIR_NAME);
  if (platform === 'win32') {
    const local = absolute(lookup(env, 'LOCALAPPDATA', platform)) ?? join(home, 'AppData', 'Local');
    return join(local, DIR_NAME);
  }
  return join(home, '.local', 'share', DIR_NAME);
}

/**
 * Where the directory was on Windows before HITLD-249, when nothing overrides it; else null.
 * @param {DataHomeOptions} [options]
 */
export function oldWindowsDataDir(options = {}) {
  const { platform, home, xdg } = settings(options);
  if (platform !== 'win32' || xdg) return null;
  const old = join(home, '.local', 'share', DIR_NAME);
  return resolve(old) === resolve(dataDirPath(options)) ? null : old;
}

/**
 * Every directory that may hold stores, for listing them: the data directory and, on Windows
 * while anything is left there, the old one.
 * @param {DataHomeOptions} [options]
 */
export function dataDirs(options = {}) {
  const old = oldWindowsDataDir(options);
  return [dataDirPath(options), ...(old && existsSync(old) ? [old] : [])];
}

/** Whether a directory entry name is one of the move's own (temporary, aside, lock, notes). */
export const isMoveLeftover = (/** @type {string} */ name) =>
  name.startsWith('.') || name.includes('.moving-') || name.endsWith('.moved');

/** @param {unknown} e */
const codeOf = (e) => /** @type {NodeJS.ErrnoException} */ (e)?.code ?? '';
/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));
/** @param {string} p */
const isEmptyDir = (p) => {
  try {
    return lstatSync(p).isDirectory() && readdirSync(p).length === 0;
  } catch {
    return false;
  }
};

/**
 * Why an entry may not move now, or null. A project store is in use while it has executor
 * worktrees or a live run lease; _machine while a resource lock's holder is alive.
 * @param {string} name @param {string} dir @param {number} now
 */
export function inUse(name, dir, now) {
  /** @param {string} p */
  const entries = (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  };
  if (name === '_machine') {
    for (const f of entries(join(dir, 'locks'))) {
      if (!f.endsWith('.lock')) continue;
      try {
        const pid = JSON.parse(readFileSync(join(dir, 'locks', f), 'utf8'))?.pid;
        if (isAlive(pid)) return `a resource lock is held (${f})`;
      } catch {
        // unreadable: not a live holder
      }
    }
    return null;
  }
  if (entries(join(dir, 'worktrees')).length) return 'it has executor worktrees';
  try {
    const lease = JSON.parse(readFileSync(join(dir, 'run-state.json'), 'utf8'))?.lease;
    const renewed = Date.parse(lease?.renewed_at);
    if (lease && !lease.released && now - renewed < LEASE_LIVE_MS) {
      return 'a run lease on it is live';
    }
  } catch {
    // no run state: no lease
  }
  return null;
}

/**
 * Rename, retrying a busy one from the process's shared budget.
 * @param {string} from @param {string} to @param {MoveSeam} seam @param {NodeJS.Platform} platform
 */
function rename(from, to, seam, platform) {
  const op = seam.rename ?? renameSync;
  for (let i = 0; ; i++) {
    try {
      return op(from, to);
    } catch (e) {
      const wait = WAITS[i];
      if (platform !== 'win32' || !BUSY.has(codeOf(e)) || wait === undefined || budgetMs < wait) {
        throw e;
      }
      budgetMs -= wait;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/** @param {string} dir */
function readNotes(dir) {
  try {
    const n = JSON.parse(readFileSync(join(dir, NOTES), 'utf8'));
    return n && typeof n === 'object' ? /** @type {Record<string, { at: number }>} */ (n) : {};
  } catch {
    return {};
  }
}

/** @param {string} dir @param {string} name @param {number | null} at null clears it */
function writeNote(dir, name, at) {
  const notes = readNotes(dir);
  if (at === null) delete notes[name];
  else notes[name] = { at };
  try {
    const tmp = join(dir, `${NOTES}.${process.pid}`);
    writeFileSync(tmp, JSON.stringify(notes));
    renameSync(tmp, join(dir, NOTES));
  } catch {
    // a note is a courtesy; without it the next process tries again
  }
}

/**
 * @typedef {{ state: 'not-there' | 'moved' | 'left' | 'both' | 'leftover', path: string,
 *   reason?: string, quiet?: boolean }} EntryMove where the entry is now, and what happened;
 *   quiet when another process said so in the last few minutes
 */

/**
 * The files under a directory with their sizes, to tell a complete copy from a partial one.
 * @param {string} dir @returns {string}
 */
function manifest(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d @param {string} rel */
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out.push(`${r}:${e.isFile() ? lstatSync(join(d, e.name)).size : 'link'}`);
    }
  };
  walk(dir, '');
  return out.join('\n');
}

/** Where an entry resolves now: the old place while it is there and the new one is not. */
const resolveNow = (/** @type {string} */ source, /** @type {string} */ target) =>
  existsSync(source) && (!existsSync(target) || isEmptyDir(target)) ? source : target;

/** Entries this process has already looked at, by old path. */
const looked = new Map();

/**
 * Move one entry (a project ID, or _machine) from the old Windows place, if it is there and may
 * move. Holds the entry's lock while it works.
 * @param {string} name
 * @param {DataHomeOptions} [options]
 * @returns {EntryMove}
 */
export function moveOldEntry(name, options = {}) {
  const { env, platform } = settings(options);
  const to = dataDirPath(options);
  const from = oldWindowsDataDir(options);
  const target = join(to, name);
  if (!from) return { state: 'not-there', path: target };
  const source = join(from, name);
  const aside = join(from, `.${name}.moved`);
  if (!existsSync(source) && !existsSync(aside)) return { state: 'not-there', path: target };
  const now = (options.now ?? Date.now)();
  const seam = options.seam ?? {};
  const rm = seam.rm ?? rmSync;
  /** @param {string} reason @returns {EntryMove} */
  const left = (reason) => ({ state: 'left', path: source, reason });

  const role = lookup(env, 'HITLD_ROLE', platform);
  if (role === 'executor' || lookup(env, 'HITLD_DISPATCH', platform)) {
    return left('an executor does not move it; the next hitld run outside an executor does');
  }
  try {
    if (lstatSync(from).isSymbolicLink()) {
      return left(`${from} is a link, so it is used where it points and not moved`);
    }
  } catch {
    // gone meanwhile; the checks below see it
  }
  try {
    mkdirSync(to, { recursive: true });
  } catch (e) {
    return left(`${to} cannot be made (${messageOf(e)})`);
  }
  const note = readNotes(to)[name];
  if (note && now - note.at < NOTE_MS) {
    const path = resolveNow(source, target);
    return { state: path === source ? 'left' : 'both', path, quiet: true };
  }

  const lock = join(to, `.${name}.move-lock`);
  /** @returns {EntryMove} */
  const work = () => {
    // Under the lock no other process owns a temporary copy: sweep them.
    for (const f of readdirSync(to)) {
      if (f.startsWith(`.${name}.moving-`)) rm(join(to, f), { recursive: true, force: true });
    }
    if (existsSync(aside)) {
      // An earlier cross-volume move renamed the source aside and stopped: before the copy was in
      // place (copy it again), or after (the copy matches: remove the aside one).
      if (!existsSync(target) || isEmptyDir(target)) {
        if (existsSync(target)) rmdirSync(target);
        copyAside(aside, target, null);
        return finish(aside, target);
      }
      if (manifest(aside) === manifest(target)) return finish(aside, target);
      return {
        state: 'both',
        path: target,
        reason: `${aside} holds the store from before a move that stopped, and ${target} differs from it; both were left as they are`,
      };
    }
    if (!existsSync(source)) return { state: 'not-there', path: target };
    if (existsSync(target)) {
      if (!isEmptyDir(target)) {
        return {
          state: 'both',
          path: target,
          reason: `it is at both places; ${source} was left as it is`,
        };
      }
      rmdirSync(target);
    }
    const busy = inUse(name, source, now);
    if (busy) return left(`${busy}; it moves once that ends`);
    try {
      rename(source, target, seam, platform);
      return { state: 'moved', path: target };
    } catch (e) {
      if (codeOf(e) !== 'EXDEV') throw e;
    }
    rename(source, aside, seam, platform);
    copyAside(aside, target, source);
    return finish(aside, target);
  };
  /**
   * Copy the aside directory to a temporary name, then rename it into place. If that fails, the
   * temporary copy goes and, when `back` is given, the aside directory returns there.
   * @param {string} from @param {string} into @param {string | null} back
   */
  const copyAside = (from, into, back) => {
    const temp = join(to, `.${name}.moving-${process.pid}`);
    try {
      cpSync(from, temp, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      rename(temp, into, seam, platform);
    } catch (e) {
      rm(temp, { recursive: true, force: true, ...RM_RETRY });
      if (back) rename(from, back, seam, platform);
      throw e;
    }
  };
  /** @param {string} rest @param {string} done @returns {EntryMove} */
  const finish = (rest, done) => {
    try {
      rm(rest, { recursive: true, force: true, ...RM_RETRY });
      return { state: 'moved', path: done };
    } catch (e) {
      return {
        state: 'leftover',
        path: done,
        reason: `the copy left at ${rest} can be deleted (${messageOf(e)})`,
      };
    }
  };
  /** @type {EntryMove} */
  let result;
  try {
    result = withMutexSync(lock, work, { timeoutMs: 5_000, staleMs: 60_000 });
  } catch (e) {
    if (existsSync(aside) && !existsSync(target)) {
      throw new Error(
        `${label(name)} is being moved to ${to} by another hitld process; try again in a moment`,
      );
    }
    const path = resolveNow(source, target);
    result =
      path === source
        ? left(`it could not be moved (${messageOf(e)}); the next run tries again`)
        : { state: 'not-there', path };
  }
  writeNote(to, name, result.state === 'moved' || result.state === 'not-there' ? null : now);
  if (result.state === 'moved') {
    try {
      rmdirSync(from);
    } catch {
      // other entries are still there
    }
  }
  return result;
}

/** @param {string} name */
const label = (name) => (name === '_machine' ? 'the machine directory' : `the store for ${name}`);

/**
 * Where an entry of the data directory is: a project's store, or _machine. On Windows, the first
 * call for an entry in a process moves it from the old place when it may (moveOldEntry), and says
 * what happened; while it stays there, it resolves there.
 * @param {string} name
 * @param {DataHomeOptions} [options]
 * @returns {string}
 */
export function entryDir(name, options = {}) {
  const from = oldWindowsDataDir(options);
  if (!from) return join(dataDirPath(options), name);
  const key = `${join(from, name)}\0${dataDirPath(options)}`;
  if (looked.has(key)) return resolveNow(join(from, name), join(dataDirPath(options), name));
  /** @type {EntryMove & { quiet?: boolean }} */
  const r = moveOldEntry(name, options);
  looked.set(key, true);
  const report = options.report ?? ((m) => process.stderr.write(`${m}\n`));
  if (r.state === 'moved' || r.state === 'leftover') {
    const rest = r.state === 'leftover' ? `; ${r.reason}` : '';
    report(`hitld: moved ${label(name)} from ${from} to ${dirname(r.path)}${rest}`);
  } else if ((r.state === 'left' || r.state === 'both') && !r.quiet) {
    report(`hitld: ${label(name)} is not at ${dataDirPath(options)} yet: ${r.reason}`);
  }
  return r.path;
}

/**
 * The entry beside a store: `name` in the store's parent directory. On Windows, when that parent
 * is the data directory or the old one, the entry is resolved on its own (entryDir), since the two
 * may be at different places while the move is under way.
 * @param {string} storeRoot @param {string} name
 * @param {DataHomeOptions} [options]
 */
export function siblingEntry(storeRoot, name, options = {}) {
  const parent = resolve(dirname(storeRoot));
  const old = oldWindowsDataDir(options);
  if (old && (parent === resolve(old) || parent === resolve(dataDirPath(options)))) {
    return entryDir(name, options);
  }
  return join(dirname(storeRoot), name);
}
