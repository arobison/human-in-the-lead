// Reading item files: from a working tree, and from a git ref without checking it out. Also the
// places an item can live in one clone (worktrees and branches), which claims and ID allocation
// scan. Item files are read as data only (see frontmatter.mjs).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseItem } from './frontmatter.mjs';
import { insidePath, isRegularFile, readNoFollow } from './safe.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./frontmatter.mjs').Data} Data
 *
 * @typedef {object} Entry one item file as read
 * @property {string} path repository-relative, "/" separated
 * @property {string} file the file name
 * @property {string} folder the folder it is in, under the work directory
 * @property {Data | null} data front matter; null when there is none
 * @property {string} body
 * @property {string[]} errors problems found while reading it
 * @property {string} [version] the file's version (working-tree reads only)
 *
 * @typedef {{ where: string, path?: string, ref?: string }} Place
 *   a worktree's working copy (path) or a ref (ref); where is the label shown to people
 */

/** The three folders, in the order files are read. @param {Layout} layout */
export const folderNames = (layout) => [
  layout.folders.initiative,
  layout.folders.project,
  layout.folders.item,
];

/**
 * A file's version: a SHA-256 of its text, opaque to callers. An update passes the version it
 * read, so it can refuse to overwrite a change it has not seen (not a password hash).
 * @param {string} text
 */
export function versionOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The patterns for an ID key. @param {string} key */
export function patterns(key) {
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key))
    throw new Error(`ID key ${JSON.stringify(key)} is not valid`);
  return {
    id: new RegExp(`^${key}-[1-9]\\d*$`),
    file: new RegExp(`^(${key}-[1-9]\\d*)(-[a-z0-9-]+)?\\.md$`),
  };
}

/** The number in an ID such as "APP-12". @param {string} id */
export const idNumber = (id) => Number(String(id).slice(String(id).indexOf('-') + 1));

/**
 * Run git. Standard error is dropped; a failure throws unless `allowFail`.
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ input?: string | Buffer, allowFail?: boolean, buffer?: boolean }} [options]
 * @returns {string}
 */
export function git(cwd, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      input: options.input,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (options.allowFail) return '';
    const err = /** @type {{ stderr?: Buffer | string, message: string }} */ (e);
    const detail = String(err.stderr ?? '').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
}

/** The repository root containing `cwd`. @param {string} cwd */
export function repoRootOf(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

/**
 * Read every item file under the work directory of a working tree.
 * @param {string} root a working tree's root
 * @param {Layout} layout
 * @returns {Entry[]}
 */
export function loadWorkTree(root, layout) {
  /** @type {Entry[]} */
  const items = [];
  for (const folder of folderNames(layout)) {
    const dir = insidePath(root, `${layout.workDir}/${folder}`); // refuses a symbolic link
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.md')) continue;
      const path = relative(root, join(dir, file)).split('\\').join('/');
      if (!isRegularFile(join(dir, file))) {
        items.push({
          path,
          file,
          folder,
          data: null,
          body: '',
          errors: ['is not a regular file (a symbolic link?); item files are never followed'],
        });
        continue;
      }
      const text = readNoFollow(join(dir, file));
      items.push({ path, file, folder, version: versionOf(text), ...parseItem(text) });
    }
  }
  return items;
}

/**
 * Item file names (not contents) in a place.
 * @param {string} root @param {Layout} layout @param {Place} place
 * @returns {string[]}
 */
export function fileNamesIn(root, layout, place) {
  const { file: filePattern } = patterns(layout.key);
  if (place.path) {
    return folderNames(layout).flatMap((folder) => {
      /** @type {string} */
      let dir;
      try {
        dir = insidePath(place.path ?? '', `${layout.workDir}/${folder}`);
      } catch {
        return []; // another worktree with a link where a folder should be: not counted
      }
      return existsSync(dir) ? readdirSync(dir).filter((f) => filePattern.test(f)) : [];
    });
  }
  const listing = git(
    root,
    ['ls-tree', '-r', '--name-only', place.ref ?? '', '--', layout.workDir],
    {
      allowFail: true,
    },
  );
  return listing
    .split('\n')
    .filter((p) => folderNames(layout).includes(p.split('/').at(-2) ?? ''))
    .map((p) => p.split('/').pop() ?? '')
    .filter((f) => filePattern.test(f));
}

