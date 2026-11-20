// The private store (design part 3.3): where the ledger, run state, leases, usage snapshots,
// confidential material and eval results live, outside the repository.
//
// Default path: $XDG_DATA_HOME/human-in-the-lead/<project-id>/, which is
// ~/.local/share/human-in-the-lead/<project-id>/ when XDG_DATA_HOME is unset.
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
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { replaceFile } from './host.mjs';

const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * The private store directory for a project.
 * @param {string} projectId policy.json project.id
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, repoRoot?: string }} [options]
 *   env and home are for tests; repoRoot, when given, makes it an error for the store to be
 *   inside the repository.
 * @returns {string}
 */
export function privateStorePath(projectId, options = {}) {
  if (!PROJECT_ID.test(projectId) || projectId.includes('..')) {
    throw new Error(
      `project ID ${JSON.stringify(projectId)} is not a safe directory name (lower-case letters, digits, ".", "_", "-")`,
    );
  }
  const env = options.env ?? process.env;
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(options.home ?? homedir(), '.local', 'share');
  const path = join(base, 'human-in-the-lead', projectId);
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
      // store and its git repository on every read.
      const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      const from = dir === '' ? base : pathOf(dir);
      if (!existsSync(from) || !statSync(from).isDirectory()) return [];
      // Dot paths at the top are the store's git repository and its .gitignore, not keys.
      return readdirSync(from, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.endsWith('.tmp'))
        .map((d) => relative(base, join(d.parentPath, d.name)).split(sep).join('/'))
        .filter((k) => k.startsWith(prefix) && !k.startsWith('.'))
        .sort();
    },
  };
}
