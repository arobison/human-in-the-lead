// Release records in the files backend (design part 3.2, Release; Q32): one file per release,
// <work dir>/releases/<tag>.md, named by its tag and written by `hitld release make`. A record is
// data only, like an item file: front matter of strings and lists of strings, then the notes.
//
//   interface_delta entries: "<breaking|additive|fix> <surface>: <what>"
//
// A release moves items from merged to released: an item's `released_in` is the first full
// release whose record lists it. A pre-release (a version with a hyphen, such as 0.1.0-rc.1) is
// recorded and tagged like any release, but it is never the base of a bump and never sets
// `released_in`.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { schemas } from '../../schema/registry.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { CODE_KEYS } from './format.mjs';
import { parseItem } from './frontmatter.mjs';
import { insidePath, isRegularFile, readNoFollow } from './safe.mjs';
import { versionOf } from './tree.mjs';
import { TAG, compareVersions, isPrerelease } from '../../release/semver.mjs';

export { isPrerelease };

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 * @typedef {{ impact: string, surface: string, what: string }} DeltaEntry
 */

/** The stored keys of a release record, in the order they are written. */
export const RELEASE_KEYS = [
  'id',
  'version',
  'previous',
  'bump',
  'interface_delta',
  'decision',
  'items',
  'milestones',
  'classification',
];
const LIST_KEYS = ['interface_delta', 'items', 'milestones'];
export const IMPACTS = ['breaking', 'additive', 'fix'];
export const AREAS = ['schemas', 'cli', 'contract', 'report', 'trailers', 'read-api', 'adapters'];

/** @param {string} s @returns {DeltaEntry | { error: string }} */
export function parseDeltaEntry(s) {
  const m = /^(\S+)\s+([a-z-]+):\s+(\S.*)$/.exec(String(s).trim());
  if (!m || !IMPACTS.includes(m[1]) || !AREAS.includes(m[2])) {
    return {
      error: `"${s}" isn't "<${IMPACTS.join(' | ')}> <${AREAS.join(' | ')}>: <what>"`,
    };
  }
  return { impact: m[1], surface: m[2], what: m[3].trim() };
}

/** @param {DeltaEntry} e */
export const formatDeltaEntry = (e) => `${e.impact} ${e.surface}: ${e.what}`;

/** The records' folder, repository-relative. @param {Layout} layout */
export const releasesDir = (layout) => `${layout.workDir}/${layout.folders.release}`;

/**
 * Read every release record.
 * @param {string} root @param {Layout} layout
 * @returns {Entry[]}
 */
export function loadReleases(root, layout) {
  const rel = releasesDir(layout);
  const dir = insidePath(root, rel); // refuses a symbolic link
  if (!existsSync(dir)) return [];
  /** @type {Entry[]} */
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const path = `${rel}/${file}`;
    if (!isRegularFile(join(dir, file))) {
      out.push({
        path,
        file,
        folder: layout.folders.release,
        data: null,
        body: '',
        errors: ['is not a regular file (a symbolic link?); release records are never followed'],
      });
      continue;
    }
    const text = readNoFollow(join(dir, file));
    out.push({
      path,
      file,
      folder: layout.folders.release,
      version: versionOf(text),
      ...parseItem(text),
    });
  }
  return out;
}

/**
 * The record as the read API returns it.
 * @param {Record<string, unknown>} d stored keys @param {Layout} layout
 */
export function releaseEntity(d, layout) {
  /** @type {Record<string, unknown>} */
  const e = { schema_version: 1 };
  for (const k of RELEASE_KEYS) {
    if (d[k] === undefined) continue;
    e[k] =
      k === 'interface_delta'
        ? (Array.isArray(d[k]) ? d[k] : [d[k]]).map((s) => parseDeltaEntry(String(s)))
        : d[k];
  }
  e.classification = d.classification ?? layout.defaultClassification;
  return e;
}

/**
 * Problems with the release records, given the tracker's entries (for references).
 * @param {Entry[]} records @param {Layout} layout
 * @param {(id: string) => Record<string, unknown> | undefined} get tracker entries by ID
 * @returns {string[]}
 */
export function checkReleases(records, layout, get) {
  /** @type {string[]} */
  const problems = [];
  const ids = new Set(records.map((r) => r.data?.id).filter(Boolean));
  for (const r of records) {
    /** @param {string} msg */
    const say = (msg) => problems.push(`${r.path}: ${msg}`);
    for (const e of r.errors) say(e);
    const d = r.data;
    if (!d) continue;
    const before = problems.length;
    for (const key of Object.keys(d)) {
      if (CODE_KEYS.includes(key)) say(`"${key}" is a key some tools run as code; never allowed`);
      else if (!RELEASE_KEYS.includes(key)) say(`"${key}" isn't an allowed key for a release`);
      else if (Array.isArray(d[key]) !== LIST_KEYS.includes(key)) {
        say(`"${key}" must be ${LIST_KEYS.includes(key) ? 'a list' : 'a single value'}`);
      }
    }
    const id = String(d.id ?? '');
    if (!TAG.test(id)) say(`id "${id}" isn't a release tag (v and a semantic version)`);
    else if (r.file !== `${id}.md`) say(`file name isn't its tag, ${id}.md`);
    if (d.version !== undefined && `v${d.version}` !== id) {
      say(`version ${d.version} doesn't match the tag ${id}`);
    }
    if (d.previous !== undefined) {
      if (!ids.has(String(d.previous))) say(`previous ${d.previous} has no release record`);
      else if (isPrerelease(String(d.previous).slice(1))) {
        say(`previous ${d.previous} is a pre-release; a bump is measured from a full release`);
      }
    }
    for (const s of Array.isArray(d.interface_delta) ? d.interface_delta : []) {
      const e = parseDeltaEntry(s);
      if ('error' in e) say(`interface_delta: ${e.error}`);
    }
    for (const key of ['items', 'milestones']) {
      for (const ref of Array.isArray(d[key]) ? d[key] : []) {
        const t = get(ref);
        if (!t) say(`${key} ${ref} doesn't exist`);
        else if (key === 'milestones' && !['capability', 'learning'].includes(String(t.kind))) {
          say(`milestones ${ref} is a ${t.kind}, not a milestone`);
        } else if (
          key === 'items' &&
          ['capability', 'learning', 'project', 'initiative'].includes(String(t.kind))
        ) {
          say(`items ${ref} is a ${t.kind}, not an item`);
        }
      }
    }
    if (problems.length > before) continue;
    const errors = schemas().validateEntity('release', releaseEntity(d, layout));
    if (errors.length) say(`schema: ${formatErrors(errors).split('\n').join('; ')}`);
  }
  return problems;
}

/**
 * Each item's `released_in`: the first full release, by version, whose record lists it.
 * @param {Entry[]} records
 * @returns {Map<string, string>}
 */
export function releasedIn(records) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const full = records
    .filter((r) => r.data && typeof r.data.version === 'string' && !isPrerelease(r.data.version))
    .sort((a, b) => compareVersions(String(a.data?.version), String(b.data?.version)));
  for (const r of full) {
    for (const id of Array.isArray(r.data?.items) ? r.data.items : []) {
      if (!out.has(id)) out.set(id, String(r.data?.id));
    }
  }
  return out;
}
