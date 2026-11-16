// Tracker changes reach main through one command (HITLD-125): `hitld work publish`.
//
// A session that may not push main (a cloud session, or any orchestrator or chief of staff on a
// branch of its own) files and answers decisions in its working tree. Publishing gathers the
// tracker files it changed, builds one commit for them on top of the remote's main branch, and
// pushes that commit to a new branch for a pull request. Nothing in the session's own checkout
// moves: the commit is built with a temporary index, so the branch the session is on, its index
// and its working tree stay as they are.
//
// Which files: those under the work directory that differ between the session's working tree and
// where its branch left main (commits on the branch, staged and unstaged changes, new files). The
// views are left out: the merge regenerates them. A file whose content main already has is left
// out too, so publishing twice publishes nothing the second time.
//
// Main moved: the session's version of a file wins only when main's version is one the session
// has seen (where its branch left main, a commit on its branch, or a commit it published before).
// Otherwise main changed the file in a way this session never saw, and publishing refuses rather
// than overwrite it.
//
// This file only builds and pushes; the command (core/lib/cli/commands/work-publish.mjs) runs the
// checks between the steps and refuses executors.

import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodedError } from '../../cli/errors.mjs';
import { git } from './tree.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {'added' | 'changed' | 'removed'} Change
 * @typedef {{ path: string, change: Change, blob: string | null }} PublishedFile blob null: removed
 */

/** Where the commits this checkout has published are kept, one ref per branch. */
export const PUBLISHED_REFS = 'refs/hitld/published';

/** The roles that publish tracker changes. An executor's tracker changes ride with its branch. */
export const PUBLISH_ROLES = Object.freeze(['orchestrator', 'chief-of-staff']);

/** Trailers the command writes itself, which --trailer may not set. */
const OWN_TRAILERS = Object.freeze(['work-item', 'agent-role', 'dispatch']);

/** A git trailer line: a key, a colon, a value on one line. */
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*):[ \t]+(\S.*)$/;

/** A branch name the command accepts: plain segments, no "..", no leading dash. */
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![./])$/;

/** @param {string} root @param {string[]} args */
const lines = (root, args) => git(root, args).split('\0').filter(Boolean);

/** The blob at <rev>:<path>, or null when the path is not there. @param {string} root @param {string} rev @param {string} path */
function blobAt(root, rev, path) {
  return (
    git(root, ['rev-parse', '--verify', '-q', `${rev}:${path}`], { allowFail: true }).trim() || null
  );
}

/**
 * Fetch the remote's main branch and name the commit.
 * @param {string} root @param {string} remote @param {string} mainBranch
 * @returns {{ ref: string, commit: string }}
 */
