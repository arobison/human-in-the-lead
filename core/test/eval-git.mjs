// Git for the eval tests: a baseline is accepted only from a run of a commit on main with a clean
// tree (HITLD-100), so a test workspace that accepts one is a repository on main.

import { execFileSync } from 'node:child_process';

/**
 * Run git in a directory, as a test author.
 * @param {string} cwd @param {...string} args @returns {string}
 */
export const git = (cwd, ...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

/**
 * Make a directory a repository whose main branch holds everything in it.
 * @param {string} cwd
 */
export function repoOnMain(cwd) {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'main');
}

/**
 * Commit what has changed in the directory since, on the branch it is on.
 * @param {string} cwd @param {string} [message]
 */
export function commitAll(cwd, message = 'change') {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
}
