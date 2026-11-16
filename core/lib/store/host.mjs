// What the private store needs from the system it runs on, the same on every system: the part of
// git's environment that says where the person's profile and the system's programs are, and a
// file replacement that survives another program holding the target open for a moment.
//
// Windows. A child process gets only the variables it is given (Node adds a few, such as
// SystemRoot and USERPROFILE), so git, ssh and Git Credential Manager are given the ones that
// say where the profile, the application data, the system and a temporary directory are. None of
// them changes which config git reads or which hooks run: the callers still ignore the owner's
// global and system config and turn hooks off. Renaming over a file fails there while another
// process (a virus scanner, an indexer, an editor) has it open, so a replacement is tried again a
// few times. File modes (0o600, 0o700) are not enforced on Windows: the store's files are as
// private as the person's profile directory, no more.

import { renameSync, unlinkSync } from 'node:fs';

/** The variables passed on to git on Windows, besides PATH and HOME. */
const WINDOWS_ENV = Object.freeze([
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERNAME',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
]);

/**
 * A variable by name. Names are not case-sensitive on Windows; process.env already reads them
 * that way, a plain object (a test's) does not.
 * @param {NodeJS.ProcessEnv} env @param {string} name @param {NodeJS.Platform} platform
 */
function lookup(env, name, platform) {
  if (env[name] !== undefined || platform !== 'win32') return env[name];
  const lower = name.toLowerCase();
  const key = Object.keys(env).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : env[key];
}

/**
 * PATH, HOME and, on Windows, the variables above, for a git that is otherwise isolated.
 * Elsewhere HOME is the person's, or `home` when it is unset. On Windows HOME is passed on only
 * when it is set: git works out the profile from USERPROFILE or HOMEDRIVE and HOMEPATH itself,
 * and ssh looks for ~/.ssh there. A null `home` leaves HOME out everywhere.
 * @param {string | null} home
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [o] for tests
 * @returns {Record<string, string>}
 */
export function hostEnv(home, o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  /** @type {Record<string, string>} */
  const out = { PATH: lookup(env, 'PATH', platform) ?? '/usr/bin:/bin' };
  const personHome = lookup(env, 'HOME', platform);
  if (platform === 'win32') {
    if (home !== null && personHome !== undefined) out.HOME = personHome;
    for (const name of WINDOWS_ENV) {
      const v = lookup(env, name, platform);
      if (v !== undefined) out[name] = v;
    }
  } else if (home !== null) {
    out.HOME = personHome ?? home;
  }
  return out;
}

/** The errors Windows gives while another process has a file open. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Waits between tries, in milliseconds: about a second in all. */
const BACKOFF = Object.freeze([10, 20, 40, 80, 160, 320, 400]);

/** @param {number} ms */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run a file operation; on Windows, try it again for a while when the file is busy.
 * @template T
 * @param {() => T} op
 * @param {{ platform?: NodeJS.Platform, wait?: (ms: number) => void }} [o] for tests
 * @returns {T}
 */
export function retryBusy(op, o = {}) {
  const platform = o.platform ?? process.platform;
  const wait = o.wait ?? pause;
  for (let i = 0; ; i++) {
    try {
      return op();
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? '';
      if (platform !== 'win32' || i >= BACKOFF.length || !BUSY.has(code)) throw e;
      wait(BACKOFF[i]);
    }
  }
}

/**
 * Replace `to` with `from` in one step (rename), as renameSync, retried on Windows while `to` is
 * busy.
 * @param {string} from @param {string} to
 */
export const replaceFile = (from, to) => retryBusy(() => renameSync(from, to));

/**
 * Remove a file, as unlinkSync, retried on Windows while it is busy.
 * @param {string} file
 */
export const removeFile = (file) => retryBusy(() => unlinkSync(file));
