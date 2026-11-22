// Git-ignored files a worktree needs (HITLD-743). A project lists them in `.worktreeinclude` at the
// root of its primary checkout, in .gitignore syntax, as it does for Claude Code's own worktrees.
// The rules are Claude Code's:
//  - a file is copied only when it matches a pattern in the list AND git ignores it;
//  - a tracked file is never copied (the worktree's checkout already has its own copy);
//  - a path whose real location is outside the primary checkout is never copied, and nothing is
//    written through a link in the worktree;
//  - a file already in the worktree is left as it is.
//
// Only paths are ever reported or logged. Nothing here reads a file's contents into memory: a copy
// is a file-system copy, and no caller prints, logs or commits what a copied file holds. Each copy
// is checked to be git-ignored in the worktree as well, and removed if it is not, so a later
// `git add -A` (cleanup saves uncommitted work that way) cannot commit it.

import { spawn } from 'node:child_process';
import { constants, copyFileSync, lstatSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { realPath } from './fsx.mjs';

export const INCLUDE_FILE = '.worktreeinclude';

/**
 * @typedef {'tracked' | 'not-ignored' | 'outside' | 'not-a-file' | 'exists' | 'unsafe-destination'
 *   | 'not-ignored-in-worktree' | 'error'} SkipReason
 * @typedef {{ path: string, reason: SkipReason }} Skipped
 * @typedef {object} IncludeList what `.worktreeinclude` names in the primary checkout
 * @property {boolean} listed whether the primary checkout has a `.worktreeinclude`
 * @property {string[]} files the files that may be copied: matched, git-ignored, untracked, and
 *   inside the primary checkout
 * @property {Skipped[]} skipped matched files that may not be copied, and why
 * @property {string} [note] why the list was not read, when it was not
 * @typedef {object} IncludeResult
 * @property {boolean} listed
 * @property {string[]} copied
 * @property {Skipped[]} skipped
 * @property {string} [note]
 */

/**
 * Run git with NUL-separated paths on standard input and return the NUL-separated paths it
 * prints. With input (check-ignore), exit code 1 means "none", so it is not an error there.
 * @param {string[]} args @param {string} cwd @param {string[]} [input]
 * @returns {Promise<string[]>}
 */
function gitPaths(args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const out = [];
    let errOut = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (errOut += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || (input && code === 1)) {
        resolve(Buffer.concat(out).toString('utf8').split('\0').filter(Boolean));
      } else {
        const detail = errOut.trim().split('\n').slice(-3).join(' ');
        reject(new Error(`git ${args.slice(0, 2).join(' ')} failed: ${detail}`));
      }
    });
    // A git that never reads its input (ls-files) may exit before it is written: that EPIPE is
    // not an error, the exit code says what happened.
    child.stdin.on('error', () => {});
    child.stdin.end(input?.length ? `${input.join('\0')}\0` : '');
  });
}

/** @param {string} root a real path @param {string} real a real path */
function isInside(root, real) {
  const back = relative(root, real);
  return back !== '' && back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back);
}

/**
 * The paths among `paths` that git ignores in `root`. Tracked paths are never reported.
 * @param {string} root @param {string[]} paths
 */
const ignoredIn = async (root, paths) =>
  new Set(paths.length ? await gitPaths(['check-ignore', '-z', '--stdin'], root, paths) : []);

/**
 * What `.worktreeinclude` in the primary checkout names, sorted by path.
 * @param {string} primary the primary checkout's root
 * @returns {Promise<IncludeList>}
 */
