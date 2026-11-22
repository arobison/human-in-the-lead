// `hitld release make` (design parts 2.7, 3.2 and 16.5; HITLD-752): write the release records of
// a package (with its lockstep group) or of a release train, and either tag them on main or put
// them on a release branch for a release pull request.
//
// Minor and major releases are the owner's (a one-way door for the public interface), so the
// command line refuses this outside the owner's own turn, as it refuses decision answers
// (core/lib/cli/commands/release.mjs). Here: the release is made from the main branch, from a
// clean working tree, at the proposed version or above it (never below what the delta proposes),
// only when the release item's gates are met, and only when every package it depends on is at a
// version inside the range it declares. Each record goes to <work dir>/releases/<package>/
// <version>.md and pins the exact versions of the packages it depends on; all of one release go
// in one commit, so a lockstep group or a train is one owner approval. Nothing is pushed.
//
// Two ways (design 16.5):
//   on main    the commit lands on main and an annotated tag marks each record, for a person at a
//              terminal who then pushes them.
//   --branch   the commit goes on a new branch made from main, and main is checked out again;
//              nothing is tagged. Squash-merging the release pull request, with the owner's
//              sign-off, is the release decision; the release workflow tags that squash commit
//              once the owner approves the run (core/lib/release/check.mjs). The workflow tags
//              one record, so a release of several packages is made on main.

import { existsSync, rmSync } from 'node:fs';
import { CodedError } from '../cli/errors.mjs';
import { renderItem } from '../tracker/files/frontmatter.mjs';
import { RELEASE_KEYS, formatDeltaEntry, packageReleasesDir } from '../tracker/files/releases.mjs';
import { createExclusive, insidePath, mkdirInside } from '../tracker/files/safe.mjs';
import { git } from '../tracker/files/tree.mjs';
import { proposeRelease, recordFor } from './propose.mjs';
import { SEMVER, atLeast, bumpBetween, bumpVersion, coreOf, isPrerelease } from './semver.mjs';
import { proposeBump } from './delta.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../tracker/files/config.mjs').Layout} Layout
 * @typedef {import('./propose.mjs').Proposal} Proposal
 * @typedef {import('./propose.mjs').PackageRelease} PackageRelease
 */

/**
 * Make a release.
 * @param {FilesTracker} t
 * @param {{ package?: string, version?: string, pre?: string, decision?: string, item?: string, branch?: string, train?: string }} options
 *   package: the package (default: the only one declared); version: the version to make (default:
 *   the proposed one); pre: a pre-release channel, such as rc; decision: the decision or precedent
 *   it is made under (default owner); item: the release item whose gates must be met; branch: put
 *   the record on this new branch, made from main, and tag nothing; train: a release train item,
 *   whose packages' releases are made together at their release items' versions
 */
