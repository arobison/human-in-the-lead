// The files backend's settings: .human-in-the-lead/tracker.json (its paths and options) and the
// ID key and blocks from policy.json. A project with an existing tracker in a different place
// maps onto the layout by these settings, not by migration (design parts 3.4 and 16.7).

import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readTrustedPolicy } from '../../policy/policy.mjs';
import { schemas } from '../../schema/registry.mjs';
import { reservedFieldNames } from './format.mjs';

/**
 * @typedef {import('../../schema/validate.mjs').ValidationError} ValidationError
 * @typedef {'initiative' | 'project' | 'work' | 'decision' | 'external'} Kind
 *
 * @typedef {object} DeclaredField a project field declared in tracker.json `fields`
 * @property {string} name
 * @property {'string' | 'integer' | 'number' | 'boolean'} type
 * @property {boolean} [list]
 * @property {string[]} [values]
 * @property {string} description
 *
 * @typedef {object} Layout everything the backend needs to find and read item files
 * @property {string} key the ID key, from policy.json project.key
 * @property {string} workDir relative to the repository root, with "/" separators
 * @property {{ initiative: string, project: string, item: string }} folders
 * @property {string} viewsDir relative to workDir
 * @property {string | undefined} listsReadme relative to workDir
 * @property {string} mainBranch
 * @property {string[]} bundleRefs
 * @property {string[]} optionalKeys
 * @property {DeclaredField[]} fields project fields declared in tracker.json
 * @property {string} defaultClassification
 * @property {string} classificationCeiling policy.project.classification_ceiling
 * @property {{ name: string, from: number, to: number | null }[]} blocks reserved ID blocks
 */

/** A relative path of plain segments. */
const SAFE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/** Where the project's tracker settings live, relative to the repository root. */
export const TRACKER_CONFIG_PATH = join('.human-in-the-lead', 'tracker.json');

/** The default settings, read from the `default` values in schemas/tracker.schema.json. */
/** @returns {Record<string, any>} */
export function trackerDefaults() {
  const schema = schemas().get('tracker');
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (sub.default !== undefined) out[k] = structuredClone(sub.default);
    if (k === 'folders') {
      out.folders = Object.fromEntries(
        Object.entries(sub.properties).map(([name, f]) => [name, /** @type {any} */ (f).default]),
      );
    }
  }
  return { schema_version: schemas().currentVersion('tracker'), ...out };
}

/**
 * Read and validate tracker.json. A missing file is not an error: the defaults apply, which is
 * the reference layout (work/, with initiatives/, projects/ and items/).
 * @param {{ repoRoot: string, configDir?: string }} options
 *   configDir overrides where tracker.json is looked for (default: <repoRoot>/.human-in-the-lead),
 *   so a tracker can be read with settings kept outside its repository. Only read-only commands
 *   may use it (see core/lib/cli/commands/tracker.mjs).
 * @returns {{ path: string | null, config: Record<string, any> | null, errors: ValidationError[] }}
 */
export function loadTrackerConfig({ repoRoot, configDir }) {
  const path = configDir ? join(configDir, 'tracker.json') : join(repoRoot, TRACKER_CONFIG_PATH);
  /** @type {Record<string, any>} */
  let raw = {};
  const defaults = trackerDefaults();
  /** @type {import('node:fs').Stats | null} */
  let present = null;
  try {
    present = lstatSync(path);
  } catch {
    present = null;
  }
  if (present) {
    // tracker.json says where the tracker reads and writes, so it is trusted like policy.json:
    // a regular file, not a link, owned by the user and writable by nobody else, inside the
    // repository (or, for an explicit config directory, inside that directory).
    const read = readTrustedPolicy(path, configDir ?? repoRoot);
    if ('error' in read) {
      const message = read.error.replace(
        'policy sets decision rights, so it is not read',
        'tracker.json sets where the tracker reads and writes, so it is not read',
      );
      return { path, config: null, errors: [{ path, message }] };
    }
    try {
      raw = JSON.parse(read.text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { path, config: null, errors: [{ path, message: `cannot be read: ${message}` }] };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        path,
        config: null,
        errors: [{ path: '(top level)', message: 'must be a JSON object' }],
      };
    }
  } else {
    raw = { schema_version: defaults.schema_version };
  }
  /** @type {Record<string, any>} */
  const merged = {
    ...defaults,
    ...raw,
    ...(raw.folders && typeof raw.folders === 'object' && !Array.isArray(raw.folders)
      ? { folders: { ...defaults.folders, ...raw.folders } }
      : {}),
  };
  if (!Object.hasOwn(raw, 'schema_version')) delete merged.schema_version;
  const errors = schemas().validateEntity('tracker', merged);
  if (!errors.length) errors.push(...fieldDeclarationErrors(merged));
  return errors.length ? { path, config: null, errors } : { path, config: merged, errors };
}

