// Where human-in-the-lead keeps its data on this machine: the private stores, one directory per
// project ID, and _machine beside them (design part 3.3 and 13.4).
//
//   XDG_DATA_HOME set (an absolute path)  $XDG_DATA_HOME/human-in-the-lead, on every platform
//   Windows                               %LOCALAPPDATA%\human-in-the-lead
//   elsewhere                             ~/.local/share/human-in-the-lead
//
// Windows used ~/.local/share until the owner moved it (HITLD-245). The first time the directory is
// resolved on Windows, each entry still at the old place is moved to the new one, with a message,
// and the old directory is removed once it is empty. A later run finds nothing there and does
// nothing. The move runs here, where every path to the data is resolved, so nothing (the status
// line, a hook) can create a store at the new place before an existing one is moved there. An
// entry that is at both places is left where it is, and the message says so.
//
// It imports only the platform layer, so the store and the settings files may both use it.

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { retryBusy } from '../platform/fs.mjs';

export const DIR_NAME = 'human-in-the-lead';

/**
 * @typedef {{ env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform,
 *   report?: (message: string) => void }} DataHomeOptions env, home and platform are for tests;
 *   report receives the move's messages (standard error by default)
 */

/** @param {string | undefined} v */
const absolute = (v) => (v && isAbsolute(v) ? v : null);

/**
 * The directory that holds the private stores and _machine, without moving anything.
 * @param {DataHomeOptions} [options]
 * @returns {string}
 */
export function dataDirPath(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const xdg = absolute(env.XDG_DATA_HOME);
  if (xdg) return join(xdg, DIR_NAME);
  if (platform === 'win32') {
    const local = absolute(env.LOCALAPPDATA) ?? join(home, 'AppData', 'Local');
    return join(local, DIR_NAME);
  }
  return join(home, '.local', 'share', DIR_NAME);
}

/**
 * Where the directory was on Windows before HITLD-249, when nothing overrides it; else null.
 * @param {DataHomeOptions} [options]
 */
export function oldWindowsDataDir(options = {}) {
  const env = options.env ?? process.env;
  if ((options.platform ?? process.platform) !== 'win32' || absolute(env.XDG_DATA_HOME)) {
    return null;
  }
  return join(options.home ?? homedir(), '.local', 'share', DIR_NAME);
}

/** @param {unknown} e */
const codeOf = (e) => /** @type {NodeJS.ErrnoException} */ (e)?.code ?? '';
/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Move one entry; across volumes, copy it to a temporary name beside the target, rename that into
 * place, then remove the source, so the target is never half there.
 * @param {string} from @param {string} to @param {NodeJS.Platform} platform
 */
function moveEntry(from, to, platform) {
  try {
    retryBusy(() => renameSync(from, to), { platform });
    return;
  } catch (e) {
    if (codeOf(e) !== 'EXDEV') throw e;
  }
  const temp = `${to}.moving-${process.pid}`;
  rmSync(temp, { recursive: true, force: true });
  cpSync(from, temp, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  retryBusy(() => renameSync(temp, to), { platform });
  rmSync(from, { recursive: true, force: true });
}

/**
 * Move what is at the old Windows location to the new one, once. Elsewhere, with XDG_DATA_HOME
 * set, or with nothing at the old location, it does nothing.
 * @param {DataHomeOptions} [options]
 * @returns {{ moved: string[], left: string[], from: string | null, to: string }}
 *   moved and left: entry names (project IDs, _machine) moved, and left at the old place
 */
export function moveOldWindowsData(options = {}) {
  const to = dataDirPath(options);
  const from = oldWindowsDataDir(options);
  /** @type {string[]} */
  const moved = [];
  /** @type {string[]} */
  const left = [];
  if (!from || from === to || !existsSync(from)) return { moved, left, from, to };
  const platform = options.platform ?? process.platform;
  const report = options.report ?? ((m) => process.stderr.write(`${m}\n`));
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(from).sort();
  } catch (e) {
    report(`hitld: could not read ${from} to move it to ${to}: ${messageOf(e)}`);
    return { moved, left, from, to };
  }
  mkdirSync(to, { recursive: true });
  /** @type {string[]} */
  const problems = [];
  for (const name of names) {
    const source = join(from, name);
    const target = join(to, name);
    if (existsSync(target)) {
      left.push(name);
      problems.push(`${name} is at both places, so the one at ${source} was left as it is`);
      continue;
    }
    try {
      moveEntry(source, target, platform);
      moved.push(name);
    } catch (e) {
      // Another hitld moved it first: it is where it belongs.
      if (codeOf(e) === 'ENOENT' && existsSync(target)) continue;
      left.push(name);
      problems.push(`${name} could not be moved (${messageOf(e)}); the next run tries again`);
    }
  }
  if (left.length === 0) {
    try {
      rmdirSync(from);
    } catch {
      // Something new appeared there, or it is held open; the next run looks again.
    }
  }
  if (moved.length) {
    report(
      `hitld: moved ${moved.join(', ')} from ${from} to ${to}, where human-in-the-lead keeps its data on Windows`,
    );
  }
  for (const p of problems) report(`hitld: ${p}`);
  return { moved, left, from, to };
}

/** Old locations this process has already looked at. */
const looked = new Set();

/**
 * The directory that holds the private stores and _machine. On Windows, the first call in a
 * process moves what is still at the old location (moveOldWindowsData).
 * @param {DataHomeOptions} [options]
 * @returns {string}
 */
export function dataDir(options = {}) {
  const from = oldWindowsDataDir(options);
  if (from && !looked.has(from)) {
    looked.add(from);
    moveOldWindowsData(options);
  }
  return dataDirPath(options);
}
