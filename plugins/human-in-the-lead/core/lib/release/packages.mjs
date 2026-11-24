// Release packages (design part 16.5, HITLD-752): the units with their own version, tags, release
// records and interface delta, declared in policy.json `release.packages`.
//
// A package has a name, a tag template, the paths it owns, an optional committed surface file, an
// optional version source, optional dependencies with version ranges, an optional lockstep group
// and its pre-release channels. Every repository declares at least one; there is no implicit,
// unnamed package. `--package` may be left out only when exactly one is declared.
//
// Tag templates. A template holds {version} once, at its end, and {name} at most once, so a tag
// is a literal prefix and a version. Two packages' tags could collide exactly when one prefix
// starts with the other and what is left over, followed by a version, is itself a version (a
// prefix "v" and "v1" collide on v11.0.0); `hitld work check` refuses such a pair.

import { existsSync } from 'node:fs';
import { CodedError } from '../cli/errors.mjs';
import { globMatch, safePath } from '../precedent/glob.mjs';
import { insidePath } from '../tracker/files/safe.mjs';
import { SEMVER, compareVersions, parseVersion } from './semver.mjs';

/** The default tag template. */
export const DEFAULT_TAG = '{name}@{version}';
/** The default pre-release channels. */
export const DEFAULT_CHANNELS = ['alpha', 'beta', 'rc'];
/** A package name. */
export const PACKAGE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/**
 * @typedef {object} Package
 * @property {string} name
 * @property {string} tag the tag template
 * @property {string[]} paths
 * @property {string | null} surface the committed surface file, repository-relative
 * @property {string | null} version_source
 * @property {Record<string, string>} depends_on package name to version range
 * @property {string | null} group
 * @property {string[]} channels
 */

/**
 * The packages policy.json declares, with their defaults filled in.
 * @param {Record<string, any> | null | undefined} policy
 * @returns {Package[]}
 */
export function declaredPackages(policy) {
  const list = Array.isArray(policy?.release?.packages) ? policy.release.packages : [];
  return list.map((/** @type {Record<string, any>} */ p) => ({
    name: String(p.name),
    tag: typeof p.tag === 'string' ? p.tag : DEFAULT_TAG,
    paths: Array.isArray(p.paths) ? p.paths.map(String) : [],
    surface: typeof p.surface === 'string' ? p.surface : null,
    version_source: typeof p.version_source === 'string' ? p.version_source : null,
    depends_on:
      p.depends_on && typeof p.depends_on === 'object' && !Array.isArray(p.depends_on)
        ? Object.fromEntries(Object.entries(p.depends_on).map(([k, v]) => [k, String(v)]))
        : {},
    group: typeof p.group === 'string' ? p.group : null,
    channels: Array.isArray(p.channels) ? p.channels.map(String) : [...DEFAULT_CHANNELS],
  }));
}

/**
 * The literal part of a package's tags, before the version.
 * @param {Pick<Package, 'name' | 'tag'>} p
 */
export const tagPrefix = (p) => p.tag.replace('{name}', p.name).replace(/\{version\}$/, '');

/** A package's tag for a version. @param {Pick<Package, 'name' | 'tag'>} p @param {string} version */
export const tagFor = (p, version) => `${tagPrefix(p)}${version}`;

/**
 * The version a tag holds for a package, or null when the tag is not one of the package's.
 * @param {Pick<Package, 'name' | 'tag'>} p @param {string} tag
 */
export function versionOfTag(p, tag) {
  const prefix = tagPrefix(p);
  if (!tag.startsWith(prefix)) return null;
  const v = tag.slice(prefix.length);
  return SEMVER.test(v) ? v : null;
}

/** Sample versions a leftover prefix part is tried against. */
const SAMPLES = ['0.0.0', '1.0.0', '1.0.0-rc.1'];

/**
 * Whether two packages' templates could match the same tag.
 * @param {Pick<Package, 'name' | 'tag'>} a @param {Pick<Package, 'name' | 'tag'>} b
 */
export function templatesOverlap(a, b) {
  const pa = tagPrefix(a);
  const pb = tagPrefix(b);
  if (pa === pb) return true;
  const [short, long] = pa.length < pb.length ? [pa, pb] : [pb, pa];
  if (!long.startsWith(short)) return false;
  const rest = long.slice(short.length);
  return SAMPLES.some((v) => SEMVER.test(rest + v));
}

