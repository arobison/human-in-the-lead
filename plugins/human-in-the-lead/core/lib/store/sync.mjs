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
import { FORMAT, checkRecipients, open, seal } from './sealed.mjs';
import { rebuildIndex } from './index-db.mjs';

/**
 * @typedef {object} SyncOptions
 * @property {string} root the store directory
 * @property {string} projectId
 * @property {string} [file] the export file (not needed when `bytes` is given)
 * @property {Buffer} [bytes] an import's file already in memory (a pull from a remote)
 * @property {string[]} [recipients] age public keys an export is encrypted to (format 2)
 * @property {Array<string | import('./age.mjs').Identity>} [identities] age private keys an
 *   import opens a format-2 file with
 * @property {string} [passphrase] what an import opens a format-1 file with
 * @property {() => Date} [now] for tests
 */

/** The schema versions this release writes. */
function schemaVersions() {
  const registry = schemas();
  return Object.fromEntries(registry.versionedIds().map((id) => [id, registry.currentVersion(id)]));
}

/**
 * The recipients a file's manifest says it was sealed to, sorted; null when it says nothing.
 * @param {import('./sealed.mjs').Manifest} manifest
 * @returns {string[] | null}
 */
function sealedTo(manifest) {
  const r = manifest.recipients;
  return Array.isArray(r) && r.every((x) => typeof x === 'string') ? [...r].sort() : null;
}

/**
 * Commit the store's text and seal its history, format 2, encrypted to the recipients: the bytes
 * an export writes to a file and a push sends to a remote.
 * @param {SyncOptions} options
 * @returns {{ bytes: Buffer, head: string }}
 */
export function sealStore(options) {
  const recipients = checkRecipients(options.recipients);
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
    recipients: [...recipients].sort(),
  };
  return { bytes: seal(manifest, bundle, recipients), head };
}

/**
 * Write the store's text history to one encrypted file, format 2, encrypted to the recipients.
 * @param {SyncOptions} options
 */
export function exportStore(options) {
  const recipients = checkRecipients(options.recipients);
  const file = resolve(String(options.file));
  const rel = relative(resolve(options.root), file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new StoreGitError(
      'bad-path',
      `the export file ${file} is inside the store; put it elsewhere`,
    );
  }
  const { bytes, head } = sealStore(options);
  // The owner names the file. Written beside it, then renamed, readable by the owner only.
  const tmp = join(dirname(file), `.${process.pid}.hitld-export.tmp`);
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, file);
  return {
    file,
    project: options.projectId,
    head,
    format: FORMAT,
    recipients: recipients.length,
    bytes: bytes.length,
  };
}

/**
 * Bring another machine's store history in: open and check the file (format 2 with an age private
 * key, format 1 with a passphrase), verify and fetch its bundle, merge, then rebuild the index. A
 * conflict stops it with nothing written.
 * @param {SyncOptions} options
 */
export async function importStore(options) {
  const { manifest, bundle, format } = open(
    options.bytes ?? readFileSync(resolve(String(options.file))),
    {
      identities: options.identities,
      passphrase: options.passphrase,
    },
  );
  if (manifest.project !== options.projectId) {
    throw new StoreGitError(
      'another-project',
      `the file is from project ${JSON.stringify(manifest.project)}, not ${JSON.stringify(options.projectId)}`,
    );
  }
  const known = /** @type {Record<string, number>} */ (schemaVersions());
  const newer = Object.entries(manifest.schema_versions)
    .filter(([id, v]) => !(id in known) || !Number.isInteger(v) || v > known[id])
    .map(([id, v]) => `${id} ${v} (this version: ${known[id] ?? 'none'})`);
  if (newer.length) {
    throw new StoreGitError(
      'newer-schema',
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
        format,
        head: before,
        incoming: manifest.head,
        conflicts: merged.conflicts,
      };
    }
    const index = await rebuildIndex(openStore(root));
    return {
      ok: true,
      project: manifest.project,
      format,
      result: merged.result,
      head: merged.head,
      incoming: manifest.head,
      sealed_to: sealedTo(manifest),
      changed: merged.changed,
      index: { events: index.events, ledger_problems: index.ledger_problems },
    };
  } finally {
    dropIncoming(root);
  }
}

/**
 * Both directions through one file: import it if it exists (either format), then export the
 * merged store over it, format 2. A conflict stops before the export, so the file is left as it
 * was. The recipients are checked first, so a sync that could not write does not import.
 * @param {SyncOptions} options
 */
export async function syncStore(options) {
  checkRecipients(options.recipients);
  const had = existsSync(resolve(String(options.file)));
  const imported = had ? await importStore(options) : null;
  if (imported && !imported.ok) return { ...imported, exported: null };
  const exported = exportStore(options);
  return { ok: true, imported, exported };
}
