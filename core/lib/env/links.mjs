// Links in a worktree (design part 13.2, "Links in cleanup"). Setup often links something in: a
// shared cache, or a dependency directory from another checkout. Removing the worktree must never
// reach through such a link and delete what it points at.
//
// The rules, used together:
//  - Nothing here ever follows a link. Every entry is read with lstat; a link is not descended into.
//  - A link whose real path is outside the worktree (or that cannot be resolved) is unlinked. Only
//    the link goes. Its target is never opened, listed or removed.
//  - Before each unlink the parent directory's real path is re-checked against where the walk
//    found it, and the entry is re-checked to still be a link, so a directory swapped for a link
//    after the walk is not acted on.
//
// What is left, a worktree with no outside link in it, is removed by `git worktree remove`.

import { lstatSync, opendirSync, readlinkSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

/**
 * @typedef {object} OutsideLink
 * @property {string} path the link, relative to the worktree, with "/" separators
 * @property {string} target what it points at, as written in the link
 */

/** @param {string} root a real path @param {string} real a real path */
function isInside(root, real) {
  const back = relative(root, real);
  return back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back);
}

/**
 * Windows junctions: Node reports a junction (and a directory symbolic link) as a symbolic link
 * from lstat, so `isSymbolicLink()` covers them and they are never descended into. On Windows
 * `unlinkSync` removes the junction itself and not the contents of its target.
 * @param {string} full
 */
const isLink = (full) => lstatSync(full).isSymbolicLink();

/**
 * Walk a worktree without following links and list the links that point outside it. A directory on
 * another device than the worktree's root is a mount point: it is not descended into and is listed
 * in `mounts`, since removing the tree would reach what is mounted there.
 * @param {string} worktree
 * @param {{ lstat?: (path: string) => import('node:fs').Stats }} [seam] tests replace lstat to fake a mount
 * @returns {{ links: OutsideLink[], mounts: string[] }}
 */
export function scanWorktree(worktree, seam = {}) {
  const lstat = seam.lstat ?? lstatSync;
  const root = realpathSync(worktree);
  const rootDev = lstat(root).dev;
  /** @type {OutsideLink[]} */
  const found = [];
  /** @type {string[]} */
  const mounts = [];
  /** @param {string} rel the directory, relative to the root ('' for the root) */
  const walk = (rel) => {
    const here = rel ? join(root, rel) : root;
    // A directory swapped for a link after it was found: do not read through it.
    if (realpathSync(here) !== here) return;
    const handle = opendirSync(here);
    /** @type {string[]} */
    const names = [];
    try {
      for (let e = handle.readSync(); e; e = handle.readSync()) names.push(e.name);
    } finally {
      handle.closeSync();
    }
    for (const name of names) {
      if (!rel && name === '.git') continue; // a worktree's .git is git's own
      const childRel = rel ? `${rel}/${name}` : name;
      const full = join(root, childRel);
      let st;
      try {
        st = lstat(full);
      } catch {
        continue; // gone since it was listed
      }
      if (st.isSymbolicLink()) {
        /** @type {string | null} */
        let real = null;
        try {
          real = realpathSync(full);
        } catch {
          // dangling or unreadable: nothing to protect, and not safe to trust
        }
        if (real === null || !isInside(root, real)) {
          found.push({ path: childRel, target: readlinkSync(full) });
        }
      } else if (st.isDirectory()) {
        if (st.dev !== rootDev) mounts.push(childRel);
        else walk(childRel);
      }
    }
  };
  walk('');
  return { links: found, mounts };
}

/**
 * The links in a worktree that point outside it.
 * @param {string} worktree
 * @returns {OutsideLink[]}
 */
export const findOutsideLinks = (worktree) => scanWorktree(worktree).links;

/**
 * Unlink one link under the worktree, after checking that it still is one and that its parent is
 * where the walk found it. Returns false when it declines.
 * @param {string} root the worktree's real path
 * @param {string} rel the link, relative to the root, with "/" separators
 */
export function unlinkLink(root, rel) {
  const full = join(root, rel);
  const parent = dirname(full);
  try {
    if (realpathSync(parent) !== parent) return false; // the parent became a link
    if (!isLink(full)) return false; // no longer a link: not ours to remove
    // Trust boundary: `full` was found by lstat under the worktree's own real path and is checked
    // just above to be a link in a non-link parent. unlink removes the link entry, never its
    // target, so a path-traversal or deletion finding here does not apply (design 13.2).
    unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlink every link in a worktree that points outside it, so removing the worktree cannot reach
 * what they point at. Refuses a worktree path that is itself a link or is not a real path.
 * @param {string} worktree
 * @param {{ lstat?: (path: string) => import('node:fs').Stats }} [seam]
 * @returns {{ unlinked: OutsideLink[], declined: OutsideLink[], mounts: string[] }}
 */
export function unlinkOutsideLinks(worktree, seam) {
  if (isLink(worktree)) throw new Error(`${worktree} is a link; refusing to clean it up`);
  const root = realpathSync(worktree);
  if (root !== worktree) throw new Error(`${worktree} is not a real path (${root}); refusing`);
  /** @type {OutsideLink[]} */
  const unlinked = [];
  /** @type {OutsideLink[]} */
  const declined = [];
  const scan = scanWorktree(root, seam);
  // Nothing is unlinked when a mount is present: the caller refuses the removal.
  if (scan.mounts.length) return { unlinked, declined, mounts: scan.mounts };
  for (const link of scan.links) {
    (unlinkLink(root, link.path) ? unlinked : declined).push(link);
  }
  return { unlinked, declined, mounts: scan.mounts };
}