/** Problems with one tag template. @param {string} tag */
function templateProblems(tag) {
  /** @type {string[]} */
  const out = [];
  if (!/^[A-Za-z0-9._@/{}-]*\{version\}$/.test(tag)) {
    out.push(
      `tag template "${tag}" must end with {version} and hold only letters, digits and . _ - @ /`,
    );
    return out;
  }
  const rest = tag.replace(/\{version\}$/, '');
  if (rest.includes('{version}')) out.push(`tag template "${tag}" holds {version} more than once`);
  if (rest.split('{name}').length > 2)
    out.push(`tag template "${tag}" holds {name} more than once`);
  if (/[{}]/.test(rest.replace(/\{name\}/g, '').replace(/\{version\}/g, ''))) {
    out.push(`tag template "${tag}" has a brace that is not {name} or {version}`);
  }
  const literal = rest.replace(/\{name\}/g, 'x');
  if (/\/\/|^\/|\.\.|@\{|\.\/|\/\.|^\.|\.lock\//.test(literal)) {
    out.push(`tag template "${tag}" would not make a valid git tag name`);
  }
  return out;
}

// --- Version ranges ----------------------------------------------------------------------------

/** One comparator: an operator and a version. */
const COMPARATOR = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Whether a range is one this module reads. @param {string} range */
export const validRange = (range) =>
  range.trim() === '*' ||
  (range.trim() !== '' &&
    range
      .trim()
      .split(/\s+/)
      .every((c) => COMPARATOR.test(c)));

/**
 * Whether a version satisfies a range: every space-separated comparator holds, by semantic
 * version order. ^ allows changes that keep the leftmost non-zero part, ~ patch changes; a
 * pre-release of a version inside the range (1.3.0-rc.1 for ^1.2.0) is inside it.
 * @param {string} version @param {string} range
 */
export function satisfies(version, range) {
  if (!SEMVER.test(version) || !validRange(range)) return false;
  if (range.trim() === '*') return true;
  const parts = range.trim().split(/\s+/);
  return parts.every((c) => {
    const m = /** @type {RegExpExecArray} */ (COMPARATOR.exec(c));
    const op = m[1] ?? '=';
    const v = m[2];
    const cmp = compareVersions(version, v);
    const base = /** @type {import('./semver.mjs').Version} */ (parseVersion(v));
    if (op === '=') return cmp === 0;
    if (op === '>') return cmp > 0;
    if (op === '>=') return cmp >= 0;
    if (op === '<') return cmp < 0;
    if (op === '<=') return cmp <= 0;
    /** @type {string} */
    let upper;
    if (op === '~') upper = `${base.major}.${base.minor + 1}.0`;
    else if (base.major > 0) upper = `${base.major + 1}.0.0`;
    else if (base.minor > 0) upper = `0.${base.minor + 1}.0`;
    else upper = `0.0.${base.patch + 1}`;
    return cmp >= 0 && compareVersions(version, `${upper}-0`) < 0;
  });
}

// --- Checks ------------------------------------------------------------------------------------

/**
 * Problems with the declared packages: names, templates, paths, surface files, dependencies,
 * cycles and groups.
 * @param {Package[]} packages
 * @param {{ root?: string }} [options] root: also refuse a declared surface file that is missing
 * @returns {string[]}
 */
export function checkPackages(packages, { root } = {}) {
  /** @type {string[]} */
  const problems = [];
  const say = (/** @type {string} */ name, /** @type {string} */ msg) =>
    problems.push(`policy.json release.packages ${name}: ${msg}`);
  const names = new Map();
  for (const p of packages) {
    if (!PACKAGE_NAME.test(p.name)) say(p.name, 'is not a package name');
    if (names.has(p.name)) say(p.name, 'is declared twice');
    names.set(p.name, p);
    for (const m of templateProblems(p.tag)) say(p.name, m);
    for (const path of [...p.paths, ...(p.surface ? [p.surface] : [])]) {
      const r = safePath(path.replace(/\*+/g, 'x'));
      if ('error' in r) say(p.name, `path ${r.error}`);
    }
    if (p.surface && /[*?]/.test(p.surface))
      say(p.name, `surface ${p.surface} is a glob, not a file`);
    else if (p.surface && root) {
      let found = false;
      try {
        found = existsSync(insidePath(root, p.surface));
      } catch {
        found = false;
      }
      if (!found) say(p.name, `surface file ${p.surface} doesn't exist`);
    }
    if (p.surface && !p.paths.some((g) => globMatch(g, /** @type {string} */ (p.surface)))) {
      say(p.name, `surface file ${p.surface} is outside the package's paths`);
    }
    if (p.version_source && 'error' in safePath(p.version_source)) {
      say(p.name, `version_source ${p.version_source} is not a repository path`);
    }
    for (const [dep, range] of Object.entries(p.depends_on)) {
      if (dep === p.name) say(p.name, 'depends on itself');
      if (!validRange(range)) say(p.name, `depends_on ${dep}: "${range}" is not a version range`);
    }
  }
  for (const p of packages) {
    for (const dep of Object.keys(p.depends_on)) {
      if (dep !== p.name && !names.has(dep))
        say(p.name, `depends on ${dep}, which is not declared`);
    }
  }
  // Tag templates that could match the same tag.
  packages.forEach((a, i) => {
    for (const b of packages.slice(i + 1)) {
      if (a.name !== b.name && templatesOverlap(a, b)) {
        problems.push(
          `policy.json release.packages: ${a.name} (${a.tag}) and ${b.name} (${b.tag}) could match the same tag, such as ${tagFor(a, '1.0.0').length >= tagFor(b, '1.0.0').length ? tagFor(a, '1.0.0') : tagFor(b, '1.0.0')}`,
        );
      }
    }
  });
  for (const cycle of dependencyCycles(packages)) {
    problems.push(`policy.json release.packages: a dependency cycle, ${cycle.join(' → ')}`);
  }
  // A lockstep group shares one version, so its members share their channels.
  for (const [group, members] of groups(packages)) {
    const channels = new Set(members.map((m) => [...m.channels].sort().join(',')));
    if (channels.size > 1) {
      problems.push(
        `policy.json release.packages: group ${group} (${members.map((m) => m.name).join(', ')}) shares one version, so its packages need the same channels`,
      );
    }
  }
  return problems;
}

/**
 * The dependency cycles, each as the names around it, the first repeated at the end.
 * @param {Package[]} packages
 * @returns {string[][]}
 */
export function dependencyCycles(packages) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  /** @type {string[][]} */
  const cycles = [];
  /** @type {Map<string, 'open' | 'done'>} */
  const state = new Map();
  const seen = new Set();
  /** @param {string} name @param {string[]} path */
  const visit = (name, path) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'open') {
      const cycle = [...path.slice(path.indexOf(name)), name];
      const key = [...cycle.slice(0, -1)].sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(name, 'open');
    for (const dep of Object.keys(byName.get(name)?.depends_on ?? {})) {
      if (byName.has(dep)) visit(dep, [...path, name]);
    }
    state.set(name, 'done');
  };
  for (const p of packages) visit(p.name, []);
  return cycles;
}

