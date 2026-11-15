// `hitld release propose` (design parts 2.7, 3.2 and 16.5): what a release made now would be.
//
// It reads the interface delta since the last full release and proposes the bump from that delta
// alone, drafts the notes from the released items' changelog lines, lists the items that changed
// public surface without a changelog line, and lists unmet gates: every item and milestone the
// release item needs that is not done or dropped. The release item is the work item whose `release`
// key is the version being proposed or made (design 3.2); `item` names one instead and overrides
// it, but its `release` key, when it has one, must be that version.
//
// Pre-releases. A version may carry a pre-release part (0.1.0-rc.1, tag v0.1.0-rc.1). A
// pre-release tag is never the base: the delta, the bump and the items are measured from the last
// full release, so every pre-release of a version, and the version itself, carry the same bump.
// `pre: 'rc'` proposes the next pre-release of the proposed version (rc.1, then rc.2, ...).
//
// With no release tag yet, there is no base: every part of the public interface is new, so the
// whole surface counts as additive and the bump is measured from 0.0.0.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildGraph } from '../tracker/files/graph.mjs';
import { readMilestone } from '../tracker/files/milestones.mjs';
import { git, loadPlaces, loadWorkTree, readBlobs } from '../tracker/files/tree.mjs';
import { releasedIn } from '../tracker/files/releases.mjs';
import { diffSurface, emptySurface, proposeBump } from './delta.mjs';
import { SURFACE_PATHS, surfaceOf } from './surface.mjs';
import { TAG, compareVersions, isPrerelease, nextPrerelease } from './semver.mjs';

/**
 * @typedef {import('./surface.mjs').Surface} Surface
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../tracker/files/releases.mjs').DeltaEntry} DeltaEntry
 *
 * @typedef {{ item: string, id: string, kind: 'item' | 'milestone', title: string, state: string, check_due: boolean }} Gate
 *   check_due: a milestone whose check has not passed yet (always false for an item)
 *
 * @typedef {object} Proposal
 * @property {string | null} last_tag the latest release tag reachable from HEAD, pre-releases included
 * @property {string | null} base the last full release, which the delta is measured from
 * @property {string} base_version 0.0.0 when there is no base
 * @property {boolean} first_release true when there is no base: everything public is the initial surface
 * @property {DeltaEntry[]} interface_delta
 * @property {'major' | 'minor' | 'patch'} bump
 * @property {boolean} breaking
 * @property {string} reason why this bump
 * @property {string} version the proposed version
 * @property {string} tag
 * @property {boolean} prerelease
 * @property {string} prerelease_rule how pre-releases are treated
 * @property {string[]} items work items closed since the base, not yet in a full release
 * @property {string[]} notes draft release notes from those items' changelog lines
 * @property {{ item: string, files: string[] }[]} missing_release_note items that changed public surface without a changelog line
 * @property {string | null} release_item the release item whose gates count: the item `--item` names, else the one whose `release` is this version, else null
 * @property {Gate[]} gates what the release item needs that is not done or dropped; with no release item, the milestones the open items that need one wait for
 * @property {string[]} milestones milestones Done since the base, for the record
 * @property {number} unreleased merged items no full release lists yet
 * @property {string | null} package_version the version in package.json, when there is one
 * @property {string[]} warnings
 */

export const PRERELEASE_RULE =
  'A pre-release tag is never the base: the delta, the bump and the items are measured from the last full release, so each pre-release of a version and the version itself carry the same bump.';

/**
 * The release tags reachable from HEAD, oldest version first.
 * @param {string} root @returns {string[]}
 */
export function releaseTags(root) {
  return git(root, ['tag', '--list', 'v*', '--merged', 'HEAD'], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => TAG.test(t))
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));
}

/** Every release tag in the repository. @param {string} root */
const allTags = (root) =>
  git(root, ['tag', '--list', 'v*'], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => TAG.test(t));

