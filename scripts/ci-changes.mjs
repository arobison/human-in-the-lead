#!/usr/bin/env node
// What a CI run has to check, from the paths it changes (HITLD-131). CI's jobs call it first and
// skip their own steps from its answer, so every job still reports a result for the checks that
// branch protection may require; a path filter on the workflow would leave them waiting.
//
//   code    false only for a pull request that changes nothing outside work/: the typecheck,
//           format check, tests and offline evals have nothing to check. `hitld work check`, dco
//           and public run on every pull request whatever this says.
//   codeql  false only for a pull request that changes nothing but text CodeQL does not analyze:
//           work/, docs/, Markdown and plain text. A change to code or to a workflow is analyzed.
//
// Anything but a pull request (a push to main, a schedule) checks everything. On a pull request,
// actions/checkout checks out GitHub's merge commit, so its changes are the diff from the first
// parent (the base as merged) to it, fetched with depth 2. When that cannot be read, the script
// fails, and the job with it: it never answers "nothing to check" from a diff it did not see.
//
//   node scripts/ci-changes.mjs   (in GitHub Actions; writes code= and codeql= to $GITHUB_OUTPUT)

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A path under work/: the tracker. */
const isWork = (/** @type {string} */ p) => p.startsWith('work/');

/** Text CodeQL does not analyze. */
const isText = (/** @type {string} */ p) =>
  isWork(p) || p.startsWith('docs/') || /\.(md|txt)$/i.test(p) || p === 'LICENSE';

/**
 * @param {string[]} paths the changed paths, repository-relative with forward slashes; a rename
 *   counts as both of its paths
 * @returns {{ code: boolean, codeql: boolean }}
 */
export function classify(paths) {
  // An empty diff is checked in full: nothing says it is only text.
  if (paths.length === 0) return { code: true, codeql: true };
  return { code: !paths.every(isWork), codeql: !paths.every(isText) };
}

/** @param {string[]} args @returns {string} */
function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout;
}

/**
 * The paths a pull request's merge commit (HEAD) changes against its first parent.
 * @returns {string[]}
 */
export function mergeCommitPaths() {
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
  if (parents.length !== 3) {
    throw new Error(
      `HEAD is not a pull request's merge commit (it has ${parents.length - 1} parent(s)); check out the default ref with fetch-depth: 2`,
    );
  }
  // --no-renames: a file moved into work/ also counts where it came from.
  return git(['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD']).split('\n').filter(Boolean);
}

/** @param {NodeJS.ProcessEnv} env */
function main(env) {
  const pullRequest = env.GITHUB_EVENT_NAME === 'pull_request';
  const paths = pullRequest ? mergeCommitPaths() : [];
  const result = pullRequest ? classify(paths) : { code: true, codeql: true };
  const lines = `code=${result.code}\ncodeql=${result.codeql}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines);
  process.stdout.write(
    pullRequest
      ? `${paths.length} changed path(s): code checks ${result.code ? 'run' : 'skipped (work/ only)'}, CodeQL ${result.codeql ? 'runs' : 'skipped (text only)'}\n`
      : `${env.GITHUB_EVENT_NAME ?? 'not a pull request'}: everything is checked\n`,
  );
  process.stdout.write(lines);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.env);
  } catch (e) {
    process.stderr.write(`ci-changes: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
