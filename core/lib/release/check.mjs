// The record-to-tag check (design 16.5, HITLD-79): before the release workflow tags a commit on
// main, it checks the release record that commit adds.
//
// A release arrives on main as the squash commit of a release pull request (`hitld release make
// --branch`). The check refuses unless:
//   - the commit adds exactly one record under <work dir>/releases/<package>/ (none: nothing to
//     release); a record directly under <work dir>/releases/ is from before release packages;
//   - the record parses and passes the tracker's checks and the release schema;
//   - its tag does not exist yet;
//   - its version is the one `release propose --package <its package>` gives at the commit's
//     parent (for a package with no surface file, which gets no proposal: any version above its
//     last full release), for the same pre-release label or for a full release, its `previous` is that
//     proposal's base, and that release is of this package alone (a lockstep group or a train is
//     made on main, where `release make` tags each record);
//   - the commit is on main, has one parent, and its subject ends with the pull request number
//     GitHub's squash merge adds, "(#N)"; given the pull requests GitHub links the commit to, N
//     must be one of them.
//   - when a work item's `release` is that version, everything it needs is done or dropped, read
//     at the parent (the rule `release make` applies).
// It reads git and the files only; it tags nothing. The workflow tags on its result.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy } from '../policy/policy.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { releasesDir } from '../tracker/files/releases.mjs';
import { openTracker } from '../tracker/files/tracker.mjs';
import { git } from '../tracker/files/tree.mjs';
import { describeGates, tagMessage, trainProblem } from './make.mjs';
import { channelProblem, proposeRelease } from './propose.mjs';
import { bumpBetween, isPrerelease, preLabelOf } from './semver.mjs';

/**
 * @typedef {object} RecordCheck
 * @property {boolean} ok true when there is nothing to release, or the record may be tagged
 * @property {string} commit the commit checked
 * @property {string | null} record the record the commit adds
 * @property {string | null} tag
 * @property {string | null} version
 * @property {boolean} prerelease
 * @property {number | null} pr the pull request number in the commit's subject
 * @property {string | null} proposed the version `release propose` gives at the parent
 * @property {string | null} notes the record's notes
 * @property {string | null} message the annotated tag's message
 * @property {string[]} problems why it may not be tagged
 * @property {string[]} warnings
 */

