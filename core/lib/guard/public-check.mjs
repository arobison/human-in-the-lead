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
  return addedLinesIn(git(cwd, ['show', '--format=', ...PATCH, commit]));
}

/** How a commit's patch is written, for addedLines and checkPublicRange alike. */
const PATCH = ['--no-color', '--no-ext-diff', '--no-renames', '--unified=0'];

/**
 * The lines a patch adds, by file.
 * @param {string} patch @returns {{ path: string, line: number, text: string }[]}
 */
function addedLinesIn(patch) {
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

/** @param {string} path whether the placement rule covers a path */
const placed = (path) => /(^|\/)\.human-in-the-lead\/(policy|store-devices)\.json$/.test(path);

/**
 * The files at `<commit>:<path>`, read by one `git cat-file --batch`, as `git show
 * <commit>:<path>` prints them; a path the commit does not hold (deleted in it) is left out.
 * @param {string} cwd @param {string[]} specs `<commit>:<path>`, each without a newline
 * @returns {Map<string, string>}
 */
function readSpecs(cwd, specs) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const wanted = [...new Set(specs)];
  if (!wanted.length) return out;
  const r = spawnSync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${wanted.join('\n')}\n`,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`git cat-file: ${(r.stderr ?? '').toString().trim() || `exit ${r.status}`}`);
  }
  const buf = r.stdout;
  let p = 0;
  for (const spec of wanted) {
    const eol = buf.indexOf(10, p);
    if (eol < 0) break;
    const header = buf.subarray(p, eol).toString('utf8');
    const m = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(header);
    if (!m) {
      p = eol + 1; // "<spec> missing": deleted in that commit, and git show fails on it too
      continue;
    }
    const start = eol + 1;
    const end = start + Number(m[2]);
    if (m[1] === 'blob') out.set(spec, buf.subarray(start, end).toString('utf8'));
    p = end + 1;
  }
  return out;
}

/**
 * The placement rule on the files a tree or a commit holds at the two paths it covers.
 * @param {string} commit @param {string[]} paths
 * @param {Map<string, string>} files `<commit>:<path>` to its text, from readSpecs
 * @returns {Finding[]}
 */
function placementIn(commit, paths, files) {
  /** @type {Finding[]} */
  const out = [];
  for (const path of paths) {
    if (!placed(path)) continue;
    const text = files.get(`${commit}:${path}`);
    if (text === undefined) continue; // deleted in this commit
    const r = judgePlacement(path, text);
    if (r) out.push({ commit, where: path, line: null, rule: r.rule, message: r.message });
  }
  return out;
}

/**
 * Each commit's changed paths (as `git diff-tree -r --root --name-only` names them), patch (as
 * `git show --format=` prints it) and message (as `git log -1 --format=%B`), from one `git log`.
 * Each commit's section starts with NUL, its name, NUL; its message ends at the next NUL, which a
 * message cannot hold; then come its raw diff lines and its patch, up to the next commit's start,
 * found by that commit's name.
 * @param {string} cwd @param {string[]} commits oldest first, no merges, as commitsIn lists them
 * @param {string[]} range what commitsIn listed them from
 * @returns {Map<string, { changed: string[], patch: string, message: string }> | null} null when
 *   the answer does not line up with the commits
 */
function readCommits(cwd, commits, range) {
  /** @type {Map<string, { changed: string[], patch: string, message: string }>} */
  const out = new Map();
  if (!commits.length) return out;
  const raw = git(cwd, [
    'log',
    '--reverse',
    '--no-merges',
    '--root',
    '-r',
    '--raw',
    '-p',
    ...PATCH,
    '--format=%x00%H%x00%B%x00',
    ...range,
  ]);
  let at = 0;
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const head = `\0${c}\0`;
    if (!raw.startsWith(head, at)) return null;
    const bodyStart = at + head.length;
    const bodyEnd = raw.indexOf('\0', bodyStart);
    if (bodyEnd < 0) return null;
    const last = i + 1 === commits.length;
    const next = last ? raw.length : raw.indexOf(`\0${commits[i + 1]}\0`, bodyEnd + 1);
    if (next < 0) return null;
    const lines = raw.slice(bodyEnd + 1, next).split('\n');
    const diffAt = lines.findIndex((l) => l.startsWith('diff --git '));
    const changed = (diffAt < 0 ? lines : lines.slice(0, diffAt))
      .filter((l) => l.startsWith(':') && l.includes('\t'))
      .map((l) => l.slice(l.indexOf('\t') + 1));
    out.set(c, {
      changed,
      patch: diffAt < 0 ? '' : lines.slice(diffAt).join('\n'),
      message: `${raw.slice(bodyStart, bodyEnd)}\n`,
    });
    at = next;
  }
  return out;
}

/**
 * Check the commits from..to: a fixed number of git processes however many commits there are
 * (the listing, one log with every commit's raw diff, patch and message, the last tree, and one
 * read of the placement files).
 * @param {{ cwd: string, from?: string, to: string }} o
 * @returns {{ commits: number, findings: Finding[] }}
 */
export function checkPublicRange(o) {
  const commits = commitsIn(o.cwd, o.from, o.to);
  const range = isNull(o.from) ? ['-1', o.to] : [`${o.from}..${o.to}`];
  const read = readCommits(o.cwd, commits, range);
  /** @param {string} c */
  const commitOf = (c) =>
    read?.get(c) ?? {
      changed: git(o.cwd, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', c])
        .split('\n')
        .filter(Boolean),
      patch: git(o.cwd, ['show', '--format=', ...PATCH, c]),
      message: git(o.cwd, ['log', '-1', '--format=%B', c]),
    };
  const each = commits.map((c) => ({ c, ...commitOf(c) }));
  const tree = git(o.cwd, ['ls-tree', '-r', '--name-only', o.to]).split('\n').filter(Boolean);
  const head = git(o.cwd, ['rev-parse', o.to]).trim();
  const files = readSpecs(o.cwd, [
    ...each.flatMap((x) => x.changed.filter(placed).map((p) => `${x.c}:${p}`)),
    ...tree.filter(placed).map((p) => `${head}:${p}`),
  ]);
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
  for (const { c, changed, patch, message } of each) {
    for (const f of placementIn(c, changed, files)) add(f);
    for (const a of addedLinesIn(patch)) {
      if (findEmails(a.text).length) {
        add({ commit: c, where: a.path, line: a.line, rule: 'email', message: EMAIL_MESSAGE });
      }
    }
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
  // The tree's own copy is reported once, unless a commit in the range already named it.
  for (const f of placementIn(head, tree, files)) {
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
