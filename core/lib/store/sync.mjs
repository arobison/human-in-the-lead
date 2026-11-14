// Moving and syncing the private store between machines (design part 3.2, Q1): export, import and
// sync of one encrypted file holding a git bundle of the store's text history and a manifest.
//
// Only the owner runs these (the commands refuse executors). The file goes between machines the
// owner controls, which are inside the trust boundary (design part 10.1); it is still opened with
// authenticated encryption, checked against this project and this version's schemas, and its
// bundle verified before anything is fetched.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { schemas } from '../schema/registry.mjs';
import { VERSION } from '../version.mjs';
import { openStore } from './store.mjs';
import {
  BRANCH,
  StoreGitError,
  createBundle,
  dropIncoming,
  ensureRepo,
  fetchBundle,
  hasText,
  mergeIncoming,
  snapshot,
} from './git.mjs';
import { open, seal } from './sealed.mjs';
import { rebuildIndex } from './index-db.mjs';

/**
 * @typedef {{ N: number, r: number, p: number }} ScryptCost
 * @typedef {{ root: string, projectId: string, passphrase: string, file: string, scrypt?: ScryptCost, now?: () => Date }} SyncOptions
 *   scrypt and now are for tests
 */

/** The schema versions this release writes. */
function schemaVersions() {
  const registry = schemas();
  return Object.fromEntries(registry.versionedIds().map((id) => [id, registry.currentVersion(id)]));
}

/**
 * Write the store's text history to one encrypted file.
 * @param {SyncOptions} options
 */
export function exportStore(options) {
  const file = resolve(options.file);
  const rel = relative(resolve(options.root), file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new StoreGitError(
      'bad_path',
      `the export file ${file} is inside the store; put it elsewhere`,
    );
  }
  const root = ensureRepo(options.root);
  const head = snapshot(root, 'store export');
  const bundle = createBundle(root);
  /** @type {import('./sealed.mjs').Manifest} */
  const manifest = {
    project: options.projectId,
    schema_versions: /** @type {Record<string, number>} */ (schemaVersions()),
    head,
    branch: BRANCH,
    created_at: (options.now ?? (() => new Date()))().toISOString(),
    hitld_version: VERSION,
  };
  const bytes = seal(manifest, bundle, options.passphrase, { scrypt: options.scrypt });
  // The owner names the file. Written beside it, then renamed, readable by the owner only.
  const tmp = join(dirname(file), `.${process.pid}.hitld-export.tmp`);
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, file);
  return { file, project: options.projectId, head, bytes: bytes.length };
}

/**
 * Bring another machine's store history in: open and check the file, verify and fetch its bundle,
 * merge, then rebuild the index. A conflict stops it with nothing written.
 * @param {SyncOptions} options
 */
export async function importStore(options) {
  const { manifest, bundle } = open(readFileSync(resolve(options.file)), options.passphrase);
  if (manifest.project !== options.projectId) {
    throw new StoreGitError(
      'another_project',
      `the file is from project ${JSON.stringify(manifest.project)}, not ${JSON.stringify(options.projectId)}`,
    );
  }
  const known = /** @type {Record<string, number>} */ (schemaVersions());
  const newer = Object.entries(manifest.schema_versions)
    .filter(([id, v]) => !(id in known) || !Number.isInteger(v) || v > known[id])
    .map(([id, v]) => `${id} ${v} (this version: ${known[id] ?? 'none'})`);
  if (newer.length) {
    throw new StoreGitError(
      'newer_schema',
      `the file was written by a newer release; upgrade hitld before importing it: ${newer.join(', ')}`,
    );
  }
  const root = ensureRepo(options.root);
  // A store with nothing in it yet takes the imported history as it is (a fast-forward).
  const before = hasText(root) ? snapshot(root, 'store before import') : null;
  try {
    const theirs = fetchBundle(root, bundle, manifest.head);
    const merged = mergeIncoming(root, theirs);
    if (merged.result === 'conflict') {
      return {
        ok: false,
        error: 'conflict',
        message: `the import stopped on a conflict; nothing was merged. Resolve it in ${root} and import again`,
        project: manifest.project,
        head: before,
        incoming: manifest.head,
        conflicts: merged.conflicts,
      };
    }
    const index = await rebuildIndex(openStore(root));
    return {
      ok: true,
      project: manifest.project,
      result: merged.result,
      head: merged.head,
      incoming: manifest.head,
      changed: merged.changed,
      index: { events: index.events, ledger_problems: index.ledger_problems },
    };
  } finally {
    dropIncoming(root);
  }
}

/**
 * Both directions through one file: import it if it exists, then export the merged store over it.
 * A conflict stops before the export, so the file is left as it was.
 * @param {SyncOptions} options
 */
export async function syncStore(options) {
  const had = existsSync(resolve(options.file));
  const imported = had ? await importStore(options) : null;
  if (imported && !imported.ok) return { ...imported, exported: null };
  const exported = exportStore(options);
  return { ok: true, imported, exported };
}
