// Feedback records are confidential and live only in the private store (design part 18.4). This
// finds one that has ended up in a repository: for the tracker check, which reports it. The commit
// guard (HITLD-51) catches the same file by its `classification: confidential`.

import { execFileSync } from 'node:child_process';

/** A feedback record's file name: FB-<n>, with or without an extension. */
const RECORD_FILE = /^FB-[1-9][0-9]*(\..+)?$/;

/**
 * Paths in the working tree (tracked, or untracked and not ignored) that look like feedback
 * records: a file named FB-<n> under a feedback/ folder.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function feedbackRecordsIn(root) {
  /** @type {string} */
  let listing;
  try {
    listing = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return []; // not a git repository: nothing is tracked, so nothing to report
  }
  return listing
    .split('\0')
    .filter(Boolean)
    .filter((p) => {
      const parts = p.split('/');
      return (
        parts.length >= 2 && parts.at(-2) === 'feedback' && RECORD_FILE.test(parts.at(-1) ?? '')
      );
    })
    .sort();
}

/** The tracker check's message for one. @param {string} path */
export const feedbackProblem = (path) =>
  `${path}: a feedback record is confidential and belongs only in the private store, never in the repository`;