/**
 * The surface at a tag: the tag's own files, extracted from git into a temporary directory, read
 * by the tag's own copy of surface.mjs. Null when the tag has no surface reader.
 * @param {string} root @param {string} tag
 * @returns {Surface | null}
 */
export function surfaceAt(root, tag) {
  const listing = git(
    root,
    [
      'ls-tree',
      '-r',
      '-z',
      `refs/tags/${tag}`,
      '--',
      'core',
      'schemas',
      'templates',
      'package.json',
    ],
    {
      allowFail: true,
    },
  );
  /** @type {{ sha: string, path: string }[]} */
  const blobs = [];
  for (const rec of listing.split('\0').filter(Boolean)) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/s.exec(rec);
    // Regular files only: never a link, never a submodule.
    if (m && (m[1] === '100644' || m[1] === '100755') && !m[3].split('/').includes('..')) {
      blobs.push({ sha: m[2], path: m[3] });
    }
  }
  if (!blobs.some((b) => b.path === 'core/lib/release/surface.mjs')) return null;
  const dir = mkdtempSync(join(tmpdir(), 'hitld-surface-'));
  try {
    const texts = readBlobs(root, [...new Set(blobs.map((b) => b.sha))]);
    for (const b of blobs) {
      const full = join(dir, b.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, texts.get(b.sha) ?? '');
    }
    // Trust boundary: runs this repository's own code as it was at one of its release tags.
    const out = execFileSync(process.execPath, [join(dir, 'core/lib/release/surface.mjs'), dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1 << 26,
    });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Commits since the base, with the work items their trailers name and the surface files they
 * touch.
 * @param {string} root @param {string | null} base
 * @returns {Map<string, Set<string>>} item ID to the surface files its commits touched
 */
function surfaceTouches(root, base) {
  const log = git(
    root,
    [
      'log',
      '--format=%x1e%(trailers:key=Work-Item,valueonly,separator=%x2C)',
      '--name-only',
      base ? `refs/tags/${base}..HEAD` : 'HEAD',
    ],
    { allowFail: true },
  );
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const rec of log.split('\x1e').filter((r) => r.trim())) {
    const [head, ...files] = rec.split('\n');
    const touched = files.filter((f) => SURFACE_PATHS.some((p) => f === p || f.startsWith(p)));
    if (!touched.length) continue;
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
 * Propose a release.
 * @param {FilesTracker} t
 * @param {{ pre?: string, item?: string, version?: string, surfaceOfBase?: (tag: string) => Surface | null }} [options]
 *   pre: a pre-release label such as rc; item: the release item whose gates count (default: the
 *   work item whose `release` is the version, else every open work item without a `release` that
 *   needs a milestone); version: the version being made, which finds the release item (default:
 *   the proposed version)
 * @returns {Promise<Proposal>}
 */
export async function proposeRelease(t, { pre, item, version: making, surfaceOfBase } = {}) {
  const root = t.root();
  const layout = t.layout();
  const tags = releaseTags(root);
  const lastTag = tags.at(-1) ?? null;
  const base = [...tags].reverse().find((tag) => !isPrerelease(tag.slice(1))) ?? null;
  const baseVersion = base ? base.slice(1) : '0.0.0';
  /** @type {string[]} */
  const warnings = [];

  let before = emptySurface();
  if (base) {
    const read = (surfaceOfBase ?? ((tag) => surfaceAt(root, tag)))(base);
    if (read) before = read;
    else warnings.push(`${base} has no surface reader, so its interface is taken as empty`);
  }
  const after = await surfaceOf(root);
  const delta = diffSurface(before, after);
  const proposed = proposeBump(delta, baseVersion);
  const version = pre ? nextPrerelease(proposed.version, pre, allTags(root)) : proposed.version;

  // Items closed since the base: Done now, and not Done at the base.
  const entries = loadWorkTree(root, layout);
  const g = buildGraph(entries);
  const records = t.releases();
  const released = releasedIn(records);
  const doneAtBase = new Set(
    base
      ? loadPlaces(root, layout, [{ where: base, ref: `refs/tags/${base}` }])[0]
          .items.filter((e) => e.data?.state === 'done')
          .map((e) => String(e.data?.id))
      : [],
  );
  const items = g.items
    .filter(
      (it) =>
        it.data.kind === 'work' &&
        it.data.state === 'done' &&
        !doneAtBase.has(String(it.data.id)) &&
        !released.has(String(it.data.id)),
    )
    .map((it) => String(it.data.id));
  const notes = items.flatMap((id) => {
    const d = g.get(id)?.data;
    if (!d?.release_note) return [];
    const credit =
      Array.isArray(d.credit) && d.credit.length ? `, thanks ${d.credit.join(', ')}` : '';
    return [`${d.release_note} (${id}${credit})`];
  });
  const touches = surfaceTouches(root, base);
  const missing = items
    .filter((id) => touches.has(id) && !g.get(id)?.data.release_note)
    .map((id) => ({ item: id, files: [...(touches.get(id) ?? [])].sort() }));

  // The release item: named by --item, else the work item whose `release` is this version.
  const lookup = making ?? version;
  const named = item ? g.items.filter((it) => it.data.id === item) : [];
  const found = g.items.filter((it) => it.data.kind === 'work' && it.data.release === lookup);
  if (item && !named.length) warnings.push(`${item} is not an item in the tracker`);
  const own = named[0]?.data.release;
  if (own !== undefined && own !== lookup) {
    throw new Error(
      `${item} is the release item for ${own}, but this release is ${lookup}; name an item whose release is ${lookup}, or none`,
    );
  }
  const chosen = item ? named : found.slice(0, 1);
  // Gates: what the release item needs that is not done or dropped; without one, the milestones
  // the open items that need one wait for.
  const releaseItems = chosen.length
    ? chosen
    : g.items.filter(
        (it) =>
          it.data.release === undefined &&
          g.isOpen(it) &&
          g.needs(it).some((n) => g.get(n) && g.isMilestone(/** @type {any} */ (g.get(n)))),
      );
  /** @type {Gate[]} */
  const gates = releaseItems.flatMap((it) =>
    g
      .needs(it)
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
  const recorded = new Set(
    records.flatMap((r) => (Array.isArray(r.data?.milestones) ? r.data.milestones : [])),
  );
  const milestones = g.milestones
    .filter((m) => m.data.state === 'done' && !recorded.has(String(m.data.id)))
    .filter((m) => readMilestone(m.data).results.length > 0)
    .map((m) => String(m.data.id));
  const unreleased = g.items.filter(
    (it) =>
      it.data.kind === 'work' && it.data.state === 'done' && !released.has(String(it.data.id)),
  ).length;

  let packageVersion = null;
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try {
      packageVersion =
        String(
          JSON.parse(
            execFileSync('git', ['show', 'HEAD:package.json'], {
              cwd: root,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            }),
          ).version ?? '',
        ) || null;
    } catch {
      packageVersion = null;
    }
  }
  if (packageVersion !== null && packageVersion !== version) {
    warnings.push(
      `package.json says ${packageVersion}; set it to ${version} before the release is made`,
    );
  }
  return {
    last_tag: lastTag,
    base,
    base_version: baseVersion,
    first_release: base === null,
    interface_delta: delta,
    bump: proposed.bump,
    breaking: proposed.breaking,
    reason: base
      ? `${proposed.reason}, since ${base}`
      : `no release tag yet, so the whole public interface is the initial surface, counted as additive from 0.0.0: ${proposed.reason}`,
    version,
    tag: `v${version}`,
    prerelease: isPrerelease(version),
    prerelease_rule: PRERELEASE_RULE,
    items,
    notes,
    missing_release_note: missing,
    release_item: chosen.length ? String(chosen[0].data.id) : null,
    gates,
    milestones,
    unreleased,
    package_version: packageVersion,
    warnings,
  };
}