/**
 * Every place an item can live in this clone: each worktree's working copy (uncommitted files
 * included), and each ref without a worktree: local branches, and with `remotes` the
 * remote-tracking branches and the configured bundle ref prefixes.
 * @param {string} root @param {Layout} layout
 * @param {{ remotes?: boolean }} [options]
 * @returns {Place[]}
 */
export function listPlaces(root, layout, { remotes = false } = {}) {
  /** @type {Place[]} */
  const places = [];
  const withWorktree = new Set();
  for (const block of git(root, ['worktree', 'list', '--porcelain']).split('\n\n')) {
    const path = block.match(/^worktree (.*)$/m)?.[1];
    const branch = block.match(/^branch refs\/heads\/(.*)$/m)?.[1];
    if (!path || /^prunable/m.test(block)) continue;
    if (branch) withWorktree.add(branch);
    places.push({ where: `${branch ?? 'detached'} (worktree)`, path });
  }
  places.push(...refPlaces(root, layout, { remotes, skipBranches: withWorktree }));
  return places;
}

/**
 * The refs that can hold claims: local branches, remote-tracking branches and bundle refs.
 * @param {string} root @param {Layout} layout
 * @param {{ remotes?: boolean, skipBranches?: Set<string> }} [options]
 * @returns {Place[]}
 */
export function refPlaces(root, layout, { remotes = true, skipBranches = new Set() } = {}) {
  const prefixes = ['refs/heads/', ...(remotes ? ['refs/remotes/', ...layout.bundleRefs] : [])];
  const refs = git(root, ['for-each-ref', '--format=%(refname)', ...prefixes]);
  /** @type {Place[]} */
  const out = [];
  for (const ref of refs.split('\n').filter(Boolean)) {
    if (ref.endsWith('/HEAD')) continue;
    const short = ref.replace(/^refs\/(heads|remotes)\//, '');
    if (ref.startsWith('refs/heads/') && skipBranches.has(short)) continue;
    out.push({ where: short, ref });
  }
  return out;
}

/**
 * Read every item in every place. Branch contents are read in one batch.
 * @param {string} root @param {Layout} layout @param {Place[]} places
 * @returns {{ where: string, ref?: string, items: Entry[] }[]}
 */
export function loadPlaces(root, layout, places) {
  const { file: filePattern } = patterns(layout.key);
  /** @type {{ where: string, ref?: string, items: Entry[] }[]} */
  const out = [];
  /** @type {{ entry: { items: Entry[] }, sha: string, path: string, file: string, folder: string }[]} */
  const wanted = [];
  for (const p of places) {
    if (p.path) {
      out.push({ where: p.where, items: loadWorkTree(p.path, layout) });
      continue;
    }
    const listing = git(root, ['ls-tree', '-r', p.ref ?? '', '--', layout.workDir], {
      allowFail: true,
    });
    const entry = { where: p.where, ref: p.ref, items: /** @type {Entry[]} */ ([]) };
    out.push(entry);
    for (const line of listing.split('\n').filter(Boolean)) {
      const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.*)$/);
      const file = m?.[2].split('/').pop() ?? '';
      const folder = m?.[2].split('/').at(-2) ?? '';
      if (m && filePattern.test(file) && folderNames(layout).includes(folder)) {
        wanted.push({ entry, sha: m[1], path: m[2], file, folder });
      }
    }
  }
  if (wanted.length) {
    const blobs = readBlobs(root, [...new Set(wanted.map((w) => w.sha))]);
    for (const w of wanted) {
      w.entry.items.push({
        path: w.path,
        file: w.file,
        folder: w.folder,
        ...parseItem(blobs.get(w.sha) ?? ''),
      });
    }
  }
  return out;
}

/**
 * Read blobs by ID in one `git cat-file --batch`. Sizes are bytes, so this works on buffers.
 * @param {string} root @param {string[]} shas
 * @returns {Map<string, string>}
 */
export function readBlobs(root, shas) {
  const buf = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    maxBuffer: 1 << 28,
    input: `${shas.join('\n')}\n`,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  /** @type {Map<string, string>} */
  const blobs = new Map();
  let at = 0;
  while (at < buf.length) {
    const eol = buf.indexOf(10, at);
    const [sha, type, size] = buf.subarray(at, eol).toString().split(' ');
    if (type !== 'blob') {
      at = eol + 1;
      continue;
    }
    const start = eol + 1;
    const end = start + Number(size);
    blobs.set(sha, buf.subarray(start, end).toString('utf8'));
    at = end + 1;
  }
  return blobs;
}
