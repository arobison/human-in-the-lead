// Release records in the files backend (design part 3.2, Release; Q32; HITLD-752): one file per
// release of a package, <work dir>/releases/<package>/<version>.md, written by `hitld release
// make`. Its `id` is the tag, from the package's tag template. A record is data only, like an item
// file: front matter of strings and lists of strings, then the notes.
//
//   interface_delta entries: "<breaking|additive|fix> <surface>: <what>"
//   depends entries:         "<package>@<version>", the exact versions it was built against
//
// A record directly under <work dir>/releases/, named <tag>.md, is a repository-wide record from
// before release packages: it is read while no package is declared, and `hitld release migrate`
// moves it into the package named main. Once a package is declared, the check refuses one.
//
// A release moves items from merged to released: an item's `released_in` is the first full
// release whose record lists it. A pre-release (a version with a hyphen, such as 0.1.0-rc.1) is
// recorded and tagged like any release, but it is never the base of a bump and never sets
// `released_in`.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { schemas } from '../../schema/registry.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { CODE_KEYS } from './format.mjs';
import { parseItem } from './frontmatter.mjs';
import { insidePath, isRegularFile, readNoFollow } from './safe.mjs';
import { versionOf } from './tree.mjs';
import { SEMVER, TAG, compareVersions, isPrerelease } from '../../release/semver.mjs';
import { PACKAGE_NAME, tagFor } from '../../release/packages.mjs';

export { isPrerelease };

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry & { package?: string | null }} Entry
 *   package: the package folder the record is in; null for a record from before packages
 * @typedef {{ impact: string, surface: string, what: string }} DeltaEntry
 */

/** The stored keys of a release record, in the order they are written. */
export const RELEASE_KEYS = [
  'id',
  'package',
  'version',
  'previous',
  'bump',
  'interface_delta',
  'depends',
  'decision',
  'train',
  'items',
  'milestones',
  'classification',
];
const LIST_KEYS = ['interface_delta', 'depends', 'items', 'milestones'];
export const IMPACTS = ['breaking', 'additive', 'fix'];
/**
 * The interface areas a delta entry names. `surface` is a package's committed surface file; the
 * others are the parts of HITLD's own interface its records from before packages name.
 */
export const AREAS = [
  'surface',
  'schemas',
  'cli',
  'contract',
  'report',
  'trailers',
  'read-api',
  'adapters',
];

/** @param {string} s @returns {{ package: string, version: string } | { error: string }} */
export function parseDependsEntry(s) {
  const m = /^([^@\s]+)@(\S+)$/.exec(String(s).trim());
  if (!m || !PACKAGE_NAME.test(m[1]) || !SEMVER.test(m[2])) {
    return { error: `"${s}" isn't "<package>@<version>"` };
  }
  return { package: m[1], version: m[2] };
}

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

/** A package's records' folder, repository-relative. @param {Layout} layout @param {string} name */
export const packageReleasesDir = (layout, name) => `${releasesDir(layout)}/${name}`;

/** A package's record for a version, repository-relative. @param {Layout} layout @param {string} name @param {string} version */
export const recordPath = (layout, name, version) =>
  `${packageReleasesDir(layout, name)}/${version}.md`;

/**
 * Read every release record: those in each package's folder, then any from before packages.
 * @param {string} root @param {Layout} layout
 * @returns {Entry[]}
 */
