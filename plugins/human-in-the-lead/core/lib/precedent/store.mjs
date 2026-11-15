// Where precedents live (design parts 3.4 and 4.3). A public precedent is a file in the repository,
// precedents/P-<n>-<slug>.md. A precedent drawn from a confidential decision is itself
// confidential and lives in the private store, so a classification above the repository's ceiling
// never reaches the repository. Secrets are never stored as precedents at all.
//
// The front matter is JSON between the --- lines. JSON is plain data and valid YAML, so the files
// backend's reader (piece (a)) reads it too; the check refuses anything but data (design part 3.4).

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { mayAppearIn } from './classification.mjs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import {
  insidePath,
  isRegularFile,
  mkdirInside,
  readNoFollow,
  writeNoFollow,
} from '../tracker/files/safe.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} Precedent
 *
 * @typedef {object} PrecedentStore
 * @property {() => Precedent[]} list every precedent in both places, by number
 * @property {(id: string) => Precedent | null} get
 * @property {() => string} nextId the next free P-<n>
 * @property {(p: Precedent) => 'repository' | 'private store'} put validate, then write where its classification allows
 */

/** The directory of public precedents, relative to the repository root. */
export const PRECEDENT_DIR = 'precedents';

const PRIVATE_PREFIX = 'precedents/';

/** @param {string} id */
const numberOf = (id) => Number(id.slice(2));

/** @param {string} rule */
function slug(rule) {
  const full = rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let s = full.slice(0, 40);
  if (full.length > 40 && full[40] !== '-') s = s.replace(/-?[^-]*$/, ''); // end on a whole word
  return s.replace(/-+$/, '') || 'precedent';
}

/** @param {Precedent} p */
export function renderPrecedent(p) {
  return `---\n${JSON.stringify(p, null, 2)}\n---\n\n# ${p.id}\n\n${p.rule}\n`;
}

/**
 * Read a precedent file's front matter.
 * @param {string} text @param {string} where for the error
 * @returns {Precedent}
 */
export function parsePrecedent(text, where) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error(`${where}: no front matter between --- lines`);
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error(`${where}: the front matter is not JSON data`);
  }
  return fromLegacyPrecedent(data);
}

/**
 * A precedent in the names before HITLD-82, read until the next minor release: the state
 * `narrowed` is `active` (its exceptions hold the narrowing), and the scope `project` is `all`.
 * @param {any} p
 * @returns {Precedent}
 */
export function fromLegacyPrecedent(p) {
  if (!p || typeof p !== 'object') return p;
  if (p.state !== 'narrowed' && p.scope !== 'project') return p;
  return {
    ...p,
    ...(p.state === 'narrowed' ? { state: 'active' } : {}),
    ...(p.scope === 'project' ? { scope: 'all' } : {}),
  };
}

/**
 * @param {{ repoRoot?: string | null, store: PrivateStore, ceiling?: string, dir?: string }} options
 *   repoRoot: null keeps every precedent in the private store; ceiling is policy.project.classification_ceiling.
 * @returns {PrecedentStore}
 */
export function openPrecedentStore({
  repoRoot = null,
  store,
  ceiling = 'public',
  dir = PRECEDENT_DIR,
}) {
  // precedents/ is in the repository, which executors and outside contributors write to, so a
  // symbolic link there (at the directory or at a P-<n> file) must not redirect the owner's read or
  // write outside it: the directory is checked component by component, and files are read and
  // written without following a link.
  /** @returns {string | null} */
  const repoDirChecked = () => (repoRoot ? insidePath(repoRoot, dir) : null);
  const repoDir = repoRoot ? join(repoRoot, dir) : null;

  /** @returns {{ id: string, place: 'repository' | 'private store', file: string, precedent: Precedent }[]} */
  const scan = () => {
    /** @type {{ id: string, place: 'repository' | 'private store', file: string, precedent: Precedent }[]} */
    const out = [];
    const checked = repoDirChecked();
    if (checked && existsSync(checked)) {
      for (const f of readdirSync(checked).sort()) {
        if (!/^P-[1-9][0-9]*(-.*)?\.md$/.test(f)) continue;
        const file = join(checked, f);
        if (!isRegularFile(file)) {
          throw new Error(
            `${file} is not a regular file (a symbolic link?); precedents are never followed`,
          );
        }
        out.push({
          id: /^(P-[0-9]+)/.exec(f)?.[1] ?? f,
          place: 'repository',
          file,
          precedent: parsePrecedent(readNoFollow(file), file),
        });
      }
    }
    for (const key of store.list(PRIVATE_PREFIX)) {
      if (!/^precedents\/P-[1-9][0-9]*\.json$/.test(key)) continue;
      out.push({
        id: key.slice(PRIVATE_PREFIX.length, -'.json'.length),
        place: 'private store',
        file: key,
        precedent: fromLegacyPrecedent(JSON.parse(/** @type {string} */ (store.read(key)))),
      });
    }
    return out.sort((a, b) => numberOf(a.id) - numberOf(b.id));
  };

  return {
    list: () => scan().map((e) => e.precedent),
    get: (id) => scan().find((e) => e.id === id)?.precedent ?? null,
    nextId: () => `P-${Math.max(0, ...scan().map((e) => numberOf(e.id))) + 1}`,
    put(p) {
      const errors = schemas().validateEntity('precedent', p);
      if (errors.length) throw new Error(`precedent ${p.id} is invalid: ${formatErrors(errors)}`);
      if (p.classification === 'secret') {
        throw new Error(`precedent ${p.id} is secret; a secret is never stored in a precedent`);
      }
      const existing = scan().find((e) => e.id === p.id);
      const inRepo = repoDir !== null && mayAppearIn(p.classification, ceiling);
      if (existing && (existing.place === 'repository') !== inRepo) {
        throw new Error(
          `precedent ${p.id} would move between the repository and the private store`,
        );
      }
      if (inRepo && repoDir) {
        mkdirInside(/** @type {string} */ (repoRoot), dir);
        if (!/^P-[1-9][0-9]*$/.test(p.id))
          throw new Error(`precedent ID ${JSON.stringify(p.id)} is not P-<n>`);
        const file = existing?.file ?? join(repoDir, `${p.id}-${slug(p.rule)}.md`);
        if (resolve(file).startsWith(resolve(repoDir) + sep) === false) {
          throw new Error(`precedent file ${file} leaves ${repoDir}`);
        }
        writeNoFollow(file, renderPrecedent(p));
        return 'repository';
      }
      store.write(`${PRIVATE_PREFIX}${p.id}.json`, JSON.stringify(p, null, 2) + '\n');
      return 'private store';
    },
  };
}