export async function makeRelease(
  t,
  { package: name, version, pre, decision = 'owner', item, branch: onto, train } = {},
) {
  const root = t.root();
  const layout = t.layout();
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true }).trim();
  if (branch !== layout.mainBranch) {
    throw new Error(
      `a release is made on ${layout.mainBranch} (this is ${branch || 'a detached HEAD'})`,
    );
  }
  if (git(root, ['status', '--porcelain']).trim()) {
    throw new Error(
      'the working tree has uncommitted changes; a release is made from a clean tree, so the tag marks what was reviewed',
    );
  }
  if (!/^(owner|[A-Z][A-Z0-9]*-[1-9]\d*)$/.test(decision)) {
    throw new Error('--decision is owner, a decision ID or a precedent ID (such as P-3)');
  }
  if (version !== undefined && pre !== undefined)
    throw new Error('give --version or --pre, not both');
  if (
    train !== undefined &&
    (name !== undefined || version !== undefined || pre !== undefined || item !== undefined)
  ) {
    throw new Error(
      "--train releases each package at its release item's version; give no --package, --version, --pre or --item with it",
    );
  }
  if (onto !== undefined) checkNewBranch(root, onto, layout.mainBranch);
  const p = await proposeRelease(t, { package: name, pre, item, version, train });
  if (train === undefined && version === undefined && p.version === null) {
    // No surface file: no version is proposed, so the owner names it (HITLD-752, Q39).
    throw new Error(
      `${p.reason}; give --version, such as ${p.base ? bumpVersion(p.base_version, 'patch') : '0.1.0'}${pre !== undefined ? ` (or ${p.base ? bumpVersion(p.base_version, 'patch') : '0.1.0'}-${pre}.1 for a pre-release)` : ''}`,
    );
  }
  const made = train === undefined ? (version ?? /** @type {string} */ (p.version)) : null;
  if (made !== null && !SEMVER.test(made)) throw new Error(`"${made}" is not a semantic version`);
  /** @type {import('./propose.mjs').NamedRelease[]} */
  const releases = /** @type {any[]} */ (p.releases);
  if (onto !== undefined && releases.length > 1) {
    throw new Error(
      `this release writes ${releases.length} records (${releases.map((r) => r.tag).join(', ')}); the release workflow tags one record per pull request, so make a release of several packages on ${layout.mainBranch}, without --branch`,
    );
  }
  // The version: above each package's last full release, and never below what the delta proposes.
  if (made !== null) {
    const bump = bumpBetween(p.base_version, made);
    if (!bump) throw new Error(`${made} is not above the last full release, ${p.base_version}`);
    if (p.bump !== null && !atLeast(bump, p.bump)) {
      throw new Error(
        `${made} is a ${bump} release, but the interface delta proposes ${p.bump} (${p.reason}); make ${coreOf(/** @type {string} */ (p.version))} or above`,
      );
    }
  }
  for (const r of releases) {
    const bump = bumpBetween(r.base_version, r.version);
    if (!bump) {
      throw new Error(
        `${r.package} ${r.version} is not above its last full release, ${r.base_version}`,
      );
    }
    const own = proposeBump(r.interface_delta, r.base_version);
    if (r.surface !== null && !atLeast(bump, own.bump)) {
      throw new Error(
        `${r.package} ${r.version} is a ${bump} release, but its interface delta proposes ${own.bump} (${own.reason}); make ${own.version} or above`,
      );
    }
    if (git(root, ['tag', '--list', r.tag]).trim()) throw new Error(`tag ${r.tag} already exists`);
    const path = recordFor(t, r);
    if (existsSync(insidePath(root, path))) throw new Error(`${path} already exists`);
    for (const pin of r.depends) {
      if (!pin.satisfied) {
        throw new CodedError(
          'dependency-out-of-range',
          `${r.package} depends on ${pin.package} ${pin.range}, but ${pin.package} is ${pin.version === null ? 'not released yet' : `at ${pin.version}`}; release ${pin.package} first, in a release train with it, or change the range`,
        );
      }
    }
  }
  if (p.release_item) assertGatesMet(p);
  /** @type {{ r: import('./propose.mjs').NamedRelease, path: string, text: string, notes: string }[]} */
  const written = releases.map((r) => {
    const bump = /** @type {import('./semver.mjs').Bump} */ (
      bumpBetween(r.base_version, r.version)
    );
    const data = {
      id: r.tag,
      package: r.package,
      version: r.version,
      previous: r.base ?? undefined,
      bump,
      interface_delta: r.interface_delta.map(formatDeltaEntry),
      depends: r.depends.map((d) => `${d.package}@${d.version}`),
      decision,
      train: p.train ?? undefined,
      items: r.items,
      milestones: r.milestones,
      classification: layout.defaultClassification,
    };
    const notes = r.notes.length ? r.notes.map((n) => `- ${n}`).join('\n') : 'No release notes.';
    const breaking = r.interface_delta.filter((e) => e.impact === 'breaking');
    const body = [
      '',
      '## Notes',
      '',
      notes,
      '',
      ...(breaking.length
        ? ['## Breaking', '', ...breaking.map((e) => `- ${e.surface}: ${e.what}`), '']
        : []),
    ].join('\n');
    return { r, path: recordFor(t, r), text: renderItem(data, RELEASE_KEYS, body), notes };
  });
  const tags = written.map((w) => w.r.tag);
  const message = [
    '-m',
    `release record: ${tags.join(', ')}`,
    '-m',
    `Written by hitld release make, under the decision of ${decision === 'owner' ? 'the owner' : decision}${p.train ? `, for the release train ${p.train}` : ''}.`,
  ];
  const first = written[0];
  if (onto !== undefined) {
    const commit = commitOnBranch(root, layout, onto, written, message);
    return {
      tag: first.r.tag,
      tags,
      package: first.r.package,
      version: first.r.version,
      prerelease: isPrerelease(first.r.version),
      bump: bumpBetween(first.r.base_version, first.r.version),
      record: first.path,
      records: written.map((w) => w.path),
      commit,
      branch: onto,
      tagged: false,
      pushed: false,
      pr: pullRequest(p, { r: first.r, path: first.path, notes: first.notes }),
      warnings: p.warnings,
      next: `Nothing was pushed or tagged. Push the branch (git push origin ${onto}) and open a pull request from it to ${layout.mainBranch} with pr.title and pr.body. Squash-merging it with the owner's Signed-off-by is the release: the release workflow tags ${first.r.tag} on the squash commit once the owner approves the run in the release environment.`,
    };
  }
  writeRecords(root, layout, written);
  // Signed off with the git identity of whoever runs it, which is the owner: release make runs
  // only in the owner's own turn (the guard in cli/commands/release.mjs). The DCO check on main
  // (HITLD-59) needs a person's sign-off on every commit pushed there.
  git(root, [
    'commit',
    '--no-verify',
    '--signoff',
    ...message,
    '--',
    ...written.map((w) => w.path),
  ]);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  for (const w of written)
    git(root, ['tag', '-a', w.r.tag, '-m', tagMessage(w.r.tag, w.notes), commit]);
  return {
    tag: first.r.tag,
    tags,
    package: first.r.package,
    version: first.r.version,
    prerelease: isPrerelease(first.r.version),
    bump: bumpBetween(first.r.base_version, first.r.version),
    record: first.path,
    records: written.map((w) => w.path),
    commit,
    tagged: true,
    pushed: false,
    warnings: p.warnings,
    next: `Nothing was pushed. When ready: git push origin ${layout.mainBranch} ${tags.join(' ')}`,
  };
}

