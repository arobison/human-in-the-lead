// `hitld release make` (design parts 2.7 and 3.2): write the release record and the tag.
//
// Minor and major releases are the owner's (a one-way door for the public interface), so the
// command line refuses this outside the owner's own turn, as it refuses decision answers
// (core/lib/cli/commands/release.mjs). Here: the release is made on the main branch, from a clean
// working tree, at the proposed version or above it (never below what the delta proposes), and
// only when the release item's gates are met. The record goes to <work dir>/releases/<tag>.md in
// one commit, then an annotated tag marks that commit. Nothing is pushed.

import { existsSync } from 'node:fs';
import { renderItem } from '../tracker/files/frontmatter.mjs';
import { RELEASE_KEYS, formatDeltaEntry, releasesDir } from '../tracker/files/releases.mjs';
import { createExclusive, insidePath, mkdirInside } from '../tracker/files/safe.mjs';
import { git } from '../tracker/files/tree.mjs';
import { proposeRelease } from './propose.mjs';
import { SEMVER, atLeast, bumpBetween, coreOf, isPrerelease } from './semver.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 */

/**
 * Make a release.
 * @param {FilesTracker} t
 * @param {{ version?: string, pre?: string, decision?: string, item?: string }} options
 *   version: the version to make (default: the proposed one); pre: a pre-release label, such as
 *   rc; decision: the decision or precedent it is made under (default owner); item: the release
 *   item whose gates must be met
 */
export async function makeRelease(t, { version, pre, decision = 'owner', item } = {}) {
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
  const p = await proposeRelease(t, { pre, item });
  const made = version ?? p.version;
  if (!SEMVER.test(made)) throw new Error(`"${made}" is not a semantic version`);
  const bump = bumpBetween(p.base_version, made);
  if (!bump) throw new Error(`${made} is not above the last full release, ${p.base_version}`);
  if (!atLeast(bump, p.bump)) {
    throw new Error(
      `${made} is a ${bump} release, but the interface delta proposes ${p.bump} (${p.basis}); make ${coreOf(p.version)} or above`,
    );
  }
  const tag = `v${made}`;
  if (git(root, ['tag', '--list', tag]).trim()) throw new Error(`tag ${tag} already exists`);
  const path = `${releasesDir(layout)}/${tag}.md`;
  if (existsSync(insidePath(root, path))) throw new Error(`${path} already exists`);
  const gates = item ? p.gates.filter((g) => g.item === item) : [];
  if (gates.length) {
    throw new Error(
      `the release waits for its gates: ${gates.map((g) => `${g.milestone} ${g.title} (${g.state}${g.check_due ? ', check due' : ''})`).join('; ')}`,
    );
  }
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
  const notes = p.notes.length ? p.notes.map((n) => `- ${n}`).join('\n') : 'No changelog lines.';
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
            .map((e) => `- ${e.area}: ${e.what}`),
          '',
        ]
      : []),
  ].join('\n');
  const text = renderItem(data, RELEASE_KEYS, body);
  mkdirInside(root, releasesDir(layout));
  createExclusive(insidePath(root, path), text);
  git(root, ['add', '--', path]);
  git(root, [
    'commit',
    '--no-verify',
    '-m',
    `release record: ${tag}`,
    '-m',
    `Written by hitld release make, under the decision of ${decision === 'owner' ? 'the owner' : decision}.`,
    '--',
    path,
  ]);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['tag', '-a', tag, '-m', `${tag}\n\n${notes}`, commit]);
  return {
    tag,
    version: made,
    prerelease: isPrerelease(made),
    bump,
    record: path,
    commit,
    pushed: false,
    warnings: p.warnings,
    next: `Nothing was pushed. When ready: git push origin ${layout.mainBranch} ${tag}`,
  };
}
