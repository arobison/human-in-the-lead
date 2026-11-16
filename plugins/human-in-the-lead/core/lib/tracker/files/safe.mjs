// Filesystem access that does not follow symbolic links. The tracker reads and writes paths named
// by settings and item files, inside a repository another party may have written to, so a link
// planted at one of those paths must not redirect a read or a write outside the repository.
//
// Two defenses, used together: every directory component below the repository root is checked
// with lstat and a symbolic link is refused (`insidePath`), and files are opened with O_NOFOLLOW
// so the last component cannot be swapped for a link between the check and the open.

import {
  constants as fs,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realPath, renameReplacing } from '../../platform/fs.mjs';

const O_NOFOLLOW = fs.O_NOFOLLOW ?? 0;

/**
 * Resolve a repository-relative path under `root`, refusing a symbolic link on any component that
 * exists and a path that leaves the root. Components that do not exist yet are fine.
 * @param {string} root the repository root (a real path)
 * @param {string} rel
 * @returns {string} the absolute path
 */
export function insidePath(root, rel) {
  if (isAbsolute(rel)) throw new Error(`${JSON.stringify(rel)} must be relative to the repository`);
  const full = resolve(root, rel);
  const from = relative(root, full);
  if (from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from)) {
    throw new Error(`${JSON.stringify(rel)} leaves the repository`);
  }
  let at = root;
  for (const part of from.split(sep).filter(Boolean)) {
    at = join(at, part);
    let st;
    try {
      st = lstatSync(at);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') break;
      throw e;
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `${relative(root, at)} is a symbolic link; the tracker does not follow links`,
      );
    }
  }
  // Belt and braces: the real path of what exists must still be under the real root.
  let existing = full;
  for (;;) {
    try {
      const real = realPath(existing);
      const back = relative(realPath(root), real);
      if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) {
        throw new Error(`${JSON.stringify(rel)} resolves outside the repository`);
      }
      break;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
      existing = dirname(existing);
    }
  }
  return full;
}

/** Create a directory (and parents) under `root`, after `insidePath` has checked it. @param {string} root @param {string} rel */
export function mkdirInside(root, rel) {
  const full = insidePath(root, rel);
  mkdirSync(full, { recursive: true });
  return full;
}

/**
 * Read a regular file without following a link at its last component.
 * @param {string} path
 * @returns {string}
 */
export function readNoFollow(path) {
  const fd = openSync(path, fs.O_RDONLY | O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${path} is not a regular file`);
    return readFileSync(fd, 'utf8');
  } catch (e) {
    throw e;
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a file without following a link at its last component: to a temporary file created
 * exclusively, then renamed over the target (a rename replaces a link; it never writes through it).
 * @param {string} path
 * @param {string} text
 */
export function writeNoFollow(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, fs.O_WRONLY | fs.O_CREAT | fs.O_EXCL | O_NOFOLLOW, 0o644);
  try {
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
  renameReplacing(tmp, path);
}

/** Create a new file exclusively, never through a link. Fails with EEXIST if anything is there. @param {string} path @param {string} text */
export function createExclusive(path, text) {
  const fd = openSync(path, fs.O_WRONLY | fs.O_CREAT | fs.O_EXCL | O_NOFOLLOW, 0o644);
  try {
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/** True if a regular file (not a link) is at `path`. @param {string} path */
export function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