/**
 * Write and stage each record.
 * @param {string} root @param {Layout} layout
 * @param {{ r: import('./propose.mjs').NamedRelease, path: string, text: string }[]} written
 */
function writeRecords(root, layout, written) {
  for (const w of written) {
    mkdirInside(root, packageReleasesDir(layout, w.r.package));
    createExclusive(insidePath(root, w.path), w.text);
    git(root, ['add', '--', w.path]);
  }
}

/**
 * Refuse a release whose release item still waits for something.
 * @param {Pick<Proposal, 'release_item' | 'gates'>} p
 */
export function assertGatesMet(p) {
  if (p.gates.length) {
    throw new CodedError(
      'release-gates-open',
      `the release waits for its gates: ${describeGates(p.gates)}`,
    );
  }
}

/** @param {import('./propose.mjs').Gate[]} gates */
export const describeGates = (gates) =>
  gates.map((g) => `${g.id} ${g.title} (${g.state}${g.check_due ? ', check due' : ''})`).join('; ');

/**
 * The annotated tag's message: the tag, then the notes. The release workflow writes the same
 * message when it tags a merged release pull request.
 * @param {string} tag @param {string} notes
 */
export const tagMessage = (tag, notes) => `${tag}\n\n${notes}`;

/**
 * Refuse a release branch name that is not a new, valid branch, here or at a remote.
 * @param {string} root @param {string} name @param {string} mainBranch
 */
