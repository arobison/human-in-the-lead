// `hitld release make` (design parts 2.7, 3.2 and 16.5): write the release record, and either tag
// it on main or put it on a release branch for a release pull request.
//
// Minor and major releases are the owner's (a one-way door for the public interface), so the
// command line refuses this outside the owner's own turn, as it refuses decision answers
// (core/lib/cli/commands/release.mjs). Here: the release is made from the main branch, from a
// clean working tree, at the proposed version or above it (never below what the delta proposes),
// and only when the release item's gates are met. The record goes to <work dir>/releases/<tag>.md
// in one commit. Nothing is pushed.
//
// Two ways (design 16.5):
//   on main    the commit lands on main and an annotated tag marks it, for a person at a terminal
//              who then pushes both.
//   --branch   the commit goes on a new branch made from main, and main is checked out again;
//              nothing is tagged. Squash-merging the release pull request, with the owner's
//              sign-off, is the release decision; the release workflow tags that squash commit
//              once the owner approves the run (core/lib/release/check.mjs).

import { existsSync, rmSync } from 'node:fs';
import { CodedError } from '../cli/errors.mjs';
import { renderItem } from '../tracker/files/frontmatter.mjs';
import { RELEASE_KEYS, formatDeltaEntry, releasesDir } from '../tracker/files/releases.mjs';
import { createExclusive, insidePath, mkdirInside } from '../tracker/files/safe.mjs';
import { git } from '../tracker/files/tree.mjs';
import { proposeRelease } from './propose.mjs';
import { SEMVER, atLeast, bumpBetween, coreOf, isPrerelease } from './semver.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../tracker/files/config.mjs').Layout} Layout
 * @typedef {import('./propose.mjs').Proposal} Proposal
 */

/**
 * Make a release.
 * @param {FilesTracker} t
 * @param {{ version?: string, pre?: string, decision?: string, item?: string, branch?: string }} options
 *   version: the version to make (default: the proposed one); pre: a pre-release label, such as
 *   rc; decision: the decision or precedent it is made under (default owner); item: the release
 *   item whose gates must be met; branch: put the record on this new branch, made from main, and
 *   tag nothing
 */
