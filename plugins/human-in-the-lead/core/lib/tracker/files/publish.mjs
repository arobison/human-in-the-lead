// Tracker changes reach main through one command (HITLD-125): `hitld work publish`.
//
// A session that may not push main (a cloud session, or any orchestrator or chief of staff on a
// branch of its own) files and answers decisions in its working tree. Publishing gathers the
// tracker files it changed, builds one commit for them on top of the remote's main branch, and
// pushes that commit to a new branch for a pull request. The commit is built with a temporary
// index, so the branch the session is on stays as it is, and the working tree is never touched.
// Once pushed, a checkout on the main branch has the published files staged, so a later pull of the
// merged result (git pull --ff-only) absorbs them (stagePublished, HITLD-202); on any other
// branch nothing moves.
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

// Batched reads. Starting a process costs far more on some machines (Windows with endpoint
// protection: about 200 ms) than others, and publishing reads several objects for each changed
// file, so they are read in one process for all files. Git takes these inputs one per line: a path
// holding a line break is read on its own, as before.

/** Whether a path can go on a line of a batched git input. @param {string} path */
const batchable = (path) => !/[\r\n]/.test(path);

/**
 * The object at each `<rev>:<path>`, in order, from one `git cat-file --batch-check`: null where
 * the path is not there (as blobAt).
 * @param {string} root @param {{ rev: string, path: string }[]} asked
 * @returns {(string | null)[]}
 */
function objectsAt(root, asked) {
  const batched = asked.filter((a) => batchable(a.path));
  const answer = batched.length
    ? git(root, ['cat-file', '--batch-check=%(objectname)'], {
        input: `${batched.map((a) => `${a.rev}:${a.path}`).join('\n')}\n`,
      }).split('\n')
    : [];
  let i = 0;
  return asked.map((a) => {
    if (!batchable(a.path)) return blobAt(root, a.rev, a.path);
    const line = answer[i++] ?? '';
    // "<object>", or "<what was asked> missing" (or "ambiguous").
    return /^[0-9a-f]{40,64}$/.test(line) ? line : null;
  });
}

/**
 * Write each file's content as a blob, as `git hash-object -w -- <path>` does (with the
 * repository's filters), in one process: the blobs, in order.
 * @param {string} root @param {string[]} paths repository-relative
 * @returns {string[]}
 */
function hashFiles(root, paths) {
  const batched = paths.filter(batchable);
  const answer = batched.length
    ? git(root, ['hash-object', '-w', '--stdin-paths'], {
        input: `${batched.join('\n')}\n`,
      }).split('\n')
    : [];
  let i = 0;
  return paths.map((p) =>
    batchable(p) ? (answer[i++] ?? '').trim() : git(root, ['hash-object', '-w', '--', p]).trim(),
  );
}

/**
 * The commits from..HEAD that change each path, as `git rev-list from..HEAD -- <path>` gives them
 * path by path. One `git log` reads every commit in the range with the files it changes. When the
 * range is linear (no merge), a path's commits are exactly those that change it. A merge makes
 * git's history simplification depend on the path, so then each path is asked on its own, as
 * before.
 * @param {string} root @param {string} from @param {string[]} paths
 * @returns {Map<string, string[]>} path → commits, newest first
 */