/** The lockstep groups, by name. @param {Package[]} packages @returns {Map<string, Package[]>} */
export function groups(packages) {
  /** @type {Map<string, Package[]>} */
  const out = new Map();
  for (const p of packages) {
    if (p.group) out.set(p.group, [...(out.get(p.group) ?? []), p]);
  }
  return out;
}

/** The packages released together with one: its lockstep group, or itself. @param {Package[]} packages @param {Package} p */
export const releasedWith = (packages, p) =>
  p.group ? packages.filter((q) => q.group === p.group) : [p];

/**
 * The package a command means: the one named, or the only one declared.
 * @param {Package[]} packages @param {string | undefined} name
 * @returns {Package}
 */
export function resolvePackage(packages, name) {
  if (!packages.length) {
    throw new CodedError(
      'no-packages',
      'no release package is declared in policy.json release.packages; declare one, or run hitld release migrate to move repository-wide releases into a package named main',
    );
  }
  if (name === undefined) {
    if (packages.length === 1) return packages[0];
    throw new CodedError(
      'package-required',
      `${packages.length} release packages are declared (${packages.map((p) => p.name).join(', ')}); name one with --package`,
    );
  }
  const found = packages.find((p) => p.name === name);
  if (!found) {
    throw new CodedError(
      'unknown-package',
      `no release package named ${name}; declared: ${packages.map((p) => p.name).join(', ')}`,
    );
  }
  return found;
}

