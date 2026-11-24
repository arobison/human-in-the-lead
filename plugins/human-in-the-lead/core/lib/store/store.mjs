// The private store (design part 3.3): where the ledger, run state, leases, usage snapshots,
// confidential material and eval results live, outside the repository.
//
// Default path: $XDG_DATA_HOME/human-in-the-lead/<project-id>/ when XDG_DATA_HOME is set, on every
// platform; else %LOCALAPPDATA%\human-in-the-lead\<project-id>\ on Windows and
// ~/.local/share/human-in-the-lead/<project-id>/ elsewhere (data-home.mjs, which also moves a
// Windows store from the old ~/.local/share place once).
//
// The store is a small key-path file API (read, write, append, list) so it can later be backed by
// something else. Keys are relative paths such as "ledger/w-0123456789abcdef.jsonl" or "run-state.json".
//
// Its text parts are also a git repository (<store>/.git, see git.mjs), committed when the store
// is exported or imported. A SQLite index of the ledger sits beside them (index-db.mjs). The index
// and the other machine-local files are listed in git.mjs (MACHINE_LOCAL) and never leave this
// machine.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { entryDir } from './data-home.mjs';
import { replaceFile } from './host.mjs';

const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * The private store directory for a project.
 * @param {string} projectId policy.json project.id
 * @param {import('./data-home.mjs').DataHomeOptions & { repoRoot?: string }} [options]
 *   env, home and platform are for tests; repoRoot, when given, makes it an error for the store
 *   to be inside the repository.
 * @returns {string}
 */
export function privateStorePath(projectId, options = {}) {
  if (!PROJECT_ID.test(projectId) || projectId.includes('..')) {
    throw new Error(
      `project ID ${JSON.stringify(projectId)} is not a safe directory name (lower-case letters, digits, ".", "_", "-")`,
    );
  }
  const path = entryDir(projectId, options);
  if (options.repoRoot) {
    const rel = relative(resolve(options.repoRoot), path);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw new Error(`the private store ${path} is inside the repository ${options.repoRoot}`);
    }
  }
  return path;
}

/**
 * @typedef {object} PrivateStore
 * @property {string} root
 * @property {(key: string) => string | null} read the text at key, or null if absent
 * @property {(key: string, text: string) => void} write replace atomically (temporary file, then rename)
 * @property {(key: string, text: string) => void} append append to the end, creating the file if absent
 * @property {(prefix?: string) => string[]} list keys under a prefix, sorted
 */

/**
 * Open a private store rooted at a directory (created on first write).
 * @param {string} root
 * @returns {PrivateStore}
 */
export function openStore(root) {
  const base = resolve(root);
  /** @param {string} key */
  const pathOf = (key) => {
    if (typeof key !== 'string' || key === '' || isAbsolute(key) || key.includes('\0')) {
      throw new Error(`store key ${JSON.stringify(key)} must be a non-empty relative path`);
    }
    const p = resolve(base, key);
    if (!p.startsWith(base + sep))
      throw new Error(`store key ${JSON.stringify(key)} leaves the store`);
    return p;
  };
  return {
    root: base,
    read(key) {
      const p = pathOf(key);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    },
    write(key, text) {
      const p = pathOf(key);
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      writeFileSync(tmp, text);
      replaceFile(tmp, p);
    },
    append(key, text) {
      const p = pathOf(key);
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, text);
    },
    list(prefix = '') {
      // Walk only the directory the prefix names (ledger/ for the ledger's files), not the whole
      // store, its worktrees and its git repository on every read (GitHub issue 603). Inside it,
      // a folder whose path cannot lead to the prefix is not entered, so a prefix with no slash
      // reads the top folder and only the folders that match it. The keys are the ones a full
      // walk would give: paths as the file system resolves them, never a dot path.
      const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      const from = dir === '' ? base : pathOf(dir);
      // The key path of from as resolved ('a//' and 'a/./' are 'a/'), so a prefix spelled
      // another way matches nothing, as before.
      const top = relative(base, from).split(sep).join('/');
      // Dot paths at the top are the store's git repository and its .gitignore, not keys.
      if (top.startsWith('.')) return [];
      /** @type {string[]} */
      const keys = [];
      /** @param {string} abs @param {string} rel the key path of abs, '' or ending in '/' */
      const walk = (abs, rel) => {
        let entries;
        try {
          entries = readdirSync(abs, { withFileTypes: true });
        } catch (e) {
          // A folder removed while the walk runs (a worktree being cleaned up) holds no keys now.
          const code = /** @type {NodeJS.ErrnoException} */ (e).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') return;
          throw e;
        }
        for (const d of entries) {
          const key = rel + d.name;
          if (key.startsWith('.')) continue;
          if (d.isDirectory()) {
            const sub = `${key}/`;
            if (sub.startsWith(prefix) || prefix.startsWith(sub)) walk(join(abs, d.name), sub);
          } else if (d.isFile() && !d.name.endsWith('.tmp') && key.startsWith(prefix)) {
            keys.push(key);
          }
        }
      };
      walk(from, top === '' ? '' : `${top}/`);
      return keys.sort();
    },
  };
}
