// The spelling check: tracked text files hold no British spelling from the list in words.mjs.
// This repository writes American English, in prose and in identifiers. A finding names the
// file, the line, the word and the American form.
//
// What is left alone, and how to say so:
//   - A line that holds the marker `spelling-ok`, for a line that has to name a British form: a
//     test that feeds one to the matcher, or code that reads an old name (design 16.5).
//   - An entry in ALLOWED, for a file that cannot carry a marker (JSON, a committed result) or a
//     file that is about the old names. An entry may limit itself to lines that contain a text.
//   - The generated copy under plugins/, which the build makes from the files checked here.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { americanOf, piecesOf } from './words.mjs';

/** The marker that excuses its line. */
export const MARKER = 'spelling-ok';

/**
 * @typedef {object} Allowed
 * @property {string} path a file's repository-relative path, or a folder's with a trailing slash
 * @property {string} [contains] only the lines that contain this text
 * @property {string} reason why the British form stays
 *
 * @typedef {object} Finding
 * @property {string} file
 * @property {number} line 1-based
 * @property {string} word the word as written
 * @property {string} american the same word in American spelling
 */

/** @type {readonly Allowed[]} */
export const ALLOWED = Object.freeze([
  {
    path: 'core/lib/spelling/words.mjs',
    reason: 'the list of forms the check refuses',
  },
  {
    path: 'core/test/spelling-check.test.mjs',
    reason: 'plants British forms to prove the check finds them',
  },
  {
    path: 'evals/baselines/',
    reason: 'a committed result; it names scenario and grader IDs as they were run',
  },
  {
    path: 'work/items/HITLD-121-american-english-throughout.md',
    reason: 'the item names the forms it replaces',
  },
]);

/**
 * Names that keep their British spelling wherever they appear, so a committed result that names
 * them still matches.
 * @type {readonly { text: string, reason: string }[]}
 */
export const PROTECTED = Object.freeze([
  {
    text: 'judgement-never-settles-a-call',
    reason: 'a scenario ID, and its file name: the committed eval baseline names it',
  },
]);

/** The line without its protected names. @param {string} line */
export const withoutProtected = (line) =>
  PROTECTED.reduce((l, p) => l.replaceAll(p.text, ' '), line);

/** Folders the check does not read. */
const SKIPPED = ['plugins/', 'node_modules/'];

/** @param {string} path @param {readonly Allowed[]} allowed @param {string} line */
function isAllowed(path, allowed, line) {
  return allowed.some(
    (a) =>
      (a.path.endsWith('/') ? path.startsWith(a.path) : path === a.path) &&
      (a.contains === undefined || line.includes(a.contains)),
  );
}

/**
 * The British spellings in one text.
 * @param {string} text @param {string} [file]
 * @param {{ allowed?: readonly Allowed[] }} [options]
 * @returns {Finding[]}
 */
export function checkText(text, file = '', { allowed = ALLOWED } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes(MARKER) || isAllowed(file, allowed, line)) return;
    for (const [run] of withoutProtected(line).matchAll(/[A-Za-z]+/g)) {
      for (const piece of piecesOf(run)) {
        const american = americanOf(piece);
        if (american !== null) findings.push({ file, line: index + 1, word: piece, american });
      }
    }
  });
  return findings;
}

/**
 * The tracked files of a repository.
 * @param {string} root
 * @returns {string[]}
 */
export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

/**
 * Check the tracked text files under `root`, or the named files.
 * @param {string} root
 * @param {{ files?: string[], allowed?: readonly Allowed[] }} [options]
 * @returns {{ checked: number, findings: Finding[] }}
 */
export function checkSpelling(root, { files, allowed = ALLOWED } = {}) {
  const paths = (files ?? trackedFiles(root)).filter((p) => !SKIPPED.some((s) => p.startsWith(s)));
  /** @type {Finding[]} */
  const findings = [];
  let checked = 0;
  for (const path of paths) {
    let buffer;
    try {
      buffer = readFileSync(join(root, path));
    } catch {
      continue; // a tracked file that is gone, or not a regular file
    }
    if (buffer.includes(0)) continue; // binary
    checked++;
    findings.push(...checkText(buffer.toString('utf8'), path, { allowed }));
  }
  return { checked, findings };
}

/**
 * The report to print: one line per finding, then the count.
 * @param {{ checked: number, findings: Finding[] }} report
 * @returns {string}
 */
export function formatSpellingReport({ checked, findings }) {
  if (findings.length === 0) return `spelling: ${checked} files, no British spellings`;
  const lines = findings.map(
    (f) => `${f.file}:${f.line}: "${f.word}" is British; write "${f.american}"`,
  );
  lines.push(
    `spelling: ${findings.length} British ${findings.length === 1 ? 'spelling' : 'spellings'} in ${checked} files. Write American English; a line that must name a British form carries "${MARKER}", or has an entry in ALLOWED (core/lib/spelling/check.mjs)`,
  );
  return lines.join('\n');
}