export async function makeRelease(
  t,
  { version, pre, decision = 'owner', item, branch: onto } = {},
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
  if (onto !== undefined) checkNewBranch(root, onto, layout.mainBranch);
  const p = await proposeRelease(t, { pre, item, version });
  const made = version ?? p.version;
  if (!SEMVER.test(made)) throw new Error(`"${made}" is not a semantic version`);
  const bump = bumpBetween(p.base_version, made);
  if (!bump) throw new Error(`${made} is not above the last full release, ${p.base_version}`);
  if (!atLeast(bump, p.bump)) {
    throw new Error(
      `${made} is a ${bump} release, but the interface delta proposes ${p.bump} (${p.reason}); make ${coreOf(p.version)} or above`,
    );
  }
  const tag = `v${made}`;
  if (git(root, ['tag', '--list', tag]).trim()) throw new Error(`tag ${tag} already exists`);
  const path = `${releasesDir(layout)}/${tag}.md`;
  if (existsSync(insidePath(root, path))) throw new Error(`${path} already exists`);
  if (p.release_item) assertGatesMet(p);
  const data = {
    id: tag,
    version: made,
    previous: p.base ?? undefined,
    bump,
    interface_delta: p.interface_delta.map(formatDeltaEntry),
    decision,
    items: p.items,
    milestones: p.milestones,
    classification: layout.defaultClassification,
  };
  const notes = p.notes.length ? p.notes.map((n) => `- ${n}`).join('\n') : 'No release notes.';
  const body = [
    '',
    '## Notes',
    '',
    notes,
    '',
    ...(p.breaking
      ? [
          '## Breaking',
          '',
          ...p.interface_delta
            .filter((e) => e.impact === 'breaking')
            .map((e) => `- ${e.surface}: ${e.what}`),
          '',
        ]
      : []),
  ].join('\n');
  const text = renderItem(data, RELEASE_KEYS, body);
  const message = [
    '-m',
    `release record: ${tag}`,
    '-m',
    `Written by hitld release make, under the decision of ${decision === 'owner' ? 'the owner' : decision}.`,
  ];
  if (onto !== undefined) {
    const commit = commitOnBranch(root, layout, onto, path, text, message);
    return {
      tag,
      version: made,
      prerelease: isPrerelease(made),
      bump,
      record: path,
      commit,
      branch: onto,
      tagged: false,
      pushed: false,
      pr: pullRequest(p, { tag, made, bump, path, notes }),
      warnings: p.warnings,
      next: `Nothing was pushed or tagged. Push the branch (git push origin ${onto}) and open a pull request from it to ${layout.mainBranch} with pr.title and pr.body. Squash-merging it with the owner's Signed-off-by is the release: the release workflow tags ${tag} on the squash commit once the owner approves the run in the release environment.`,
    };
  }
  mkdirInside(root, releasesDir(layout));
  createExclusive(insidePath(root, path), text);
  git(root, ['add', '--', path]);
  // Signed off with the git identity of whoever runs it, which is the owner: release make runs
  // only in the owner's own turn (the guard in cli/commands/release.mjs). The DCO check on main
  // (HITLD-59) needs a person's sign-off on every commit pushed there.
  git(root, ['commit', '--no-verify', '--signoff', ...message, '--', path]);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['tag', '-a', tag, '-m', tagMessage(tag, notes), commit]);
  return {
    tag,
    version: made,
    prerelease: isPrerelease(made),
    bump,
    record: path,
    commit,
    tagged: true,
    pushed: false,
    warnings: p.warnings,
    next: `Nothing was pushed. When ready: git push origin ${layout.mainBranch} ${tag}`,
  };
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
 * Commit the record on a new branch made from main, then check out main again. On a failure the
 * new branch is removed and main is checked out, as it was.
 * @param {string} root @param {Layout} layout @param {string} name @param {string} path
 * @param {string} text @param {string[]} message
 * @returns {string} the commit
 */
function commitOnBranch(root, layout, name, path, text, message) {
  git(root, ['switch', '-q', '-c', name]);
  try {
    mkdirInside(root, releasesDir(layout));
    createExclusive(insidePath(root, path), text);
    git(root, ['add', '--', path]);
    // Signed off by whoever runs it (the owner's own turn), so the branch passes the pull request
    // DCO check; the squash commit on main carries the owner's sign-off as the one who merges.
    git(root, ['commit', '--no-verify', '--signoff', ...message, '--', path]);
    const commit = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['switch', '-q', layout.mainBranch]);
    return commit;
  } catch (e) {
    git(root, ['reset', '-q', '--', path], { allowFail: true });
    rmSync(insidePath(root, path), { force: true });
    git(root, ['switch', '-q', '-f', layout.mainBranch], { allowFail: true });
    git(root, ['branch', '-D', name], { allowFail: true });
    throw e;
  }
}

/**
 * The release pull request's title and body: the version, the bump, the notes and the interface
 * delta, for the owner to review before merging.
 * @param {Proposal} p
 * @param {{ tag: string, made: string, bump: string, path: string, notes: string }} r
 */
function pullRequest(p, { tag, made, bump, path, notes }) {
  const delta = p.interface_delta.length
    ? p.interface_delta.map((e) => `- ${formatDeltaEntry(e)}`).join('\n')
    : 'None.';
  const pre = isPrerelease(made);
  const body = [
    `The release record for **${tag}**: \`${path}\`.`,
    '',
    `- Version: ${made}${pre ? ' (a pre-release)' : ''}`,
    `- Bump: ${bump}${p.breaking ? ', breaking' : ''}, from ${p.base ?? 'no release yet (0.0.0)'}`,
    `- Reason: ${p.reason}`,
    `- Items: ${p.items.length ? p.items.join(', ') : 'none'}`,
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
