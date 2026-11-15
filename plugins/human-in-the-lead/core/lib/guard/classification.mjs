// The commit guard's classification rule (design part 10.3, rule 3): a repository holds nothing
// above its classification ceiling. One rule, used in three places:
//
//   the pre-commit hook   `hitld check classification --staged`, installed by `hitld install`
//   the merge             every commit a branch would bring to main, in either merge mode
//   the tracker check     `hitld work check`, over the whole tree
//
// A file's level is the `classification` key of its front matter; a file without one takes the
// project default (tracker.json default_classification, design part 3.4). A file whose path is
// listed in policy project.private_paths is never public, whatever it says. Anything above the
// ceiling (policy project.classification_ceiling) is refused, with the file and the rule named.
//
// Beside it, two more rules that hold whatever the ceiling: the store placement rule
// (store-placement.mjs), which keeps the private store's address and device list out of the
// repository, and the private term rule (private-terms.mjs), which refuses a file, or a commit
// message at merge, that holds a term from the private term list. The terms come in `rules.terms`,
// loaded from the private store by the caller; a refusal names the term's kind and the line, never
// the term.
//
// The hook can be skipped (`git commit --no-verify`); the merge check cannot, so it is the one
// that enforces. File contents are only read as text and matched; nothing in them is run.

import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from '../precedent/glob.mjs';
import { judgePlacement } from './store-placement.mjs';
import { findTerms, matchMessage } from './private-terms.mjs';

/** The levels, lowest first (design part 3, classification levels). */
export const LEVELS = Object.freeze(['public', 'internal', 'confidential', 'secret']);

/** How much of a file is read to find its front matter. */
export const READ_LIMIT = 1024 * 1024;
/** How much of a file is read when private terms are checked: all of it, up to this. */
export const TERM_READ_LIMIT = 64 * 1024 * 1024;

/**
 * @typedef {object} Rules
 * @property {string} ceiling the highest level the repository may hold
 * @property {string} defaultClassification the level of a file whose front matter does not say
 * @property {string[]} privatePaths globs of paths that are never public
 * @property {import('./private-terms.mjs').Matcher[]} [terms] the private terms; none when not given
 *
 * @typedef {'front-matter' | 'project-default' | 'private-path' | 'unreadable' | 'private-term' | import('./store-placement.mjs').PlacementRule} RuleName
 * @typedef {{ path: string, rule: RuleName, classification: string | null, message: string,
 *   line?: number, kind?: string, term_id?: string | null, commit?: string }} Refused
 *   for a private term: the line it is on, its kind and its ID on the list (never the term)
 * @typedef {{ files: number, refused: Refused[] }} GuardResult
 */

/** The strictest rules: what applies when nothing says otherwise. @type {Readonly<Rules>} */
export const STRICT = Object.freeze({
  ceiling: 'public',
  defaultClassification: 'public',
  privatePaths: [],
});

/** @param {string} level */
const rank = (level) => LEVELS.indexOf(level);

/**
 * The rules from a loaded policy and the tracker's default classification.
 * @param {Record<string, any>} policy @param {string | undefined} defaultClassification
 * @returns {Rules}
 */
export function rulesFrom(policy, defaultClassification) {
  return {
    ceiling: policy?.project?.classification_ceiling ?? STRICT.ceiling,
    defaultClassification: defaultClassification ?? STRICT.defaultClassification,
    privatePaths: policy?.project?.private_paths ?? [],
  };
}

/**
 * The `classification` values in a file's front matter. Front matter is a first line `---` and a
 * closing line `---` or `...`; only keys at the top level count.
 * @param {Buffer | string} head the start of the file
 * @param {boolean} truncated whether the file goes on past `head`
 * @returns {{ values: string[] } | { error: string }}
 */
export function frontMatterClassification(head, truncated) {
  let text = typeof head === 'string' ? head : head.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!/^---[ \t]*(\r?\n|$)/.test(text)) return { values: [] };
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line !== '---' && line !== '...') continue;
    /** @type {string[]} */
    const values = [];
    for (const l of lines.slice(1, i)) {
      const m = l.match(/^classification[ \t]*:(.*)$/);
      if (!m) continue;
      let v = m[1].replace(/[ \t]+#.*$/, '').trim();
      if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1).trim();
      values.push(v);
    }
    return { values };
  }
  // Never closed: not front matter, unless the read stopped before its end.
  if (truncated) {
    return {
      error: `its front matter does not close within the first ${READ_LIMIT / 1024 / 1024} MiB, so its classification cannot be read`,
    };
  }
  return { values: [] };
}

