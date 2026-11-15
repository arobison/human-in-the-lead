// What CI checks of the private rules without the private term list (design part 10.3, rule 7).
// CI has no private store, so it cannot know the owner's terms; it checks what needs none:
//
//   store-address   a .human-in-the-lead/policy.json that sets store.remote.url, the store
//                   placement rule the commit guard applies (store-placement.mjs)
//   store-devices   a committed .human-in-the-lead/store-devices.json, the same rule
//   email           an email address that is neither a noreply one nor on a domain reserved for
//                   examples, in a line a commit adds or in a commit message
//
// Each commit in the range is checked, merge commits aside (the DCO check exempts them too), and
// the placement rule is checked on the last commit's whole tree as well. A finding names the commit,
// the file or message and the line, never the address: a CI log of a public repository is public.

import { spawnSync } from 'node:child_process';
import { judgePlacement } from './store-placement.mjs';
import { findEmails } from './private-terms.mjs';

/**
 * @typedef {{ commit: string, where: string, line: number | null, rule: 'store-address' | 'store-devices' | 'email', message: string }} Finding
 */

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ${args[0]}: ${(r.stderr ?? '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/** @param {string | undefined} sha */
const isNull = (sha) => !sha || /^0+$/.test(sha);

/**
 * The commits from..to, oldest first, without merge commits. With no `from` (or an all-zero one,
 * a new branch), only `to` itself.
 * @param {string} cwd @param {string | undefined} from @param {string} to
 */
export function commitsIn(cwd, from, to) {
  const range = isNull(from) ? ['-1', to] : [`${from}..${to}`];
  return git(cwd, ['rev-list', '--reverse', '--no-merges', ...range])
    .split('\n')
    .filter(Boolean);
}

/**
 * The lines a commit adds, by file, from its patch.
 * @param {string} cwd @param {string} commit
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function addedLines(cwd, commit) {
  const patch = git(cwd, [
    'show',
    '--format=',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--unified=0',
    commit,
  ]);
  /** @type {{ path: string, line: number, text: string }[]} */
  const out = [];
  let path = '';
  let line = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+++ ')) {
      path = l.startsWith('+++ b/') ? l.slice(6) : '';
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (path && l.startsWith('+')) {
      out.push({ path, line, text: l.slice(1) });
      line++;
    }
  }
  return out;
}

const EMAIL_MESSAGE =
  "an email address that is not a noreply one; use a noreply address (a forge gives one) or a placeholder on example.com, and keep a person's own address out of the repository";

/**
 * The placement rule on the files a tree or a commit holds at the two paths it covers.
 * @param {string} cwd @param {string} commit @param {string[]} paths
 * @returns {Finding[]}
 */
function placementIn(cwd, commit, paths) {
  /** @type {Finding[]} */
  const out = [];
  for (const path of paths) {
    if (!/(^|\/)\.human-in-the-lead\/(policy|store-devices)\.json$/.test(path)) continue;
    const shown = spawnSync('git', ['show', `${commit}:${path}`], { cwd, encoding: 'utf8' });
    if (shown.status !== 0) continue; // deleted in this commit
    const r = judgePlacement(path, shown.stdout);
    if (r) out.push({ commit, where: path, line: null, rule: r.rule, message: r.message });
  }
  return out;
}

/**
 * Check the commits from..to.
 * @param {{ cwd: string, from?: string, to: string }} o
 * @returns {{ commits: number, findings: Finding[] }}
 */
export function checkPublicRange(o) {
  const commits = commitsIn(o.cwd, o.from, o.to);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {Finding} f */
  const add = (f) => {
    const key = `${f.commit}\0${f.where}\0${f.rule}\0${f.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  for (const c of commits) {
    const changed = git(o.cwd, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', c])
      .split('\n')
      .filter(Boolean);
    for (const f of placementIn(o.cwd, c, changed)) add(f);
    for (const a of addedLines(o.cwd, c)) {
      if (findEmails(a.text).length) {
        add({ commit: c, where: a.path, line: a.line, rule: 'email', message: EMAIL_MESSAGE });
      }
    }
    const message = git(o.cwd, ['log', '-1', '--format=%B', c]);
    for (const e of findEmails(message)) {
      add({
        commit: c,
        where: 'commit message',
        line: e.line,
        rule: 'email',
        message: EMAIL_MESSAGE,
      });
    }
  }
  const tree = git(o.cwd, ['ls-tree', '-r', '--name-only', o.to]).split('\n').filter(Boolean);
  const head = git(o.cwd, ['rev-parse', o.to]).trim();
  // The tree's own copy is reported once, unless a commit in the range already named it.
  for (const f of placementIn(o.cwd, head, tree)) {
    if (!findings.some((x) => x.where === f.where && x.rule === f.rule)) add(f);
  }
  return { commits: commits.length, findings };
}

/**
 * The report CI prints: one line per finding, then a summary.
 * @param {{ commits: number, findings: Finding[] }} r
 */
export function formatPublicReport(r) {
  const lines = r.findings.map(
    (f) =>
      `${f.commit.slice(0, 12)} ${f.where}${f.line === null ? '' : `:${f.line}`}: ${f.rule}: ${f.message}`,
  );
  lines.push(
    r.findings.length
      ? `public check: ${r.findings.length} finding(s) in ${r.commits} commit(s). The store's address and device list never go in the repository (design 0003), and a person's email address only as a noreply one (design part 10.3)`
      : `public check: ${r.commits} commit(s), no store address, device list or personal email address`,
  );
  return lines.join('\n');
}
