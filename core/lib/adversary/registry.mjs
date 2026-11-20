// Invariant registries (design 6.3, step 1): one per area that has one, in the knowledge base at
// kb/areas/<area>/invariants.json unless the area's `invariants` pointer in policy.json names
// another file. Loading checks the file against its schema and against the repository: the area
// exists, every module is a file inside the repository, and each form has the export it needs.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { safePath } from '../precedent/glob.mjs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';

/**
 * @typedef {import('./generate.mjs').Gen} Gen
 * @typedef {{ id: string, statement: string, checked: string,
 *   form: keyof typeof import('./forms.mjs').FORMS, module: string, target: string,
 *   inverse?: string, oracle?: string, oracle_module?: string, args: Gen[], runs?: number }} Invariant
 * @typedef {{ schema_version: number, area: string, tests_dir: string, fix_parent?: string,
 *   invariants: Invariant[] }} RegistryData
 * @typedef {{ area: string, path: string, paths: string[], data: RegistryData | null, errors: string[] }} Registry
 *   path: repository-relative; paths: the area's globs; data null when the file did not load
 */

/** Where an area's registry lives by default. @param {string} area */
export const defaultRegistryPath = (area) => `kb/areas/${area}/invariants.json`;

/**
 * Whether a repository-relative path names a file inside the repository, through no link out.
 * @param {string} root @param {string} rel
 * @returns {string | null} what is wrong, or null
 */
function insideFile(root, rel) {
  const safe = safePath(rel);
  if ('error' in safe) return safe.error;
  const full = join(root, safe.path);
  if (!existsSync(full)) return `${rel} does not exist`;
  const real = realpathSync(full);
  const top = realpathSync(root);
  if (real !== top && !real.startsWith(top + sep)) return `${rel} leads outside the repository`;
  return null;
}

/**
 * The problems with a registry beyond its schema.
 * @param {string} root @param {RegistryData} data @param {string} area
 * @returns {string[]}
 */
function crossCheck(root, data, area) {
  /** @type {string[]} */
  const errors = [];
  if (data.area !== area) errors.push(`area is ${data.area}, but the file belongs to ${area}`);
  const dir = safePath(data.tests_dir);
  if ('error' in dir) errors.push(`tests_dir: ${dir.error}`);
  const seen = new Set();
  for (const inv of data.invariants) {
    const at = `invariant ${inv.id}`;
    if (seen.has(inv.id)) errors.push(`${at}: the id is used twice`);
    seen.add(inv.id);
    const missing = insideFile(root, inv.module);
    if (missing) errors.push(`${at}: module: ${missing}`);
    if (inv.oracle_module) {
      const bad = insideFile(root, inv.oracle_module);
      if (bad) errors.push(`${at}: oracle_module: ${bad}`);
    }
    const needs = { 'round-trip': 'inverse', differential: 'oracle' }[
      /** @type {string} */ (inv.form)
    ];
    if (needs && !(/** @type {Record<string, unknown>} */ (inv)[needs])) {
      errors.push(`${at}: the ${inv.form} form needs ${needs}`);
    }
    for (const k of /** @type {const} */ (['inverse', 'oracle', 'oracle_module'])) {
      const allowed = k === 'inverse' ? inv.form === 'round-trip' : inv.form === 'differential';
      if (inv[k] !== undefined && !allowed) errors.push(`${at}: ${k} is not used by ${inv.form}`);
    }
    if (inv.form === 'order-independent' && inv.args[0]?.type !== 'array') {
      errors.push(`${at}: order-independent needs a list (array generator) as the first argument`);
    }
    if (['round-trip', 'idempotent'].includes(inv.form) && inv.args.length !== 1) {
      errors.push(`${at}: ${inv.form} takes one argument`);
    }
  }
  return errors;
}

/**
 * Read one registry file.
 * @param {string} root @param {string} rel @param {string} area
 * @returns {{ data: RegistryData | null, errors: string[] }}
 */
export function readRegistry(root, rel, area) {
  const bad = insideFile(root, rel);
  if (bad) return { data: null, errors: [bad] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (e) {
    return { data: null, errors: [`not JSON: ${e instanceof Error ? e.message : e}`] };
  }
  const problems = schemas().validateEntity('invariants', raw);
  if (problems.length) return { data: null, errors: formatErrors(problems).split('\n') };
  const data = /** @type {RegistryData} */ (raw);
  const errors = crossCheck(root, data, area);
  return { data: errors.length ? null : data, errors };
}

/**
 * Every area's registry: those an area points at, and those at the default path. An area with
 * neither has no registry and is left out.
 * @param {string} root
 * @param {{ rights?: { areas?: { name: string, paths: string[], invariants?: string }[] } }} policy
 * @returns {Registry[]}
 */
export function registries(root, policy) {
  /** @type {Registry[]} */
  const out = [];
  for (const a of policy.rights?.areas ?? []) {
    const pointer = typeof a.invariants === 'string' && a.invariants.endsWith('.json');
    const rel = pointer ? /** @type {string} */ (a.invariants) : defaultRegistryPath(a.name);
    if (!pointer && !existsSync(join(root, rel))) continue;
    const { data, errors } = readRegistry(root, rel, a.name);
    out.push({ area: a.name, path: rel, paths: a.paths, data, errors });
  }
  return out;
}