/**
 * Every package that depends on one, directly or through others, with the range it declares on
 * the package it depends on directly.
 * @param {Package[]} packages @param {string} name
 * @returns {{ package: string, depends_on: string, range: string }[]}
 */
export function dependentsOf(packages, name) {
  /** @type {{ package: string, depends_on: string, range: string }[]} */
  const out = [];
  const seen = new Set([name]);
  const queue = [name];
  while (queue.length) {
    const at = /** @type {string} */ (queue.shift());
    for (const p of packages) {
      if (seen.has(p.name) || p.depends_on[at] === undefined) continue;
      seen.add(p.name);
      out.push({ package: p.name, depends_on: at, range: p.depends_on[at] });
      queue.push(p.name);
    }
  }
  return out;
}

// --- Paths -------------------------------------------------------------------------------------

/** How specific a glob is: the length of its part before the first wildcard. @param {string} g */
export const specificity = (g) => (/[*?]/.test(g) ? g.search(/[*?]/) : g.length + 1);

/**
 * The packages that own a file: those whose paths match it, keeping only the most specific
 * match when several do.
 * @param {Package[]} packages @param {string} file
 * @returns {string[]}
 */
export function packagesOfFile(packages, file) {
  /** @type {{ name: string, score: number }[]} */
  const hits = [];
  for (const p of packages) {
    const scores = p.paths.filter((g) => globMatch(g, file)).map(specificity);
    if (scores.length) hits.push({ name: p.name, score: Math.max(...scores) });
  }
  if (!hits.length) return [];
  const best = Math.max(...hits.map((h) => h.score));
  return hits.filter((h) => h.score === best).map((h) => h.name);
}

/**
 * The packages an item belongs to, from the files it touches: the files its commits changed, or,
 * when it has none, its `touches` globs. With one package declared, every item belongs to it.
 * @param {Package[]} packages
 * @param {Iterable<string>} files the files its commits changed
 * @param {string[]} [touches] its `touches` globs
 * @returns {string[]}
 */
export function packagesOfItem(packages, files, touches = []) {
  if (packages.length === 1) return [packages[0].name];
  const out = new Set();
  let any = false;
  for (const f of files) {
    any = true;
    for (const n of packagesOfFile(packages, f)) out.add(n);
  }
  if (!any) {
    for (const t of touches) {
      const sample = t
        .replace(/\*\*\/?/g, 'x/')
        .replace(/\*/g, 'x')
        .replace(/\?/g, 'x')
        .replace(/\/$/, '/x');
      for (const n of packagesOfFile(packages, sample)) out.add(n);
    }
  }
  return packages.map((p) => p.name).filter((n) => out.has(n));
}

// --- The surface delta -------------------------------------------------------------------------

/** The lines of a surface file that count: trimmed, blank lines and # comments left out. @param {string | null} text */
export const surfaceLinesOf = (text) =>
  text === null
    ? []
    : [
        ...new Set(
          text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#')),
        ),
      ];

/**
 * The interface delta between two versions of a package's surface file (HITLD-755): each added
 * line is additive, each removed line breaking; a changed line is a removed line and an added
 * one, so it is breaking.
 * @param {string | null} before the file at the last full release (null: none)
 * @param {string | null} after the file now
 * @param {string} file the file's path, for the entries
 * @returns {import('../tracker/files/releases.mjs').DeltaEntry[]}
 */
export function surfaceDelta(before, after, file) {
  const a = surfaceLinesOf(before);
  const b = surfaceLinesOf(after);
  const had = new Set(a);
  const has = new Set(b);
  return [
    ...a
      .filter((l) => !has.has(l))
      .map((l) => ({ impact: 'breaking', surface: 'surface', what: `${file}: removed ${l}` })),
    ...b
      .filter((l) => !had.has(l))
      .map((l) => ({ impact: 'additive', surface: 'surface', what: `${file}: added ${l}` })),
  ];
}
