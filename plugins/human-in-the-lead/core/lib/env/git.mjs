// Running git for the manager.

import { execFile } from 'node:child_process';

/**
 * Run git in a directory and return its standard output.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, out, errOut) => {
        if (err) {
          const detail = (errOut || err.message).trim().split('\n').slice(-3).join(' ');
          reject(new Error(`git ${args.slice(0, 2).join(' ')} failed: ${detail}`));
        } else resolve(out);
      },
    );
  });
}

/**
 * Whether a git command succeeds (exit code 0), for questions such as "is this an ancestor".
 * @param {string[]} args @param {string} cwd
 */
export async function gitOk(args, cwd) {
  try {
    await git(args, cwd);
    return true;
  } catch {
    return false;
  }
}