/**
 * The rule applied to one file: why it is refused, or null.
 * @param {string} path repository-relative, with "/" separators
 * @param {string[] | { error: string }} declared the front matter's classification values, or why
 *   they cannot be read
 * @param {Rules} rules
 * @returns {Refused | null}
 */
export function judge(path, declared, rules) {
  if (!Array.isArray(declared)) {
    return { path, rule: 'unreadable', classification: null, message: declared.error };
  }
  const unknown = declared.find((v) => rank(v) < 0);
  if (unknown !== undefined) {
    return {
      path,
      rule: 'front-matter',
      classification: unknown,
      message: `classification "${unknown}" in its front matter is not one of ${LEVELS.join(', ')}`,
    };
  }
  const ceiling = rules.ceiling;
  if (declared.length) {
    const level = declared.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    if (rank(level) > rank(ceiling)) {
      return {
        path,
        rule: 'front-matter',
        classification: level,
        message: `classification "${level}" in its front matter is above the repository's ceiling "${ceiling}"`,
      };
    }
  } else if (rank(rules.defaultClassification) > rank(ceiling)) {
    return {
      path,
      rule: 'project-default',
      classification: rules.defaultClassification,
      message: `no classification in its front matter, so the project default "${rules.defaultClassification}" (tracker.json default_classification) applies, above the repository's ceiling "${ceiling}"`,
    };
  }
  if (rank(ceiling) < rank('internal')) {
    const glob = rules.privatePaths.find((g) => matchesAny([g], path));
    if (glob !== undefined) {
      return {
        path,
        rule: 'private-path',
        classification: 'internal',
        message: `its path matches "${glob}" in policy project.private_paths, so it is not public, and the repository's ceiling is "${ceiling}"`,
      };
    }
  }
  return null;
}

/**
 * The private term rule on a text: the first term it holds, or null.
 * @param {string} path what to call it in the refusal
 * @param {string} text @param {Rules} rules
 * @returns {Refused | null}
 */
export function judgeTerms(path, text, rules) {
  if (!rules.terms?.length) return null;
  const found = findTerms(text, rules.terms, { limit: 20 });
  if (!found.length) return null;
  const first = found[0];
  const more = found.length > 1 ? ` (and ${found.length - 1} more)` : '';
  return {
    path,
    rule: 'private-term',
    classification: null,
    line: first.line,
    kind: first.kind,
    term_id: first.id,
    message: `${matchMessage(first)}${more}`,
  };
}

/**
 * Judge one file from the start of its content (all of it, when private terms are checked).
 * @param {string} path @param {Buffer} head @param {boolean} truncated @param {Rules} rules
 */
export const judgeContent = (path, head, truncated, rules) => {
  const placed = judgePlacement(path, head);
  if (placed) return placed;
  if (rules.terms?.length) {
    // The path is published as much as the content.
    const named = findTerms(path, rules.terms, { limit: 1 })[0];
    if (named) {
      return {
        path,
        rule: /** @type {const} */ ('private-term'),
        classification: null,
        kind: named.kind,
        term_id: named.id,
        message: `its path holds a private ${named.kind} from the private term list; name the file by its role, never by name`,
      };
    }
    if (truncated) {
      return {
        path,
        rule: /** @type {const} */ ('unreadable'),
        classification: null,
        message: `it is larger than ${TERM_READ_LIMIT / 1024 / 1024} MiB, so it cannot be checked for private terms`,
      };
    }
    const termed = judgeTerms(path, head.toString('utf8'), rules);
    if (termed) return termed;
  }
  const fm = frontMatterClassification(head, truncated);
  return judge(path, 'error' in fm ? fm : fm.values, rules);
};

/** How much to read of a file under these rules. @param {Rules} rules */
const limitFor = (rules) => (rules.terms?.length ? TERM_READ_LIMIT : READ_LIMIT);

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').toString().trim() || String(r.error ?? `exit ${r.status}`);
    throw new Error(`git ${args[0]}: ${why}`);
  }
  return r.stdout.toString('utf8');
}

/**
 * The start of a blob, read from git's object store.
 * @param {string} cwd @param {string} sha @param {number} [limit]
 * @returns {{ head: Buffer, truncated: boolean }}
 */
function readBlob(cwd, sha, limit = READ_LIMIT) {
  // The sha comes from git's own raw diff output, and is checked to be one.
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`not an object name: ${sha}`);
  const r = spawnSync('git', ['cat-file', 'blob', sha], { cwd, maxBuffer: limit });
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code;
  if (code === 'ENOBUFS' && r.stdout?.length) return { head: r.stdout, truncated: true };
  if (r.status !== 0) throw new Error(`git cat-file ${sha}: ${(r.stderr ?? '').toString().trim()}`);
  return { head: r.stdout, truncated: false };
}