export async function listIncluded(primary) {
  const root = realPath(primary);
  const list = join(root, INCLUDE_FILE);
  let st;
  try {
    st = lstatSync(list);
  } catch {
    return { listed: false, files: [], skipped: [] };
  }
  if (!st.isFile()) {
    return {
      listed: false,
      files: [],
      skipped: [],
      note: `${INCLUDE_FILE} is not a plain file, so it is not read`,
    };
  }
  const exclude = `--exclude-from=${list}`;
  const [untracked, tracked] = await Promise.all([
    gitPaths(['ls-files', '-z', '--others', '--ignored', exclude], root),
    gitPaths(['ls-files', '-z', '--cached', '--ignored', exclude], root),
  ]);
  const ignored = await ignoredIn(root, untracked);
  /** @type {string[]} */
  const files = [];
  /** @type {Skipped[]} */
  const skipped = [...new Set(tracked)].map((path) => ({ path, reason: 'tracked' }));
  for (const path of untracked) {
    if (!ignored.has(path)) {
      skipped.push({ path, reason: 'not-ignored' });
      continue;
    }
    let real;
    try {
      real = realPath(join(root, path));
    } catch {
      skipped.push({ path, reason: 'outside' }); // a dangling link: nowhere safe to read
      continue;
    }
    if (!isInside(root, real)) skipped.push({ path, reason: 'outside' });
    else if (!statSync(real).isFile()) skipped.push({ path, reason: 'not-a-file' });
    else files.push(path);
  }
  files.sort();
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { listed: true, files, skipped };
}

/**
 * Whether the directory for `rel` can be made in the worktree without passing through a link: each
 * existing part must be a real directory where it is expected.
 * @param {string} wtRoot the worktree's real path @param {string} rel
 */
function safeParent(wtRoot, rel) {
  let here = wtRoot;
  // Part by part, never `mkdir -p`, which would follow a link and create directories past it.
  for (const part of dirname(rel)
    .split('/')
    .filter((p) => p && p !== '.')) {
    here = join(here, part);
    let st;
    try {
      st = lstatSync(here);
    } catch {
      mkdirSync(here);
      continue;
    }
    if (!st.isDirectory()) return false; // a link (or a file) where a directory should be
  }
  return realPath(here) === here;
}

/**
 * Copy into a worktree each file the primary checkout's `.worktreeinclude` names, under the rules
 * at the top of this file. Never overwrites a file the worktree has.
 * @param {{ primary: string, worktree: string }} r
 * @returns {Promise<IncludeResult>}
 */
export async function copyIncluded(r) {
  const primary = realPath(r.primary);
  const wtRoot = realPath(r.worktree);
  if (primary === wtRoot) return { listed: false, copied: [], skipped: [] };
  const found = await listIncluded(primary);
  /** @type {Skipped[]} */
  const skipped = [...found.skipped];
  /** @type {string[]} */
  const copied = [];
  for (const path of found.files) {
    const dest = join(wtRoot, path);
    try {
      lstatSync(dest);
      skipped.push({ path, reason: 'exists' });
      continue;
    } catch {
      // not there: copy it
    }
    try {
      if (!safeParent(wtRoot, path)) {
        skipped.push({ path, reason: 'unsafe-destination' });
        continue;
      }
      // COPYFILE_EXCL: never through a link or over a file that appeared since the check above.
      copyFileSync(realPath(join(primary, path)), dest, constants.COPYFILE_EXCL);
      copied.push(path);
    } catch {
      skipped.push({ path, reason: 'error' });
    }
  }
  // A copy must stay git-ignored in the worktree, whose ignore rules can differ from the primary
  // checkout's working copy; one that is not is removed.
  const ignored = await ignoredIn(wtRoot, copied);
  for (const path of copied.filter((p) => !ignored.has(p))) {
    unlinkSync(join(wtRoot, path));
    skipped.push({ path, reason: 'not-ignored-in-worktree' });
  }
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return {
    listed: found.listed,
    copied: copied.filter((p) => ignored.has(p)),
    skipped,
    ...(found.note ? { note: found.note } : {}),
  };
}

/**
 * The files `.worktreeinclude` names that a worktree does not have. Paths only.
 * @param {{ primary: string, worktree: string }} r
 * @returns {Promise<{ listed: boolean, files: string[], missing: string[], note?: string }>}
 */
export async function missingIncluded(r) {
  const found = await listIncluded(r.primary);
  const wtRoot = realPath(r.worktree);
  const missing = found.files.filter((path) => {
    try {
      lstatSync(join(wtRoot, path));
      return false;
    } catch {
      return true;
    }
  });
  return {
    listed: found.listed,
    files: found.files,
    missing,
    ...(found.note ? { note: found.note } : {}),
  };
}
