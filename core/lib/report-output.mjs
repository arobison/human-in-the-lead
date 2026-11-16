// Where a static report page may be written, shared by `hitld report` and `hitld eval report`:
// inside the private store or the repository (symlinks resolved), and never over a file the
// report did not create. A directory remembers what reports made in it in a marker file.

import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { realPath } from './platform/fs.mjs';

/** The real path of a path that may not exist yet: its nearest existing ancestor, resolved. @param {string} p */
export function realish(p) {
  let head = resolve(p);
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(head.slice(dirname(head).length + 1));
    head = dirname(head);
  }
  return join(realPath(head), ...tail);
}

/** @param {string} root @param {string} p */
const inside = (root, p) => {
  const rel = relative(realish(root), p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * @param {string} real the directory's real path @param {string} marker
 * @returns {string[]} the files the marker says reports made here
 */
function made(real, marker) {
  try {
    const files = JSON.parse(readFileSync(join(real, marker), 'utf8')).files;
    return Array.isArray(files) ? files : [];
  } catch {
    return []; // no marker: the directory is not one this report made
  }
}

/**
 * Where the report may be written, or why not.
 * @param {string} dir @param {string[]} roots the directories a report may be written in
 * @param {{ marker: string, files: string[] }} kind the marker file name, and the files to write
 * @returns {string | null} the problem
 */
export function outputProblem(dir, roots, { marker, files }) {
  const real = realish(dir);
  if (!roots.some((r) => inside(r, real))) {
    return `${dir} is outside the repository and the private store; the report is written only inside them`;
  }
  const mine = made(real, marker);
  for (const f of files) {
    const path = join(real, f);
    let st;
    try {
      st = lstatSync(path);
    } catch {
      continue;
    }
    if (!st.isFile() || !mine.includes(f)) {
      return `${path} exists and the report did not create it; it will not overwrite it`;
    }
  }
  try {
    if (!lstatSync(join(real, marker)).isFile())
      return `${join(real, marker)} is not a regular file`;
  } catch {
    // absent: fine
  }
  return null;
}

/**
 * Write files after outputProblem has passed, and record them in the marker. A file the marker
 * lists under a name that is `retired` (a page's name before a rename) is removed first, and its
 * name leaves the marker, so a directory written under the old name holds the new page only.
 * Only a regular file the marker lists is removed; a symbolic link or anything else is left alone.
 * @param {string} dir @param {string} marker @param {Record<string, string>} files by name
 * @param {string[]} [retired] names an earlier release wrote and this one no longer does
 * @returns {string} the directory's real path
 */
export function writeReportFiles(dir, marker, files, retired = []) {
  const real = realish(dir);
  mkdirSync(real, { recursive: true });
  const listed = made(real, marker);
  const gone = new Set();
  for (const name of retired) {
    if (name in files || !listed.includes(name)) continue;
    try {
      if (lstatSync(join(real, name)).isFile()) unlinkSync(join(real, name));
      gone.add(name);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') gone.add(name);
      // Anything else: leave the file, and keep it in the marker.
    }
  }
  const names = [...new Set([...listed.filter((n) => !gone.has(n)), ...Object.keys(files)])];
  writeFileSync(join(real, marker), `${JSON.stringify({ files: names })}\n`);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(real, name), text);
  return real;
}