/**
 * Problems with the declared fields that the schema cannot say: a name used twice, a name the
 * format already uses, values on a field that is not text.
 * @param {Record<string, any>} config validated tracker.json
 * @returns {ValidationError[]}
 */
function fieldDeclarationErrors(config) {
  /** @type {ValidationError[]} */
  const errors = [];
  const optional = schemas().get('tracker').properties.optional_keys.items.enum;
  const reserved = reservedFieldNames(optional);
  const seen = new Set();
  for (const [i, f] of (config.fields ?? []).entries()) {
    const path = `fields[${i}]`;
    if (reserved.has(f.name)) {
      errors.push({
        path: `${path}.name`,
        message: `"${f.name}" is a key the format already uses`,
      });
    }
    if (seen.has(f.name)) {
      errors.push({ path: `${path}.name`, message: `"${f.name}" is declared twice` });
    }
    seen.add(f.name);
    if (f.values && f.type !== 'string') {
      errors.push({ path: `${path}.values`, message: 'only a string field has values' });
    }
  }
  return errors;
}

/**
 * Check reserved blocks: positive, not inverted, not overlapping, and an open-ended one only last.
 * @param {{ name: string, from: number, to?: number }[]} blocks
 * @returns {string[]} problems
 */
export function checkBlocks(blocks) {
  /** @type {string[]} */
  const problems = [];
  const sorted = [...blocks].sort((a, b) => a.from - b.from);
  const names = new Set();
  for (const b of sorted) {
    if (names.has(b.name)) problems.push(`ID block "${b.name}" is listed twice`);
    names.add(b.name);
    if (b.to !== undefined && b.to < b.from) {
      problems.push(`ID block "${b.name}" ends (${b.to}) before it starts (${b.from})`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (prev.to === undefined || prev.to >= next.from) {
      problems.push(
        `ID blocks "${prev.name}" (from ${prev.from}${prev.to === undefined ? ', open-ended' : ` to ${prev.to}`}) and "${next.name}" (from ${next.from}) overlap`,
      );
    }
  }
  return problems;
}

/**
 * Join tracker.json and policy.json into the layout the backend works from.
 * @param {Record<string, any>} config validated tracker.json, defaults applied
 * @param {Record<string, any>} policy a loaded policy (resolvePolicy output)
 * @returns {Layout}
 */
export function resolveLayout(config, policy) {
  // The schemas already restrict these; check again here, since this is where paths and the key
  // become file names and patterns.
  const key = String(policy.project?.key ?? '');
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key))
    throw new Error(`ID key ${JSON.stringify(key)} is not valid`);
  for (const rel of [
    config.work_dir,
    config.views_dir,
    ...(config.lists_readme === undefined ? [] : [config.lists_readme]),
    ...Object.values(config.folders),
  ]) {
    if (!SAFE_PATH.test(String(rel)) || String(rel).includes('..')) {
      throw new Error(`tracker path ${JSON.stringify(rel)} must be relative, with no ".." segment`);
    }
  }
  const blocks = (policy.ids?.blocks ?? []).map(
    (/** @type {{ name: string, from: number, to?: number }} */ b) => ({
      name: b.name,
      from: b.from,
      to: b.to ?? null,
    }),
  );
  const problems = checkBlocks(policy.ids?.blocks ?? []);
  if (problems.length) throw new Error(problems.join('; '));
  return {
    key: policy.project.key,
    workDir: config.work_dir.replace(/\/+$/, ''),
    folders: config.folders,
    viewsDir: config.views_dir,
    listsReadme: config.lists_readme,
    mainBranch: config.main_branch,
    bundleRefs: config.bundle_refs,
    optionalKeys: config.optional_keys,
    fields: config.fields ?? [],
    defaultClassification: config.default_classification,
    classificationCeiling: policy.project.classification_ceiling ?? 'public',
    blocks,
  };
}

/**
 * The number range an ID may be allocated from, for a block name (or the base range).
 * @param {Layout} layout
 * @param {string | undefined} name a reserved block's name; undefined for the base range
 * @returns {{ name: string, from: number, to: number | null }}
 */
export function blockRange(layout, name) {
  if (name === undefined || name === '' || name === 'base') {
    const lowest = Math.min(...layout.blocks.map((b) => b.from), Infinity);
    return { name: 'base', from: 1, to: Number.isFinite(lowest) ? lowest - 1 : null };
  }
  const b = layout.blocks.find((x) => x.name === name);
  if (!b) {
    const known = layout.blocks.map((x) => x.name).join(', ') || 'none are reserved';
    throw new Error(`no ID block named "${name}" in policy.json ids.blocks (${known})`);
  }
  return b;
}
