// Reading item files: from a working tree, and from a git ref without checking it out. Also the
// places an item can live in one clone (worktrees and branches), which claims and ID allocation
// scan. Item files are read as data only (see frontmatter.mjs).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseItem } from './frontmatter.mjs';
import { fromLegacy } from './legacy.mjs';
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

/**
 * The folders of ID-named files, in the order files are read: initiatives, projects, items and
 * milestones. Initiatives are milestones now; their folder is read until the next minor release
 * so the check can name a file left there and `hitld work migrate` can move it. Release records
 * (named by their tag) are read on their own (releases.mjs).
 * @param {Layout} layout
 */
export const folderNames = (layout) => [
  layout.folders.initiative,
  layout.folders.project,
  layout.folders.item,
  layout.folders.milestone,
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
  return fileNamesInPlaces(root, layout, [place]);
}

/**
 * Item file names (not contents) in every place, together: refs are read as in loadPlaces.
 * @param {string} root @param {Layout} layout @param {Place[]} places
 * @returns {string[]}
 */
export function fileNamesInPlaces(root, layout, places) {
  const onRefs = refItemFiles(
    root,
    layout,
    places.filter((p) => !p.path).map((p) => p.ref ?? ''),
  );
  return places.flatMap((p) =>
    p.path ? fileNamesIn(root, layout, p) : (onRefs.get(p.ref ?? '') ?? []).map((f) => f.file),
  );
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
 * Read every item in every place. Branch contents are read in one batch. Files in the format
 * before HITLD-82 (a branch made before the migration) are read in the current form (legacy.mjs).
 * The working tree itself is read by loadWorkTree as it is, so the check and the migration see
 * what the files hold.
 * @param {string} root @param {Layout} layout @param {Place[]} places
 * @returns {{ where: string, ref?: string, items: Entry[] }[]}
 */
export function loadPlaces(root, layout, places) {
  /** @type {{ where: string, ref?: string, items: Entry[] }[]} */
  const out = [];
  /** @type {{ entry: { items: Entry[] }, sha: string, path: string, file: string, folder: string }[]} */
  const wanted = [];
  const onRefs = refItemFiles(
    root,
    layout,
    places.filter((p) => !p.path).map((p) => p.ref ?? ''),
  );
  for (const p of places) {
    if (p.path) {
      const items = loadWorkTree(p.path, layout).map((e) => ({ ...e, data: fromLegacy(e.data) }));
      out.push({ where: p.where, items });
      continue;
    }
    const entry = { where: p.where, ref: p.ref, items: /** @type {Entry[]} */ ([]) };
    out.push(entry);
    for (const f of onRefs.get(p.ref ?? '') ?? []) wanted.push({ entry, ...f });
  }
  if (wanted.length) {
    const blobs = readBlobs(root, [...new Set(wanted.map((w) => w.sha))]);
    for (const w of wanted) {
      w.entry.items.push({
        path: w.path,
        file: w.file,
        folder: w.folder,
        ...legacyParsed(parseItem(blobs.get(w.sha) ?? '')),
      });
    }
  }
  return out;
}

/**
 * @typedef {{ sha: string, path: string, file: string, folder: string }} RefFile
 *   an item file on a ref: its blob, repository-relative path, name and folder
 */

/**
 * The item files on each ref, read without a process per ref. A clone can carry hundreds of refs
 * (an upstream's branches), and starting a process costs far more on some machines (Windows with
 * endpoint protection: about 200 ms) than others. So one `git cat-file --batch-check` finds each
 * item folder's tree on every ref, and one `git cat-file --batch` reads the distinct trees,
 * however many refs share them. A ref without the work directory, or that does not resolve, has
 * no files. Only a folder's direct entries count, as in loadWorkTree.
 * @param {string} root @param {Layout} layout @param {string[]} refs
 * @returns {Map<string, RefFile[]>} ref → its item files
 */
export function refItemFiles(root, layout, refs) {
  const { file: filePattern } = patterns(layout.key);
  const workDir = layout.workDir.replace(/\/+$/, '');
  const folders = folderNames(layout);
  /** @type {Map<string, RefFile[]>} */
  const out = new Map();
  const asked = [...new Set(refs.filter(Boolean))].flatMap((ref) =>
    folders.map((folder) => ({ ref, folder })),
  );
  if (!asked.length) return out;
  const answer = git(root, ['cat-file', '--batch-check'], {
    allowFail: true,
    input: `${asked.map((a) => `${a.ref}:${workDir}/${a.folder}`).join('\n')}\n`,
  }).split('\n');
  // One answer line per line asked: "<object> tree <size>", or "<what was asked> missing".
  /** @type {{ ref: string, folder: string, tree: string }[]} */
  const found = [];
  asked.forEach((a, i) => {
    const m = /^([0-9a-f]{40,64}) tree \d+$/.exec(answer[i] ?? '');
    if (m) found.push({ ...a, tree: m[1] });
  });
  const trees = readTrees(root, [...new Set(found.map((f) => f.tree))]);
  for (const { ref, folder, tree } of found) {
    const files = out.get(ref) ?? [];
    out.set(ref, files);
    for (const e of trees.get(tree) ?? []) {
      if (!e.blob || !filePattern.test(e.name)) continue;
      files.push({ sha: e.sha, path: `${workDir}/${folder}/${e.name}`, file: e.name, folder });
    }
  }
  return out;
}

/**
 * Read tree objects by ID in one `git cat-file --batch`: each one's entries. An entry is a blob
 * when `git ls-tree` would call it one (a file or a symbolic link), not a tree or a submodule.
 * @param {string} root @param {string[]} shas
 * @returns {Map<string, { name: string, sha: string, blob: boolean }[]>}
 */
export function readTrees(root, shas) {
  /** @type {Map<string, { name: string, sha: string, blob: boolean }[]>} */
  const trees = new Map();
  if (!shas.length) return trees;
  const buf = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    maxBuffer: 1 << 28,
    input: `${shas.join('\n')}\n`,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let at = 0;
  while (at < buf.length) {
    const eol = buf.indexOf(10, at);
    if (eol < 0) break;
    const [sha, type, size] = buf.subarray(at, eol).toString().split(' ');
    if (type !== 'tree') {
      at = eol + 1; // "<name> missing"
      continue;
    }
    const start = eol + 1;
    const end = start + Number(size);
    const hashBytes = sha.length / 2; // 20 for SHA-1, 32 for SHA-256
    /** @type {{ name: string, sha: string, blob: boolean }[]} */
    const entries = [];
    // Each entry: "<octal mode> <name>\0" and the object's ID as raw bytes.
    let p = start;
    while (p < end) {
      const space = buf.indexOf(32, p);
      const nul = buf.indexOf(0, space);
      const mode = buf.subarray(p, space).toString();
      const name = buf.subarray(space + 1, nul).toString('utf8');
      const id = buf.subarray(nul + 1, nul + 1 + hashBytes).toString('hex');
      entries.push({ name, sha: id, blob: mode.startsWith('100') || mode === '120000' });
      p = nul + 1 + hashBytes;
    }
    trees.set(sha, entries);
    at = end + 1;
  }
  return trees;
}

/** @param {ReturnType<typeof parseItem>} parsed */
const legacyParsed = (parsed) => ({ ...parsed, data: fromLegacy(parsed.data) });

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