export function fetchBase(root, remote, mainBranch) {
  const ref = `refs/remotes/${remote}/${mainBranch}`;
  try {
    // Trust boundary: the project's own remote, named by the checkout's git configuration.
    git(root, ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${mainBranch}:${ref}`]);
  } catch (e) {
    throw new CodedError(
      'remote-unreachable',
      `the remote ${remote} did not give its ${mainBranch} branch (${/** @type {Error} */ (e).message}); nothing was published`,
    );
  }
  return { ref: `${remote}/${mainBranch}`, commit: git(root, ['rev-parse', ref]).trim() };
}

/**
 * The tracker files this session changed and main does not already have.
 * @param {string} root @param {Layout} layout @param {string} base the commit of main to publish onto
 * @param {string[]} [also] repository paths outside the tracker published with it, such as the
 *   design a walk-through decided (HITLD-135); the caller checks them
 * @returns {{ files: PublishedFile[], conflicts: string[], skipped: string[], left_out: string[], from: string }}
 *   from: where the session's branch left main; skipped: files main already has;
 *   left_out: changed files outside the tracker, or not regular files
 */
export function gatherChanges(root, layout, base, also = []) {
  const from = git(root, ['merge-base', 'HEAD', base], { allowFail: true }).trim() || base;
  const work = `${layout.workDir}/`;
  const views = `${layout.workDir}/${layout.viewsDir}/`;
  const changed = new Set([
    ...lines(root, ['diff', '--name-only', '-z', '--no-renames', from, 'HEAD']),
    ...lines(root, ['diff', '--name-only', '-z', '--no-renames', 'HEAD']),
    ...lines(root, ['ls-files', '-z', '--others', '--exclude-standard']),
  ]);
  const published = git(root, ['for-each-ref', '--format=%(objectname)', PUBLISHED_REFS])
    .split('\n')
    .filter(Boolean);

  /** @type {PublishedFile[]} */
  const files = [];
  const conflicts = [];
  const skipped = [];
  const leftOut = [];
  for (const path of [...changed].sort()) {
    if (!also.includes(path) && (!path.startsWith(work) || path.startsWith(views))) {
      leftOut.push(path);
      continue;
    }
    /** @type {string | null} */
    let blob = null;
    const st = statOf(join(root, path));
    if (st && !st.isFile()) {
      // Only a regular file is published: a link or a directory (a submodule) is left out.
      leftOut.push(path);
      continue;
    }
    if (st) blob = git(root, ['hash-object', '-w', '--', path]).trim();
    const onMain = blobAt(root, base, path);
    if (blob === onMain) {
      skipped.push(path);
      continue;
    }
    // The versions of this file the session has seen.
    const seen = new Set([blobAt(root, from, path)]);
    for (const c of git(root, ['rev-list', `${from}..HEAD`, '--', path])
      .split('\n')
      .filter(Boolean)) {
      seen.add(blobAt(root, c, path));
    }
    for (const c of published) seen.add(blobAt(root, c, path));
    if (!seen.has(onMain)) {
      conflicts.push(path);
      continue;
    }
    files.push({
      path,
      change: blob === null ? 'removed' : onMain === null ? 'added' : 'changed',
      blob,
    });
  }
  return { files, conflicts, skipped, left_out: leftOut, from };
}

/** @param {string} full */
function statOf(full) {
  try {
    return lstatSync(full);
  } catch {
    return null;
  }
}

/**
 * The item IDs among the files, from their names, in number order.
 * @param {Layout} layout @param {{ path: string }[]} files
 */
export function itemIds(layout, files) {
  const re = new RegExp(`^(${layout.key}-[1-9][0-9]*)(?:-|\\.md$)`);
  const ids = new Set();
  for (const f of files) {
    const m = re.exec(f.path.split('/').at(-1) ?? '');
    if (m) ids.add(m[1]);
  }
  return [...ids].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
}

/**
 * The commit message and the pull request text.
 * @param {{ title: string, body?: string, role: string, ids: string[], trailers: string[], files: PublishedFile[] }} o
 */
export function composeMessage(o) {
  const title = o.title.trim();
  if (!title || /[\r\n]/.test(title)) throw new CodedError('usage', '--title is one line of text');
  if (!PUBLISH_ROLES.includes(o.role)) {
    throw new CodedError(
      'usage',
      `--role is ${PUBLISH_ROLES.join(' or ')} (or HITLD_ROLE names one); executors do not publish`,
    );
  }
  for (const t of o.trailers) {
    const m = TRAILER.exec(t);
    if (!m)
      throw new CodedError(
        'usage',
        `--trailer ${JSON.stringify(t)} is not "Key: value" on one line`,
      );
    if (OWN_TRAILERS.includes(m[1].toLowerCase())) {
      throw new CodedError('usage', `--trailer may not set ${m[1]}: hitld work publish writes it`);
    }
  }
  const subject = /^tracker:\s/i.test(title) ? title : `Tracker: ${title}`;
  const body = (o.body ?? '').trim();
  const trailers = [
    ...o.ids.map((id) => `Work-Item: ${id}`),
    `Agent-Role: ${o.role}`,
    ...o.trailers,
  ];
  const message = `${[subject, body, trailers.join('\n')].filter(Boolean).join('\n\n')}\n`;
  const list = o.files.map((f) => `- \`${f.path}\` (${f.change})`).join('\n');
  const prBody = `${[body, `Tracker files:\n\n${list}`].filter(Boolean).join('\n\n')}\n`;
  return { subject, message, pull_request: { title: subject, body: prBody } };
}

/**
 * Build the commit on top of base with a temporary index: the checkout's branch, index and
 * working tree are not touched.
 * @param {string} root @param {string} base @param {PublishedFile[]} files @param {string} message
 * @returns {string} the commit
 */
export function buildCommit(root, base, files, message) {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-publish-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  /** @param {string[]} args @param {string} [input] */
  const run = (args, input) => {
    try {
      return execGit(root, args, env, input);
    } catch (e) {
      throw new Error(`git ${args[0]} failed: ${/** @type {Error} */ (e).message}`);
    }
  };
  try {
    run(['read-tree', base]);
    for (const f of files) {
      if (f.blob === null) run(['update-index', '--force-remove', '--', f.path]);
      else run(['update-index', '--add', '--cacheinfo', `100644,${f.blob},${f.path}`]);
    }
    const tree = run(['write-tree']).trim();
    return run(['commit-tree', tree, '-p', base, '-F', '-'], message).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} root @param {string[]} args @param {NodeJS.ProcessEnv} env @param {string} [input] */
function execGit(root, args, env, input) {
  const r = spawnSync('git', args, { cwd: root, env, input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || String(r.error ?? `exit ${r.status}`)).trim());
  return r.stdout;
}

/**
 * The branch the commit is pushed to: given, or made from the first item and the commit. Never
 * the main branch.
 * @param {Layout} layout @param {string | undefined} given @param {string[]} ids @param {string} commit
 */
export function branchFor(layout, given, ids, commit) {
  const name = given ?? `hitld/tracker-${ids.length ? `${ids[0]}-` : ''}${commit.slice(0, 8)}`;
  if (!BRANCH.test(name) || name.endsWith('.lock')) {
    throw new CodedError(
      'usage',
      `--branch ${JSON.stringify(name)} is not a branch name hitld pushes`,
    );
  }
  if (name === layout.mainBranch || name === `refs/heads/${layout.mainBranch}`) {
    throw new CodedError('not-permitted', `hitld work publish never pushes ${layout.mainBranch}`);
  }
  return name;
}

/**
 * Push the commit to a new branch on the remote (never forced), and remember it as published.
 * @param {string} root @param {string} remote @param {string} commit @param {string} branch
 */
export function pushBranch(root, remote, commit, branch) {
  try {
    // Trust boundary: the project's own remote. A plain push: an existing branch that does not
    // lead to the commit refuses it.
    git(root, ['push', '--quiet', '--no-verify', remote, `${commit}:refs/heads/${branch}`]);
  } catch (e) {
    throw new CodedError(
      'push-failed',
      `the push of ${branch} to ${remote} failed (${/** @type {Error} */ (e).message}); nothing was published`,
    );
  }
  git(root, ['update-ref', `${PUBLISHED_REFS}/${branch}`, commit]);
}

/**
 * The forge repository a remote names, as owner/name, or null when its URL is not a GitHub one.
 * @param {string} root @param {string} remote
 */
export function forgeRepo(root, remote) {
  const url = git(root, ['remote', 'get-url', remote], { allowFail: true }).trim();
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The branch this checkout already published the same tree on, or null: publishing again before
 * main moves would push the same change twice.
 * @param {string} root @param {string} commit
 */
export function publishedAs(root, commit) {
  const tree = git(root, ['rev-parse', `${commit}^{tree}`]).trim();
  for (const line of git(root, [
    'for-each-ref',
    '--format=%(objectname)%09%(refname)',
    PUBLISHED_REFS,
  ]).split('\n')) {
    const [sha, ref] = line.split('\t');
    if (!sha || !ref) continue;
    if (git(root, ['rev-parse', `${sha}^{tree}`]).trim() === tree) {
      return ref.slice(PUBLISHED_REFS.length + 1);
    }
  }
  return null;
}