function commitsChanging(root, from, paths) {
  /** @type {Map<string, string[]>} */
  const out = new Map(paths.map((p) => [p, []]));
  if (!paths.length) return out;
  const log = git(root, [
    'log',
    '-z',
    '--root',
    '--no-show-signature',
    '--no-renames',
    '--name-only',
    '--format=%x01%H %P',
    `${from}..HEAD`,
  ]);
  let merges = false;
  for (const record of log.split('\x01').slice(1)) {
    const nul = record.indexOf('\0');
    const [commit, ...parents] = (nul < 0 ? record : record.slice(0, nul)).trim().split(' ');
    if (parents.length > 1) merges = true;
    const names =
      nul < 0
        ? []
        : record
            .slice(nul + 1)
            .replace(/^\n/, '')
            .split('\0');
    for (const name of names) out.get(name)?.push(commit);
  }
  if (merges) {
    for (const p of paths) {
      out.set(
        p,
        git(root, ['rev-list', `${from}..HEAD`, '--', p])
          .split('\n')
          .filter(Boolean),
      );
    }
  }
  return out;
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
  /** @type {string[]} */
  const conflicts = [];
  /** @type {string[]} */
  const skipped = [];
  const leftOut = [];
  /** @type {{ path: string, present: boolean }[]} */
  const candidates = [];
  for (const path of [...changed].sort()) {
    if (!also.includes(path) && (!path.startsWith(work) || path.startsWith(views))) {
      leftOut.push(path);
      continue;
    }
    const st = statOf(join(root, path));
    if (st && !st.isFile()) {
      // Only a regular file is published: a link or a directory (a submodule) is left out.
      leftOut.push(path);
      continue;
    }
    candidates.push({ path, present: Boolean(st) });
  }
  // The session's version of each file (null: removed), and main's.
  const hashed = hashFiles(
    root,
    candidates.filter((c) => c.present).map((c) => c.path),
  );
  const onMain = objectsAt(
    root,
    candidates.map((c) => ({ rev: base, path: c.path })),
  );
  /** @type {{ path: string, blob: string | null, onMain: string | null }[]} */
  const differ = [];
  let h = 0;
  candidates.forEach((c, i) => {
    const blob = c.present ? hashed[h++] : null;
    if (blob === onMain[i]) skipped.push(c.path);
    else differ.push({ path: c.path, blob, onMain: onMain[i] });
  });
  // The versions of each file the session has seen: where its branch left main, each commit on
  // its branch that changes the file, and each commit it published before.
  const commits = commitsChanging(
    root,
    from,
    differ.map((d) => d.path),
  );
  const asked = differ.flatMap((d) =>
    [from, ...(commits.get(d.path) ?? []), ...published].map((rev) => ({ rev, path: d.path })),
  );
  const versions = objectsAt(root, asked);
  let v = 0;
  for (const d of differ) {
    const n = 1 + (commits.get(d.path) ?? []).length + published.length;
    const seen = new Set(versions.slice(v, v + n));
    v += n;
    if (!seen.has(d.onMain)) {
      conflicts.push(d.path);
      continue;
    }
    files.push({
      path: d.path,
      change: d.blob === null ? 'removed' : d.onMain === null ? 'added' : 'changed',
      blob: d.blob,
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
    // Every file in one update-index: mode 0 removes a path.
    const none = '0'.repeat(base.length);
    const entries = files.map((f) =>
      f.blob === null ? `0 ${none}\t${f.path}\0` : `100644 ${f.blob}\t${f.path}\0`,
    );
    if (entries.length) run(['update-index', '-z', '--index-info'], entries.join(''));
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
 * After a publish, stage the published files in the checkout's index when it is on the main
 * branch (HITLD-202). Left as they were, a new file stays untracked, and pulling main once the pull
 * request merges stops on "untracked working tree files would be overwritten". Staged with exactly
 * the content that was pushed, they are tracked changes the merge absorbs: a fast-forward pull
 * whose commit brings the same content goes through (a merge or rebase pull refuses while they
 * are staged). The working tree is never touched, so every
 * local reader (work show, rights answer, the next edit, a design) still sees what was published.
 *
 * The index entry is the pushed blob, not whatever the working copy holds by then, so the index
 * matches the pushed commit. On any other branch nothing moves: the session's branch is its own to
 * commit.
 * @param {string} root @param {Layout} layout @param {PublishedFile[]} files
 * @returns {{ branch: string | null, staged: string[] }} branch null: detached HEAD
 */
export function stagePublished(root, layout, files) {
  const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true }).trim();
  if (branch !== layout.mainBranch || !files.length) {
    return { branch: branch || null, staged: [] };
  }
  // One update-index for every file, as buildCommit does: mode 0 stages a removal. Paths go in
  // NUL-terminated, so no name is read as a pattern or split on a line break.
  const none = '0'.repeat(git(root, ['rev-parse', 'HEAD']).trim().length);
  const entries = files.map((f) =>
    f.blob === null ? `0 ${none}\t${f.path}\0` : `100644 ${f.blob}\t${f.path}\0`,
  );
  git(root, ['update-index', '-z', '--index-info'], { input: entries.join('') });
  return { branch, staged: files.map((f) => f.path) };
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
  // Each published commit's tree comes with the listing; only a ref that is not a commit (which
  // pushBranch never writes) is peeled on its own.
  for (const line of git(root, [
    'for-each-ref',
    '--format=%(objectname)%09%(tree)%09%(refname)',
    PUBLISHED_REFS,
  ]).split('\n')) {
    const [sha, listed, ref] = line.split('\t');
    if (!sha || !ref) continue;
    const its = listed || git(root, ['rev-parse', `${sha}^{tree}`]).trim();
    if (its === tree) return ref.slice(PUBLISHED_REFS.length + 1);
  }
  return null;
}