/**
 * Added or changed blobs from `git diff --raw -z --no-renames` style output: path and new sha.
 * Submodules (mode 160000) carry no content of their own and are skipped.
 * @param {string} raw @returns {{ path: string, sha: string }[]}
 */
export function parseRaw(raw) {
  const parts = raw.split('\0');
  /** @type {{ path: string, sha: string }[]} */
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const meta = parts[i].match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/);
    if (!meta) continue;
    const path = parts[++i];
    const [, , mode, , sha, status] = meta;
    if (!'AMT'.includes(status) || mode === '160000' || /^0+$/.test(sha)) continue;
    out.push({ path, sha });
  }
  return out;
}

/** @param {string} cwd @param {{ path: string, sha: string }[]} blobs @param {Rules} rules */
function judgeBlobs(cwd, blobs, rules) {
  const seen = new Set();
  /** @type {Refused[]} */
  const refused = [];
  for (const b of blobs) {
    const key = `${b.sha} ${b.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { head, truncated } = readBlob(cwd, b.sha, limitFor(rules));
    const r = judgeContent(b.path, head, truncated, rules);
    if (r) refused.push(r);
  }
  return { files: seen.size, refused };
}

const RAW = ['--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=AMT'];

/**
 * The files staged for the next commit, as they are in the index.
 * @param {string} repoRoot @param {Rules} rules @returns {GuardResult}
 */
export function checkStaged(repoRoot, rules) {
  const raw = git(repoRoot, ['diff', '--cached', ...RAW]);
  return judgeBlobs(repoRoot, parseRaw(raw), rules);
}

/**
 * A commit message checked for private terms.
 * @param {string} commit its full name @param {string} message @param {Rules} rules
 * @returns {Refused | null}
 */
export function judgeMessage(commit, message, rules) {
  const r = judgeTerms(`commit ${commit.slice(0, 12)} message`, message, rules);
  return r ? { ...r, commit } : null;
}

/**
 * Every file each commit in from..to adds or changes, as that commit has it, and, when private
 * terms are given, each commit's message. A file that one commit adds and a later one removes is
 * still refused: the history would hold it.
 * @param {string} cwd a working tree of the repository @param {string} from @param {string} to
 * @param {Rules} rules @returns {GuardResult}
 */
export function checkCommits(cwd, from, to, rules) {
  const commits = git(cwd, ['rev-list', '--reverse', `${from}..${to}`])
    .split('\n')
    .filter(Boolean);
  /** @type {{ path: string, sha: string }[]} */
  const blobs = [];
  /** @type {Refused[]} */
  const messages = [];
  for (const c of commits) {
    blobs.push(
      ...parseRaw(git(cwd, ['diff-tree', '-r', '-m', '--root', '--no-commit-id', ...RAW, c])),
    );
    if (rules.terms?.length) {
      const r = judgeMessage(c, git(cwd, ['log', '-1', '--format=%B', c]), rules);
      if (r) messages.push(r);
    }
  }
  const judged = judgeBlobs(cwd, blobs, rules);
  return { files: judged.files, refused: [...judged.refused, ...messages] };
}

/**
 * The start of a file on disk; a link or anything but a regular file is not read.
 * @param {string} full @param {number} [limit]
 * @returns {{ head: Buffer, truncated: boolean } | null}
 */
function readHead(full, limit = READ_LIMIT) {
  let st;
  try {
    st = lstatSync(full);
  } catch {
    return null; // listed by git but gone from the working tree
  }
  if (!st.isFile()) return null;
  const fd = openSync(full, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, limit));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return { head: buf.subarray(0, n), truncated: st.size > limit };
  } finally {
    closeSync(fd);
  }
}

/**
 * The whole tree: every file git tracks or would add (untracked and not ignored), as it is in the
 * working tree.
 * @param {string} repoRoot @param {Rules} rules
 * @returns {GuardResult}
 */
export function checkTree(repoRoot, rules) {
  const paths = [
    ...new Set(
      git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .split('\0')
        .filter(Boolean),
    ),
  ];
  let files = 0;
  /** @type {Refused[]} */
  const refused = [];
  for (const path of paths) {
    const read = readHead(join(repoRoot, path), limitFor(rules));
    if (!read) continue;
    files++;
    const r = judgeContent(path, read.head, read.truncated, rules);
    if (r) refused.push(r);
  }
  return { files, refused };
}

/** The refusals as problem lines, "<path>: <why>". @param {Refused[]} refused */
export const problemLines = (refused) => refused.map((r) => `${r.path}: ${r.message}`);

/** Whether a refusal is the private term rule's. @param {Refused} r */
export const isTermRefusal = (r) => r.rule === 'private-term';
