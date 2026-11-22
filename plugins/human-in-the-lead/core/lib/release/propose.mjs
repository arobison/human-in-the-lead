// `hitld release propose` (design parts 2.7, 3.2 and 16.5; HITLD-752): what a release of a
// package made now would be.
//
// A release is of one package (`--package`, which may be left out when exactly one is declared),
// of its lockstep group (every package in the group shares one version and is released with it),
// or of a release train (`--train`: one item that needs several packages' release items, released
// together under one owner approval).
//
// For each package it reads the interface delta from the package's committed surface file between
// the last full release and now (lines only added: minor; a removed or changed line: major, minor
// while 0.y.z; no change: patch; with no surface file declared, the interface is not measured and
// patch is proposed), drafts the notes from the changelog lines of the items closed since then
// that belong to the package (by the files they touch), lists those that changed the surface file
// without a changelog line, pins the versions of the packages it depends on, lists every package
// that depends on one with a breaking change, and lists unmet gates: every item and milestone the
// release item needs that is not done or dropped. The release item is the work item whose
// `release` key is the version and whose `package` is the package; `item` names one instead.
//
// Pre-releases. A version may carry a pre-release part under one of the package's channels
// (0.1.0-rc.1). A pre-release tag is never the base: the delta, the bump and the items are
// measured from the last full release, so every pre-release of a version, and the version
// itself, carry the same bump. `pre: 'rc'` proposes the next pre-release on that channel: each
// channel keeps its own counter per package (rc.1, rc.2, ...; beta.1, ...).

import { readFileSync } from 'node:fs';
import { CodedError } from '../cli/errors.mjs';
import { buildGraph } from '../tracker/files/graph.mjs';
import { readMilestone } from '../tracker/files/milestones.mjs';
import { git, loadPlaces, loadWorkTree } from '../tracker/files/tree.mjs';
import { insidePath } from '../tracker/files/safe.mjs';
import { recordPath, releasedInPackage } from '../tracker/files/releases.mjs';
import { proposeBump } from './delta.mjs';
import {
  dependentsOf,
  packagesOfItem,
  releasedWith,
  resolvePackage,
  satisfies,
  surfaceDelta,
  tagFor,
  versionOfTag,
} from './packages.mjs';
import { atLeast, bumpBetween, compareVersions, isPrerelease, nextPrerelease } from './semver.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../tracker/files/releases.mjs').DeltaEntry} DeltaEntry
 * @typedef {import('./packages.mjs').Package} Package
 * @typedef {import('./semver.mjs').Bump} Bump
 *
 * @typedef {{ item: string, id: string, kind: 'item' | 'milestone', title: string, state: string, check_due: boolean }} Gate
 *   check_due: a milestone whose check has not passed yet (always false for an item)
 * @typedef {{ package: string, range: string, version: string | null, satisfied: boolean }} Pin
 *   version: the version this release is built against: the one made in the same release, else
 *   the package's latest tag reachable from HEAD; null when it has none
 * @typedef {{ package: string, depends_on: string, range: string, in_range: boolean }} Dependent
 *
 * @typedef {object} PackageRelease one record `release make` writes
 * @property {string} package
 * @property {string | null} tag null when no version is named (a package with no surface file)
 * @property {string | null} version
 * @property {string | null} last_tag the package's latest tag reachable from HEAD, pre-releases included
 * @property {string | null} base the package's last full release, which its delta is measured from
 * @property {string} base_version 0.0.0 when there is no base
 * @property {string | null} surface the surface file, or null when none is declared
 * @property {DeltaEntry[]} interface_delta
 * @property {Bump | null} bump the bump the package's own delta proposes; null with no surface file
 * @property {boolean} breaking
 * @property {Pin[]} depends
 * @property {string[]} items work items closed since the base that belong to the package
 * @property {string[]} notes
 * @property {{ item: string, files: string[] }[]} missing_release_note
 * @property {string[]} milestones
 * @property {string | null} release_item
 * @property {Gate[]} gates
 * @property {string | null} package_version the version in the package's version source
 *
 * @typedef {PackageRelease & { version: string, tag: string }} NamedRelease a release whose
 *   version is named: what `release make` writes
 *
 * @typedef {object} Proposal
 * @property {string | null} package the package named (null for a train)
 * @property {string | null} group its lockstep group
 * @property {string | null} train the release train item
 * @property {string | null} last_tag
 * @property {string | null} base
 * @property {string} base_version
 * @property {boolean} first_release
 * @property {string | null} surface
 * @property {boolean} interface_measured false when the package declares no surface file
 * @property {DeltaEntry[]} interface_delta
 * @property {Bump | null} bump null when no version is proposed (a package with no surface file)
 * @property {boolean} breaking
 * @property {string} reason why this bump
 * @property {string | null} version the proposed version: null for a train (each release has its
 *   own) and for a package with no surface file, whose version the owner names with --version
 * @property {string | null} tag
 * @property {boolean} prerelease
 * @property {string} prerelease_rule how pre-releases are treated
 * @property {string[]} items
 * @property {string[]} notes
 * @property {{ item: string, files: string[] }[]} missing_release_note
 * @property {string | null} release_item
 * @property {Gate[]} gates
 * @property {string[]} milestones
 * @property {Pin[]} depends
 * @property {Dependent[]} dependents every package that depends on one released here with a breaking change
 * @property {PackageRelease[]} releases the records `release make` writes, one per package
 * @property {number} unreleased merged items of the package no full release of it lists yet
 * @property {string | null} package_version
 * @property {string[]} warnings
 */