export function loadReleases(root, layout) {
  const rel = releasesDir(layout);
  const dir = insidePath(root, rel); // refuses a symbolic link
  if (!existsSync(dir)) return [];
  /** @type {Entry[]} */
  const out = [];
  /** @param {string} folder repository-relative @param {string} abs @param {string | null} pkg */
  const readFolder = (folder, abs, pkg) => {
    for (const file of readdirSync(abs).sort()) {
      if (!file.endsWith('.md')) continue;
      const path = `${folder}/${file}`;
      if (!isRegularFile(join(abs, file))) {
        out.push({
          path,
          file,
          folder: layout.folders.release,
          package: pkg,
          data: null,
          body: '',
          errors: ['is not a regular file (a symbolic link?); release records are never followed'],
        });
        continue;
      }
      const text = readNoFollow(join(abs, file));
      out.push({
        path,
        file,
        folder: layout.folders.release,
        package: pkg,
        version: versionOf(text),
        ...parseItem(text),
      });
    }
  };
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    let isDir = false;
    try {
      // insidePath refuses a link on the way; a folder that is a link is never followed.
      isDir = statSync(insidePath(root, `${rel}/${name}`)).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) readFolder(`${rel}/${name}`, abs, name);
  }
  readFolder(rel, dir, null);
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
    const list = Array.isArray(d[k]) ? d[k] : [d[k]];
    e[k] =
      k === 'interface_delta'
        ? list.map((s) => parseDeltaEntry(String(s)))
        : k === 'depends'
          ? list.map((s) => parseDependsEntry(String(s)))
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
  const packages = layout.packages ?? [];
  const byName = new Map(packages.map((p) => [p.name, p]));
  /** Record IDs by package folder ('' for records from before packages). */
  /** @type {Map<string, Set<string>>} */
  const ids = new Map();
  for (const r of records) {
    const key = r.package ?? '';
    if (r.data?.id) ids.set(key, (ids.get(key) ?? new Set()).add(String(r.data.id)));
  }
  /** @type {Map<string, string>} tag to the record that holds it */
  const tags = new Map();
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
    const pkg = r.package ?? null;
    if (pkg === null) {
      // A record from before packages: a v-tag, in a file named by it.
      if (packages.length) {
        say(
          byName.has('main')
            ? 'is a repository-wide record from before release packages; hitld release migrate moves it into the package named main'
            : 'is a repository-wide record from before release packages; declare a package named main (tag template v{version}), then hitld release migrate moves it there',
        );
      }
      if (d.package !== undefined)
        say(`package ${d.package} is set, but the record is in no package's folder`);
      if (!TAG.test(id)) say(`id "${id}" isn't a release tag (v and a semantic version)`);
      else if (r.file !== `${id}.md`) say(`file name isn't its tag, ${id}.md`);
      if (d.version !== undefined && `v${d.version}` !== id) {
        say(`version ${d.version} doesn't match the tag ${id}`);
      }
    } else {
      const p = byName.get(pkg);
      if (!p)
        say(
          `is in the folder of ${pkg}, which is not a package declared in policy.json release.packages`,
        );
      if (d.package !== pkg)
        say(`package is ${d.package ?? 'not set'}, but the record is in the folder of ${pkg}`);
      const version = String(d.version ?? '');
      if (!SEMVER.test(version)) say(`version "${version}" isn't a semantic version`);
      else if (r.file !== `${version}.md`) say(`file name isn't its version, ${version}.md`);
      else if (p && id !== tagFor(p, version)) {
        say(`id ${id} isn't the tag ${tagFor(p, version)} that ${pkg}'s template (${p.tag}) gives`);
      }
    }
    if (id && tags.has(id)) say(`id ${id} is also the tag of ${tags.get(id)}`);
    else if (id) tags.set(id, r.path);
    if (d.previous !== undefined) {
      if (!ids.get(pkg ?? '')?.has(String(d.previous))) {
        say(`previous ${d.previous} has no release record${pkg ? ` in ${pkg}` : ''}`);
      } else {
        const prev = records.find(
          (x) => (x.package ?? null) === pkg && x.data?.id === String(d.previous),
        );
        if (isPrerelease(String(prev?.data?.version ?? ''))) {
          say(`previous ${d.previous} is a pre-release; a bump is measured from a full release`);
        }
      }
    }
    for (const s of Array.isArray(d.interface_delta) ? d.interface_delta : []) {
      const e = parseDeltaEntry(s);
      if ('error' in e) say(`interface_delta: ${e.error}`);
    }
    for (const s of Array.isArray(d.depends) ? d.depends : []) {
      const e = parseDependsEntry(s);
      if ('error' in e) say(`depends: ${e.error}`);
      else if (packages.length && !byName.has(e.package)) {
        say(`depends: ${e.package} is not a declared package`);
      }
    }
    if (d.train !== undefined && !get(String(d.train))) say(`train ${d.train} doesn't exist`);
    for (const key of ['items', 'milestones']) {
      for (const ref of Array.isArray(d[key]) ? d[key] : []) {
        const t = get(ref);
        if (!t) say(`${key} ${ref} doesn't exist`);
        else if (key === 'milestones' && t.kind !== 'milestone') {
          say(`milestones ${ref} is a ${t.kind}, not a milestone`);
        } else if (key === 'items' && ['milestone', 'project'].includes(String(t.kind))) {
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
 * The warning while a repository is between release lines (HITLD-899): records from before
 * packages exist and no package is declared, so `release propose` and `release make` refuse
 * until the migration is applied. Once a package is declared, such a record is a problem instead
 * (checkReleases).
 * @param {Entry[]} records @param {Layout} layout
 * @returns {string[]}
 */
export function legacyReleaseWarnings(records, layout) {
  if ((layout.packages ?? []).length) return [];
  const legacy = records.filter((r) => (r.package ?? null) === null);
  if (!legacy.length) return [];
  const more = legacy.length > 1 ? ` (and ${legacy.length - 1} more)` : '';
  return [
    `${legacy[0].path}${more} is a release record from before release packages, and no package is declared: release propose and release make refuse (no-packages) until the owner runs hitld release migrate --apply, which declares the package main and moves the records into it`,
  ];
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

/**
 * The items a package's full releases list, so they are not proposed again.
 * @param {Entry[]} records @param {string} name the package
 * @returns {Set<string>}
 */
export function releasedInPackage(records, name) {
  return new Set(
    records
      .filter(
        (r) =>
          r.package === name &&
          typeof r.data?.version === 'string' &&
          !isPrerelease(String(r.data.version)),
      )
      .flatMap((r) => (Array.isArray(r.data?.items) ? r.data.items.map(String) : [])),
  );
}