function checkNewBranch(root, name, mainBranch) {
  const valid =
    name && !name.startsWith('-')
      ? git(root, ['check-ref-format', '--branch', name], { allowFail: true }).trim()
      : '';
  if (valid !== name || !valid) {
    throw new Error(`--branch "${name}" is not a valid branch name`);
  }
  if (name === mainBranch) throw new Error(`--branch names a new branch, not ${mainBranch}`);
  const taken = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r === `refs/heads/${name}` || r.replace(/^refs\/remotes\/[^/]+\//, '') === name);
  if (taken.length) throw new Error(`branch ${name} already exists (${taken.join(', ')})`);
}

/**
 * Commit the records on a new branch made from main, then check out main again. On a failure the
 * new branch is removed and main is checked out, as it was.
 * @param {string} root @param {Layout} layout @param {string} name
 * @param {{ r: import('./propose.mjs').NamedRelease, path: string, text: string }[]} written @param {string[]} message
 * @returns {string} the commit
 */
function commitOnBranch(root, layout, name, written, message) {
  git(root, ['switch', '-q', '-c', name]);
  try {
    writeRecords(root, layout, written);
    // Signed off by whoever runs it (the owner's own turn), so the branch passes the pull request
    // DCO check; the squash commit on main carries the owner's sign-off as the one who merges.
    git(root, [
      'commit',
      '--no-verify',
      '--signoff',
      ...message,
      '--',
      ...written.map((w) => w.path),
    ]);
    const commit = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['switch', '-q', layout.mainBranch]);
    return commit;
  } catch (e) {
    for (const w of written) {
      git(root, ['reset', '-q', '--', w.path], { allowFail: true });
      rmSync(insidePath(root, w.path), { force: true });
    }
    git(root, ['switch', '-q', '-f', layout.mainBranch], { allowFail: true });
    git(root, ['branch', '-D', name], { allowFail: true });
    throw e;
  }
}

/**
 * The release pull request's title and body: the version, the bump, the notes and the interface
 * delta, for the owner to review before merging.
 * @param {Proposal} p
 * @param {{ r: import('./propose.mjs').NamedRelease, path: string, notes: string }} w
 */
function pullRequest(p, { r, path, notes }) {
  const tag = r.tag;
  const made = r.version;
  const bump = bumpBetween(r.base_version, made);
  const delta = r.interface_delta.length
    ? r.interface_delta.map((e) => `- ${formatDeltaEntry(e)}`).join('\n')
    : 'None.';
  const pre = isPrerelease(made);
  const body = [
    `The release record for **${tag}** (package ${r.package}): \`${path}\`.`,
    '',
    `- Version: ${made}${pre ? ' (a pre-release)' : ''}`,
    `- Bump: ${bump}${r.breaking ? ', breaking' : ''}, from ${r.base ?? 'no release yet (0.0.0)'}`,
    `- Reason: ${p.reason}`,
    `- Items: ${r.items.length ? r.items.join(', ') : 'none'}`,
    ...(r.depends.length
      ? [`- Built against: ${r.depends.map((d) => `${d.package} ${d.version}`).join(', ')}`]
      : []),
    ...(p.dependents.length
      ? [
          `- Depends on a breaking change: ${p.dependents.map((d) => `${d.package} (${d.range} on ${d.depends_on}${d.in_range ? '' : ', out of range'})`).join(', ')}`,
        ]
      : []),
    '',
    '## Notes',
    '',
    notes,
    '',
    '## Interface delta',
    '',
    delta,
    '',
    ...(p.warnings.length ? ['## Warnings', '', ...p.warnings.map((w) => `- ${w}`), ''] : []),
    '## Merging is the release',
    '',
    `Squash-merge this pull request with your \`Signed-off-by:\` line in the commit message. The release workflow then checks the record, waits for your approval in the \`release\` environment, tags ${tag} on the squash commit, builds, attests provenance and drafts the GitHub release${pre ? ' as a pre-release' : ''}. Publish the draft when it looks right.`,
  ].join('\n');
  return { title: `Release ${tag}`, body };
}