export const PRERELEASE_RULE =
  'A pre-release tag is never the base: the delta, the bump and the items are measured from the last full release, so each pre-release of a version and the version itself carry the same bump. Each channel keeps its own counter per package.';

/**
 * A package's tags reachable from HEAD (or every tag, with all), oldest version first.
 * @param {string} root @param {Pick<Package, 'name' | 'tag'>} p @param {{ all?: boolean }} [options]
 * @returns {{ tag: string, version: string }[]}
 */
export function packageTags(root, p, { all = false } = {}) {
  return git(root, ['tag', '--list', ...(all ? [] : ['--merged', 'HEAD'])], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .flatMap((tag) => {
      const version = tag ? versionOfTag(p, tag) : null;
      return version ? [{ tag, version }] : [];
    })
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * A file's text at a ref, or null when the ref has no such regular file.
 * @param {string} root @param {string} ref @param {string} path
 */
export function fileAt(root, ref, path) {
  const entry = git(root, ['ls-tree', '-z', ref, '--', path], { allowFail: true });
  const m = /^(\d+) blob ([0-9a-f]+)\t/.exec(entry);
  if (!m || (m[1] !== '100644' && m[1] !== '100755')) return null;
  return git(root, ['cat-file', 'blob', m[2]], { allowFail: true });
}

/** A file's text in the working tree, or null. @param {string} root @param {string} path */
function fileNow(root, path) {
  try {
    return readFileSync(insidePath(root, path), 'utf8');
  } catch {
    return null;
  }
}

/**
 * The files each work item's commits changed, from their Work-Item trailers.
 * @param {string} root @param {string | null} [since] a tag: only commits after it
 * @returns {Map<string, Set<string>>}
 */
export function itemFiles(root, since = null) {
  const log = git(
    root,
    [
      'log',
      '--format=%x1e%(trailers:key=Work-Item,valueonly,separator=%x2C)',
      '--name-only',
      since ? `refs/tags/${since}..HEAD` : 'HEAD',
    ],
    { allowFail: true },
  );
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const rec of log.split('\x1e').filter((r) => r.trim())) {
    const [head, ...files] = rec.split('\n');
    const touched = files.map((f) => f.trim()).filter(Boolean);
    for (const id of head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const set = out.get(id) ?? new Set();
      touched.forEach((f) => set.add(f));
      out.set(id, set);
    }
  }
  return out;
}

/**
 * The version in a package's version source: the `version` key of a JSON file at HEAD.
 * @param {string} root @param {Package} p
 */
function sourceVersion(root, p) {
  if (!p.version_source) return null;
  const text = fileAt(root, 'HEAD', p.version_source);
  if (text === null) return null;
  try {
    const v = JSON.parse(text).version;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** The highest of some bumps. @param {Bump[]} bumps @returns {Bump} */
const highest = (bumps) =>
  bumps.reduce((a, b) => (atLeast(a, b) ? a : b), /** @type {Bump} */ ('patch'));

/**
 * What one tracker read shares across the packages of one proposal.
 * @param {FilesTracker} t
 */
function context(t) {
  const root = t.root();
  const layout = t.layout();
  const packages = layout.packages ?? [];
  const entries = loadWorkTree(root, layout);
  const g = buildGraph(entries);
  const records = t.releases();
  /** @type {Map<string, Map<string, Set<string>>>} */
  const filesSince = new Map();
  /** @param {string | null} since */
  const files = (since) => {
    const key = since ?? '';
    if (!filesSince.has(key)) filesSince.set(key, itemFiles(root, since));
    return /** @type {Map<string, Set<string>>} */ (filesSince.get(key));
  };
  return { t, root, layout, packages, g, records, files };
}

/** @typedef {ReturnType<typeof context>} Context */

/**
 * The release item for a package and version: the work item whose `release` is the version and
 * whose `package` is the package (or none, when one package is declared).
 * @param {Context} ctx @param {Package} p @param {string} version
 */
function releaseItemFor(ctx, p, version) {
  const only = ctx.packages.length === 1;
  return ctx.g.items.find(
    (it) =>
      it.data.kind === 'work' &&
      it.data.release === version &&
      (it.data.package === p.name || (it.data.package === undefined && only)),
  );
}

/**
 * The gates of release items: what each needs that is not done or dropped. Without a release
 * item, the milestones the open items that need one wait for.
 * @param {Context} ctx @param {any[]} chosen @param {{ skip?: Set<string> }} [options]
 *   skip: needs that are not gates (a train's own release items)
 * @returns {Gate[]}
 */
function gatesOf(ctx, chosen, { skip = new Set() } = {}) {
  const { g, t } = ctx;
  const releaseItems = chosen.length
    ? chosen
    : g.items.filter(
        (it) =>
          it.data.release === undefined &&
          g.isOpen(it) &&
          g.needs(it).some((n) => g.get(n) && g.isMilestone(/** @type {any} */ (g.get(n)))),
      );
  return releaseItems.flatMap((it) =>
    g
      .needs(it)
      .filter((n) => !skip.has(n))
      .map((n) => g.get(n))
      .filter(
        (n) => n && (g.isMilestone(n) ? n.data.state !== 'done' : chosen.length > 0 && g.isOpen(n)),
      )
      .map((n) => {
        const need = /** @type {NonNullable<typeof n>} */ (n);
        const milestone = g.isMilestone(need);
        return {
          item: String(it.data.id),
          id: String(need.data.id),
          kind: /** @type {'item' | 'milestone'} */ (milestone ? 'milestone' : 'item'),
          title: String(need.data.title),
          state: String(need.data.state),
          check_due: milestone && t.get(String(need.data.id)).check_due === true,
        };
      }),
  );
}

/**
 * Measure one package: its tags, base, delta, items, notes and milestones since its base.
 * @param {Context} ctx @param {Package} p @param {string[]} warnings
 */
function measure(ctx, p, warnings) {
  const { root, layout, packages, g, records } = ctx;
  const tags = packageTags(root, p);
  const last = tags.at(-1) ?? null;
  const base = [...tags].reverse().find((x) => !isPrerelease(x.version)) ?? null;

  /** @type {DeltaEntry[]} */
  let delta = [];
  if (p.surface) {
    const before = base ? fileAt(root, `refs/tags/${base.tag}`, p.surface) : null;
    if (base && before === null) {
      warnings.push(
        `${p.name}: ${base.tag} has no ${p.surface}, so its interface is taken as empty`,
      );
    }
    const after = fileNow(root, p.surface);
    if (after === null) warnings.push(`${p.name}: the surface file ${p.surface} is missing`);
    delta = surfaceDelta(before, after, p.surface);
  } else {
    warnings.push(
      `${p.name} declares no surface file, so its interface is not measured and no version is proposed; the owner names it with --version (a patch included)`,
    );
  }

  // Items closed since the base that belong to the package: Done now, not Done at the base, not
  // in a full release of the package, and touching its files.
  const released = releasedInPackage(records, p.name);
  const doneAtBase = new Set(
    base
      ? loadPlaces(root, layout, [{ where: base.tag, ref: `refs/tags/${base.tag}` }])[0]
          .items.filter((e) => e.data?.state === 'done')
          .map((e) => String(e.data?.id))
      : [],
  );
  const allFiles = ctx.files(null);
  /** @type {Set<string>} */
  const unplaced = new Set();
  /** @param {any} it */
  const belongs = (it) => {
    // A release item names its package; any other item belongs by the files it touches.
    if (it.data.package !== undefined) return it.data.package === p.name;
    const id = String(it.data.id);
    const touches = Array.isArray(it.data.touches) ? it.data.touches.map(String) : [];
    const files = allFiles.get(id) ?? new Set();
    const owners = packagesOfItem(packages, files, touches);
    if (!owners.length && !files.size && !touches.length) unplaced.add(id);
    return owners.includes(p.name);
  };
  const doneHere = g.items.filter((it) => it.data.kind === 'work' && it.data.state === 'done');
  const items = doneHere
    .filter(
      (it) =>
        !doneAtBase.has(String(it.data.id)) && !released.has(String(it.data.id)) && belongs(it),
    )
    .map((it) => String(it.data.id));
  if (unplaced.size) {
    const ids = [...unplaced];
    warnings.push(
      `${p.name}: ${ids.length} done item(s) touch no file and list no touches, so they belong to no package: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', ...' : ''}`,
    );
  }
  const notes = items.flatMap((id) => {
    const d = g.get(id)?.data;
    if (!d?.release_note) return [];
    const credit =
      Array.isArray(d.credit) && d.credit.length ? `, thanks ${d.credit.join(', ')}` : '';
    return [`${d.release_note} (${id}${credit})`];
  });
  const since = ctx.files(base?.tag ?? null);
  const missing = p.surface
    ? items
        .filter((id) => since.get(id)?.has(/** @type {string} */ (p.surface)))
        .filter((id) => !g.get(id)?.data.release_note)
        .map((id) => ({ item: id, files: [/** @type {string} */ (p.surface)] }))
    : [];
  const recorded = new Set(
    records
      .filter((r) => r.package === p.name)
      .flatMap((r) => (Array.isArray(r.data?.milestones) ? r.data.milestones : [])),
  );
  const milestones = g.milestones
    .filter((m) => m.data.state === 'done' && !recorded.has(String(m.data.id)))
    .filter(
      (m) => m.data.package === p.name || (m.data.package === undefined && packages.length === 1),
    )
    .filter((m) => readMilestone(m.data).results.length > 0)
    .map((m) => String(m.data.id));
  const unreleased = doneHere.filter(
    (it) => !released.has(String(it.data.id)) && belongs(it),
  ).length;
  return {
    p,
    tags,
    last_tag: last?.tag ?? null,
    base: base?.tag ?? null,
    base_version: base?.version ?? '0.0.0',
    delta,
    items,
    notes,
    missing,
    milestones,
    unreleased,
  };
}

/** @typedef {ReturnType<typeof measure>} Measured */

/**
 * The pins for a package's dependencies.
 * @param {Context} ctx @param {Package} p @param {Map<string, string>} making versions made in
 *   this release, by package
 * @returns {Pin[]}
 */
function pinsOf(ctx, p, making) {
  return Object.entries(p.depends_on).map(([dep, range]) => {
    const q = ctx.packages.find((x) => x.name === dep);
    const version =
      making.get(dep) ?? (q ? (packageTags(ctx.root, q).at(-1)?.version ?? null) : null);
    return {
      package: dep,
      range,
      version,
      satisfied: version !== null && satisfies(version, range),
    };
  });
}

/**
 * Everything that depends on a package released here with a breaking change, outside this
 * release, with whether the new version is inside the range it declares.
 * @param {Context} ctx @param {PackageRelease[]} releases
 * @returns {Dependent[]}
 */
function dependentsFor(ctx, releases) {
  const here = new Set(releases.map((r) => r.package));
  /** @type {Dependent[]} */
  const out = [];
  const seen = new Set();
  for (const r of releases.filter((x) => x.breaking)) {
    for (const d of dependentsOf(ctx.packages, r.package)) {
      if (here.has(d.package) || seen.has(d.package)) continue;
      seen.add(d.package);
      const made = releases.find((x) => x.package === d.depends_on)?.version;
      out.push({ ...d, in_range: typeof made === 'string' ? satisfies(made, d.range) : true });
    }
  }
  return out;
}

/**
 * The releases of one unit (a package, or its lockstep group) at one version.
 * @param {Context} ctx @param {Measured[]} parts
 * @param {string | null} version null: none named yet (a package with no surface file)
 * @param {{ named?: Package, item?: string, making?: Map<string, string>, warnings: string[] }} options
 * @returns {PackageRelease[]}
 */
function releasesOf(ctx, parts, version, { named, item, making = new Map(), warnings }) {
  const { g } = ctx;
  const versions = new Map(making);
  if (version !== null) for (const m of parts) versions.set(m.p.name, version);
  return parts.map((m) => {
    // The release item: --item names one for the named package; else the one for this package
    // and version.
    let chosen = null;
    if (item !== undefined && m.p === named) {
      const it = g.items.find((x) => x.data.id === item);
      if (!it) warnings.push(`${item} is not an item in the tracker`);
      const own = it?.data.release;
      if (own !== undefined && version !== null && own !== version) {
        throw new CodedError(
          'release-item-mismatch',
          `${item} is the release item for ${own}, but this release is ${version}; name an item whose release is ${version}, or none`,
        );
      }
      const pkg = it?.data.package;
      if (own !== undefined && pkg !== undefined && pkg !== m.p.name) {
        throw new CodedError(
          'release-item-mismatch',
          `${item} is the release item for ${pkg}, but this release is of ${m.p.name}`,
        );
      }
      chosen = it ?? null;
    } else {
      chosen = version === null ? null : (releaseItemFor(ctx, m.p, version) ?? null);
    }
    const bump = m.p.surface ? proposeBump(m.delta, m.base_version) : null;
    return {
      package: m.p.name,
      tag: version === null ? null : tagFor(m.p, version),
      version,
      last_tag: m.last_tag,
      base: m.base,
      base_version: m.base_version,
      surface: m.p.surface,
      interface_delta: m.delta,
      bump: bump?.bump ?? null,
      breaking: bump?.breaking ?? false,
      depends: pinsOf(ctx, m.p, versions),
      items: m.items,
      notes: m.notes,
      missing_release_note: m.missing,
      milestones: m.milestones,
      release_item: chosen ? String(chosen.data.id) : null,
      gates: chosen ? gatesOf(ctx, [chosen]) : [],
      package_version: sourceVersion(ctx.root, m.p),
    };
  });
}

/**
 * Propose a release of a package (with its lockstep group), or of a release train.
 * @param {FilesTracker} t
 * @param {{ package?: string, pre?: string, item?: string, version?: string, train?: string }} [options]
 *   package: the package (default: the only one declared); pre: a channel such as rc; item: the
 *   release item whose gates count; version: the version being made, which finds the release
 *   item (default: the proposed version); train: a release train item, released together
 * @returns {Promise<Proposal>}
 */
export async function proposeRelease(t, { package: name, pre, item, version: making, train } = {}) {
  const ctx = context(t);
  /** @type {string[]} */
  const warnings = [];
  if (train !== undefined) return proposeTrain(ctx, train, warnings);
  const p = resolvePackage(ctx.packages, name);
  if (pre !== undefined && !p.channels.includes(pre)) {
    throw new Error(
      `${pre} is not a pre-release channel of ${p.name} (its channels: ${p.channels.join(', ')})`,
    );
  }
  const unit = releasedWith(ctx.packages, p);
  const parts = unit.map((q) => measure(ctx, q, warnings));
  // A lockstep group shares one version: the highest base, and the highest bump of any member.
  const baseVersion = parts
    .map((m) => m.base_version)
    .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
  if (new Set(parts.map((m) => m.base_version)).size > 1) {
    warnings.push(
      `group ${p.group}'s packages were last released at different versions (${parts.map((m) => `${m.p.name} ${m.base_version}`).join(', ')}); they share ${baseVersion} from now on`,
    );
  }
  const delta = parts.flatMap((m) => m.delta);
  // A package with no surface file has no measured interface, so no version is proposed: the
  // owner names it with --version, a patch included (HITLD-752, Q39). A lockstep group with such
  // a package shares that.
  const measured = unit.every((q) => q.surface !== null);
  const proposed = proposeBump(delta, baseVersion);
  const allVersions = parts.flatMap((m) =>
    packageTags(ctx.root, m.p, { all: true }).map((x) => x.version),
  );
  const version = !measured
    ? null
    : pre
      ? nextPrerelease(proposed.version, pre, allVersions)
      : proposed.version;
  const releases = releasesOf(ctx, parts, making ?? version, { named: p, item, warnings });
  // Without a release item, the milestones the open items that need one wait for.
  const own = /** @type {PackageRelease} */ (releases.find((r) => r.package === p.name));
  const chosen = releases.filter((r) => r.release_item !== null);
  const gates = chosen.length
    ? releases.flatMap((r) => r.gates)
    : ctx.packages.length === 1
      ? gatesOf(ctx, [])
      : [];
  for (const r of releases) {
    if (version !== null && r.package_version !== null && r.package_version !== version) {
      const src = /** @type {Package} */ (unit.find((q) => q.name === r.package)).version_source;
      warnings.push(
        `${src} says ${r.package_version}; set it to ${version} before ${r.package} is released`,
      );
    }
    for (const pin of r.depends) {
      if (pin.version === null) {
        warnings.push(
          `${r.package} depends on ${pin.package} (${pin.range}), which has no release yet`,
        );
      } else if (!pin.satisfied) {
        warnings.push(
          `${r.package} depends on ${pin.package} ${pin.range}, but ${pin.package} is at ${pin.version}`,
        );
      }
    }
  }
  const first = own.base === null;
  const unmeasured = unit.filter((q) => q.surface === null).map((q) => q.name);
  const reason = !measured
    ? `${unmeasured.join(', ')} declare${unmeasured.length === 1 ? 's' : ''} no surface file, so no version is proposed: name it with --version (a patch included)${own.base ? `, above ${own.base}` : ''}`
    : own.base
      ? `${proposed.reason}, since ${own.base}`
      : `no release of ${p.name} yet, so its whole surface is new, counted from 0.0.0: ${proposed.reason}`;
  return {
    package: p.name,
    group: p.group,
    train: null,
    last_tag: own.last_tag,
    base: own.base,
    base_version: baseVersion,
    first_release: first,
    surface: p.surface,
    interface_measured: measured,
    interface_delta: delta,
    bump: measured ? proposed.bump : null,
    breaking: measured && proposed.breaking,
    reason: unit.length > 1 ? `group ${p.group}: ${reason}` : reason,
    version,
    tag: version === null ? null : tagFor(p, version),
    prerelease: version !== null && isPrerelease(version),
    prerelease_rule: PRERELEASE_RULE,
    items: [...new Set(releases.flatMap((r) => r.items))],
    notes: [...new Set(releases.flatMap((r) => r.notes))],
    missing_release_note: releases.flatMap((r) => r.missing_release_note),
    release_item: own.release_item ?? chosen[0]?.release_item ?? null,
    gates,
    milestones: [...new Set(releases.flatMap((r) => r.milestones))],
    depends: own.depends,
    dependents: dependentsFor(ctx, releases),
    releases,
    unreleased: parts.reduce((n, m) => n + m.unreleased, 0),
    package_version: own.package_version,
    warnings,
  };
}

/**
 * Propose a release train: the item names, in its needs, the release items of several packages;
 * each is released at its own version, together, in one approval.
 * @param {Context} ctx @param {string} id @param {string[]} warnings
 * @returns {Proposal}
 */
function proposeTrain(ctx, id, warnings) {
  const { g, packages } = ctx;
  const train = g.get(id);
  if (!train || train.data.kind !== 'work') {
    throw new CodedError('not-a-train', `${id} is not a work item in the tracker`);
  }
  const needed = g
    .needs(train)
    .map((n) => g.get(n))
    .filter((n) => n && n.data.kind === 'work' && typeof n.data.release === 'string');
  /** @type {Map<string, { item: any, version: string }>} */
  const byPackage = new Map();
  for (const n of needed) {
    const it = /** @type {any} */ (n);
    const p = resolvePackage(
      packages,
      it.data.package === undefined ? undefined : String(it.data.package),
    );
    for (const q of releasedWith(packages, p)) {
      if (byPackage.has(q.name) && byPackage.get(q.name)?.version !== it.data.release) {
        throw new Error(
          `${id} needs two releases of ${q.name}: ${byPackage.get(q.name)?.version} and ${it.data.release}`,
        );
      }
      byPackage.set(q.name, { item: it, version: String(it.data.release) });
    }
  }
  const units = new Set(
    [...byPackage.keys()].map((n) => {
      const p = /** @type {Package} */ (packages.find((x) => x.name === n));
      return p.group ? `group:${p.group}` : n;
    }),
  );
  if (units.size < 2) {
    throw new CodedError(
      'not-a-train',
      `${id} needs the release items of ${units.size ? [...byPackage.keys()].join(', ') : 'no package'}; a release train needs the release items of two packages or groups or more`,
    );
  }
  const making = new Map([...byPackage].map(([n, x]) => [n, x.version]));
  /** @type {NamedRelease[]} */
  const releases = [];
  for (const [n, { item, version }] of byPackage) {
    const p = /** @type {Package} */ (packages.find((x) => x.name === n));
    const [r] = releasesOf(ctx, [measure(ctx, p, warnings)], version, {
      named: p,
      item: String(item.data.id),
      making,
      warnings,
    });
    releases.push(/** @type {NamedRelease} */ (r));
  }
  const trainGates = gatesOf(ctx, [train], {
    skip: new Set(needed.map((n) => String(/** @type {any} */ (n).data.id))),
  });
  const gates = [...releases.flatMap((r) => r.gates), ...trainGates];
  for (const r of releases) {
    for (const pin of r.depends) {
      if (!pin.satisfied) {
        warnings.push(
          `${r.package} depends on ${pin.package} ${pin.range}, but ${pin.package} is ${pin.version === null ? 'not released' : `at ${pin.version}`}`,
        );
      }
    }
    const proposed = proposeBump(r.interface_delta, r.base_version);
    if (r.surface && !atLeast(bumpBetween(r.base_version, r.version) ?? 'patch', proposed.bump)) {
      warnings.push(
        `${r.package} ${r.version} is below what its delta proposes (${proposed.version}, ${proposed.reason})`,
      );
    }
  }
  const delta = releases.flatMap((r) => r.interface_delta);
  const bump = highest(
    releases.map((r) => r.bump ?? bumpBetween(r.base_version, r.version) ?? 'patch'),
  );
  return {
    package: null,
    group: null,
    train: id,
    last_tag: null,
    base: null,
    base_version: '0.0.0',
    first_release: releases.every((r) => r.base === null),
    surface: null,
    interface_measured: releases.every((r) => r.surface !== null),
    interface_delta: delta,
    bump,
    breaking: releases.some((r) => r.breaking),
    reason: `release train ${id}: ${releases.map((r) => `${r.package} ${r.version} (${r.bump})`).join(', ')}`,
    version: null,
    tag: null,
    prerelease: releases.every((r) => isPrerelease(r.version)),
    prerelease_rule: PRERELEASE_RULE,
    items: [...new Set(releases.flatMap((r) => r.items))],
    notes: [...new Set(releases.flatMap((r) => r.notes))],
    missing_release_note: releases.flatMap((r) => r.missing_release_note),
    release_item: id,
    gates,
    milestones: [...new Set(releases.flatMap((r) => r.milestones))],
    depends: [],
    dependents: dependentsFor(ctx, releases),
    releases,
    unreleased: 0,
    package_version: null,
    warnings,
  };
}

/** Where make writes each record. @param {FilesTracker} t @param {PackageRelease} r */
export const recordFor = (t, r) => recordPath(t.layout(), r.package, String(r.version));