/** The squash merge's pull request number at the end of a subject. */
const PR_SUFFIX = /\(#([1-9]\d*)\)\s*$/;

/** @param {string} root */
function openAt(root) {
  const loaded = loadPolicy({ cwd: root });
  if (!loaded.policy) {
    throw new Error(`policy.json: ${formatErrors(loaded.errors).split('\n').join('; ')}`);
  }
  return openTracker({ repoRoot: root, policy: loaded.policy, env: {} });
}

export { preLabelOf };

/** The text of a record body's "## Notes" section. @param {string} body */
export function notesOf(body) {
  const m = /(?:^|\n)## Notes\n([\s\S]*?)(?=\n## |$)/.exec(body);
  return m ? m[1].trim() || 'No release notes.' : 'No release notes.';
}

/**
 * Check the release record a commit on main adds.
 * @param {{ root: string, commit?: string, main?: string, prs?: number[] }} options
 *   root: a checkout at the commit; commit: default HEAD; main: the main branch's ref (default
 *   the tracker's main branch); prs: the merged pull requests GitHub links the commit to, when
 *   known
 * @returns {Promise<RecordCheck>}
 */
export async function checkReleaseCommit({ root, commit = 'HEAD', main, prs }) {
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]).trim();
  if (git(root, ['rev-parse', 'HEAD']).trim() !== sha) {
    throw new Error(`check out ${sha} first: the record is read from the working tree`);
  }
  const t = openAt(root);
  const layout = t.layout();
  /** @type {RecordCheck} */
  const out = {
    ok: false,
    commit: sha,
    record: null,
    tag: null,
    version: null,
    prerelease: false,
    pr: null,
    proposed: null,
    notes: null,
    message: null,
    problems: [],
    warnings: [],
  };
  const problems = out.problems;
  const parents = git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1);
  const dir = releasesDir(layout);
  // What the commit adds, against its first parent (or nothing, for a root commit).
  const added = git(root, [
    'diff-tree',
    '-r',
    '--no-commit-id',
    '--name-only',
    '--diff-filter=A',
    ...(parents.length ? [parents[0], sha] : ['--root', sha]),
    '--',
    `${dir}/`,
  ])
    .split('\n')
    .map((f) => f.trim())
    .filter(
      (f) =>
        f.startsWith(`${dir}/`) &&
        f.endsWith('.md') &&
        f.slice(dir.length + 1).split('/').length <= 2,
    );
  if (!added.length) {
    out.ok = true;
    return out;
  }
  if (parents.length !== 1) {
    problems.push(
      `${sha.slice(0, 12)} has ${parents.length} parents; a release arrives as the squash commit of a pull request`,
    );
    return out;
  }
  if (added.length > 1) {
    problems.push(
      `the commit adds ${added.length} release records (${added.join(', ')}); one release per pull request`,
    );
    return out;
  }
  const path = added[0];
  out.record = path;
  const pkg = path.slice(dir.length + 1).split('/').length === 2 ? path.split('/').at(-2) : null;
  if (pkg === null) {
    problems.push(
      `${path} is a repository-wide record from before release packages; a release adds <work dir>/releases/<package>/<version>.md`,
    );
    return out;
  }

  // The record: it parses, and passes the tracker's checks and the schema.
  const entry = t.releases().find((r) => r.path === path);
  const own = t
    .check()
    .problems.filter((p) => p.startsWith(`${path}:`))
    .map((p) => `record ${p}`);
  problems.push(...own);
  const d = entry?.data;
  if (!d || typeof d.id !== 'string' || typeof d.version !== 'string') {
    if (!own.length) problems.push(`record ${path} has no id or version`);
    return out;
  }
  const tag = d.id;
  const version = d.version;
  Object.assign(out, { tag, version, prerelease: isPrerelease(version) });
  out.notes = notesOf(entry.body);
  out.message = tagMessage(tag, out.notes);

  // The tag does not exist yet.
  if (git(root, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFail: true }).trim()) {
    problems.push(`tag ${tag} already exists`);
  }

  // On main, through a pull request.
  const mainRef = main ?? layout.mainBranch;
  const mainSha = git(
    root,
    ['rev-parse', '-q', '--verify', '--end-of-options', `${mainRef}^{commit}`],
    {
      allowFail: true,
    },
  ).trim();
  if (!mainSha) problems.push(`${mainRef} is not a branch here`);
  else if (mainSha !== sha && !isAncestor(root, sha, mainSha)) {
    problems.push(`${sha.slice(0, 12)} is not on ${mainRef}`);
  }
  const subject = git(root, ['log', '-1', '--format=%s', sha]).trim();
  const pr = PR_SUFFIX.exec(subject);
  if (!pr) {
    problems.push(
      `the commit did not arrive through a pull request: its subject "${subject}" does not end with (#N), as a squash merge's does`,
    );
  } else {
    out.pr = Number(pr[1]);
    if (prs && !prs.includes(out.pr)) {
      problems.push(
        `the subject names #${out.pr}, but GitHub links the commit to ${prs.length ? prs.map((n) => `#${n}`).join(', ') : 'no merged pull request'}`,
      );
    }
  }

  // The version release propose gives at the parent.
  const label = preLabelOf(version);
  if (label === undefined) {
    problems.push(`${version}'s pre-release part is not <label>.<n>, which release propose gives`);
    return out;
  }
  // The label is one of the package's channels, as the make command requires (HITLD-898).
  const declared = (layout.packages ?? []).find((x) => x.name === pkg);
  const channel = declared ? channelProblem(declared, version) : null;
  if (channel) {
    problems.push(channel);
    return out;
  }
  const wt = mkdtempSync(join(tmpdir(), 'hitld-release-check-'));
  try {
    git(root, ['worktree', 'add', '-q', '--detach', wt, parents[0]]);
    const p = await proposeRelease(openAt(wt), {
      package: pkg,
      version,
      ...(label ? { pre: label } : {}),
    });
    if (p.releases.length > 1) {
      problems.push(
        `${pkg} is released with its lockstep group (${p.releases.map((r) => r.package).join(', ')}); a release of several packages is made on main with hitld release make, which tags each record`,
      );
    }
    out.proposed = p.version;
    out.warnings.push(...p.warnings);
    if (!p.interface_measured) {
      // No surface file: no version is proposed, and the owner named it (HITLD-752, Q39). It
      // must still be above the last full release.
      if (!bumpBetween(p.base_version, version)) {
        problems.push(`${tag} is not above ${pkg}'s last full release, ${p.base_version}`);
      }
    } else if (p.version !== version) {
      problems.push(
        `${tag} is not the next release: at the parent, release propose --package ${pkg}${label ? ` --pre ${label}` : ''} gives ${p.version} (${p.reason})`,
      );
    }
    if (p.release_item && p.gates.length) {
      problems.push(
        `the release item ${p.release_item} for ${version} still waits for its gates: ${describeGates(p.gates)}`,
      );
    }
    // While a train is open, a release it needs is not made alone (HITLD-898).
    const train = trainProblem(openAt(wt), p);
    if (train) problems.push(train);
    if ((d.previous ?? null) !== p.base) {
      problems.push(
        `previous is ${d.previous ?? 'not set'}, but the last full release is ${p.base ?? 'none'}`,
      );
    }
  } finally {
    git(root, ['worktree', 'remove', '--force', wt], { allowFail: true });
    rmSync(wt, { recursive: true, force: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
  }
  out.ok = problems.length === 0;
  return out;
}

/** @param {string} root @param {string} a @param {string} b */
function isAncestor(root, a, b) {
  try {
    git(root, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}
