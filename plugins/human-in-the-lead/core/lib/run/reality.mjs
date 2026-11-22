// What git can say about a run's dispatches, for `hitld run resume` and `rebuild` on the command
// line. It cannot say whether an executor is still running: only the harness knows that, and the
// core never calls a harness. The orchestrator passes that in (the `live` option).
//
// Also what the watchdog samples of a running executor without asking it (design part 5.2): its
// branch and worktree, and a headless run's process and output.
//
// Git is asked once per look, not once per dispatch: a snapshot reads every worktree (`worktree
// list`) and every branch with its commits ahead of the main branch (`for-each-ref` with
// ahead-behind, git 2.41 or later) in two processes. Starting a process costs a few milliseconds
// on macOS and Linux but most of a fifth of a second on Windows, so per-dispatch calls add up to
// minutes there. Only a worktree's uncommitted changes are still read one worktree at a time.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { realPath } from '../env/fsx.mjs';

/**
 * @typedef {import('./run.mjs').Reality} Reality
 * @typedef {import('../ledger/inflight.mjs').InFlight} InFlight
 */

/**
 * @param {string} cwd a directory in the repository
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }).trim();
}

/** A path as a key: canonical where it exists, and on Windows without regard to case. @param {string} p */
function pathKey(p) {
  let k;
  try {
    k = realPath(p);
  } catch {
    k = resolve(p);
  }
  return process.platform === 'win32' ? k.toLowerCase() : k;
}

/**
 * What git shows of the repository's branches and worktrees at one moment.
 * @typedef {object} GitSnapshot
 * @property {string[]} names the branches, as `for-each-ref --format=%(refname:short)` names them
 * @property {(branch: string) => string | null} tip the commit a branch is at; null when it does not exist
 * @property {(branch: string) => number} aheadOfBranch commits on the branch that the main branch
 *   lacks; throws when git cannot count them (no main branch)
 * @property {(commit: string) => number} aheadOfCommit the same for a commit
 * @property {(branch: string) => string | null} worktreeOf the worktree with the branch checked out
 * @property {(path: string) => { head: string, branch: string | null } | null} worktreeAt a
 *   worktree's commit and branch, by its path; null for a path git does not list
 */

/**
 * Read the branches and worktrees in two git processes. A part git cannot read is empty.
 * @param {{ cwd: string, mainBranch?: string }} options
 * @returns {GitSnapshot}
 */
export function gitSnapshot({ cwd, mainBranch = 'main' }) {
  /** @type {string[]} */
  const names = [];
  /** @type {Map<string, { head: string, ahead: number | null }>} */
  const branches = new Map();
  const fields = '%(refname)%00%(refname:short)%00%(objectname)';
  /** @param {string} out @param {boolean} counted */
  const readRefs = (out, counted) => {
    for (const line of out.split('\n')) {
      const [full, short, head, ab] = line.split('\0');
      if (!full?.startsWith('refs/heads/') || !head) continue;
      names.push(short);
      const ahead = counted ? Number(ab?.split(' ')[0]) : NaN;
      branches.set(full.slice('refs/heads/'.length), {
        head,
        ahead: Number.isInteger(ahead) ? ahead : null,
      });
    }
  };
  try {
    readRefs(
      git(cwd, [
        'for-each-ref',
        `--format=${fields}%00%(ahead-behind:${mainBranch})`,
        'refs/heads/',
      ]),
      true,
    );
  } catch {
    // git before 2.41 has no ahead-behind, and none can be counted without a main branch: list
    // the branches alone, and count each one when it is asked about
    try {
      readRefs(git(cwd, ['for-each-ref', `--format=${fields}`, 'refs/heads/']), false);
    } catch {
      // not a repository, or git is missing: nothing is known
    }
  }

  /** @type {Map<string, string>} */
  const byBranch = new Map();
  /** @type {Map<string, { head: string, branch: string | null }>} */
  const byPath = new Map();
  try {
    /** @type {{ path: string, head: string, branch: string | null } | null} */
    let cur = null;
    const flush = () => {
      if (!cur) return;
      byPath.set(pathKey(cur.path), { head: cur.head, branch: cur.branch });
      if (cur.branch && !byBranch.has(cur.branch)) byBranch.set(cur.branch, cur.path);
    };
    for (const line of git(cwd, ['worktree', 'list', '--porcelain']).split('\n')) {
      if (line.startsWith('worktree ')) {
        flush();
        cur = { path: line.slice('worktree '.length), head: '', branch: null };
      } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length);
      else if (cur && line.startsWith('branch refs/heads/')) {
        cur.branch = line.slice('branch refs/heads/'.length);
      }
    }
    flush();
  } catch {
    // Not a repository, or git is missing: no worktree known.
  }

  /** @type {Map<string, number>} */
  const counted = new Map();
  /** @param {string} rev */
  const count = (rev) => {
    let n = counted.get(rev);
    if (n === undefined) {
      n = Number(git(cwd, ['rev-list', '--count', `${mainBranch}..${rev}`]));
      counted.set(rev, n);
    }
    return n;
  };
  return {
    names,
    tip: (branch) => branches.get(branch)?.head ?? null,
    aheadOfBranch(branch) {
      const b = branches.get(branch);
      if (b?.ahead !== null && b?.ahead !== undefined) return b.ahead;
      return count(`refs/heads/${branch}`);
    },
    aheadOfCommit: (commit) => count(commit),
    worktreeOf: (branch) => byBranch.get(branch) ?? null,
    worktreeAt: (path) => byPath.get(pathKey(path)) ?? null,
  };
}

/** A commit ID that names nothing: the HEAD of a worktree on a branch with no commit yet. */
const NO_COMMIT = /^0+$/;

/**
 * The commit a worktree is at and its commits ahead of the main branch, from the snapshot when
 * git listed the worktree, else from git in the worktree itself.
 * @param {GitSnapshot} snap @param {string} worktree @param {string} mainBranch
 * @returns {{ head: string, commits: number }}
 */
function worktreeHead(snap, worktree, mainBranch) {
  const listed = snap.worktreeAt(worktree);
  if (listed && listed.head && !NO_COMMIT.test(listed.head)) {
    return {
      head: listed.head,
      commits: listed.branch ? snap.aheadOfBranch(listed.branch) : snap.aheadOfCommit(listed.head),
    };
  }
  return {
    head: git(worktree, ['rev-parse', 'HEAD']),
    commits: Number(git(worktree, ['rev-list', '--count', `${mainBranch}..HEAD`])),
  };
}

/**
 * @param {{ cwd: string, mainBranch?: string }} options mainBranch: policy.json merge.main_branch,
 *   which callers pass; 'main' only where no policy is loaded
 * @returns {Reality}
 */
export function gitReality({ cwd, mainBranch = 'main' }) {
  /** @type {GitSnapshot | null} */
  let snap = null;
  // One look at git serves every question asked of this reality.
  const snapshot = () => (snap ??= gitSnapshot({ cwd, mainBranch }));
  return {
    branches: () => snapshot().names,
    hasCommits(entry) {
      try {
        const worktree = entry.worktree && existsSync(entry.worktree) ? entry.worktree : null;
        if (worktree) return worktreeHead(snapshot(), worktree, mainBranch).commits > 0;
        const ref = entry.branch;
        if (!ref || !snapshot().names.includes(ref)) return false;
        return snapshot().aheadOfBranch(ref) > 0;
      } catch {
        return false;
      }
    },
  };
}

/**
 * What git shows of an executor's work, as a worktree progress signal (core/lib/dispatch/progress.mjs):
 * the commit its branch is at, its commits ahead of the main branch, and its uncommitted changes
 * (a hash over their paths, sizes and modification times, so further edits to a changed file are
 * seen). The worktree is the dispatch's recorded one, or whichever worktree has its branch checked
 * out (a harness that made its own); without one, the branch alone. Null when neither exists.
 * @param {InFlight} entry
 * @param {{ cwd: string, mainBranch?: string, snapshot?: GitSnapshot }} options cwd: the primary
 *   checkout; snapshot: one look at git shared by every dispatch sampled at once (gitSnapshot)
 * @returns {{ source: 'worktree', head: string, commits: number, dirty?: number, changed?: string } | null}
 */
export function worktreeSignal(entry, { cwd, mainBranch = 'main', snapshot }) {
  const snap = snapshot ?? gitSnapshot({ cwd, mainBranch });
  const recorded = entry.worktree && existsSync(entry.worktree) ? entry.worktree : null;
  const worktree = recorded ?? (entry.branch ? snap.worktreeOf(entry.branch) : null);
  try {
    let head;
    let commits;
    if (worktree) {
      ({ head, commits } = worktreeHead(snap, worktree, mainBranch));
    } else {
      if (!entry.branch) return null;
      const tip = snap.tip(entry.branch);
      if (!tip) return null;
      head = tip;
      commits = snap.aheadOfBranch(entry.branch);
    }
    /** @type {{ source: 'worktree', head: string, commits: number, dirty?: number, changed?: string }} */
    const out = { source: 'worktree', head, commits };
    if (worktree) {
      const paths = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'])
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3));
      out.dirty = paths.length;
      if (paths.length) {
        const h = createHash('sha256');
        for (const p of paths.sort()) {
          let stamp = 'gone';
          try {
            const st = statSync(join(worktree, p));
            stamp = `${st.size}:${st.mtimeMs}`;
          } catch {
            // Deleted, or the old side of a rename.
          }
          h.update(`${p}\0${stamp}\n`);
        }
        out.changed = h.digest('hex');
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * A headless run's liveness and output, as a process progress signal: its process is the one whose
 * ID the run's command wrote to `pidFile`, and its output is what it has written to `outputFile`.
 * `result`: whether the output ends with the run's result event, which a run writes only as it
 * ends (`--output-format stream-json` writes events as JSON lines while it runs, so output alone
 * does not say it finished, HITLD-746). Null when there is no process ID on file (the run never
 * started, or its command did not record one).
 * @param {{ pidFile: string, outputFile: string }} files
 * @returns {{ source: 'process', alive: boolean, output_bytes: number, result: boolean } | null}
 */
export function processSignal({ pidFile, outputFile }) {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 1) return null;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    // EPERM: it exists but belongs to someone else, so it is alive.
    alive = /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
  let output = 0;
  try {
    output = statSync(outputFile).size;
  } catch {
    output = 0;
  }
  return {
    source: 'process',
    alive,
    output_bytes: output,
    result: output > 0 && endsWithResult(outputFile, output),
  };
}

/** How much of the end of a run's output is read for its last event. */
const TAIL_BYTES = 1 << 20;

/**
 * Whether a run's output ends with a result event: its last JSON line, or the one document
 * `--output-format json` writes, has type `result`. Only the end of the file is read.
 * @param {string} file @param {number} size
 */
function endsWithResult(file, size) {
  let text;
  try {
    const fd = openSync(file, 'r');
    try {
      const length = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, size - length);
      text = buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  /** @param {string} t @param {boolean} whole the one document, which is the result unless it says otherwise */
  const isResult = (t, whole) => {
    try {
      const v = JSON.parse(t);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      return v.type === 'result' || (whole && v.type === undefined);
    } catch {
      return false;
    }
  };
  if (size <= TAIL_BYTES && isResult(text, true)) return true;
  const last = text.trimEnd().split('\n').at(-1) ?? '';
  return isResult(last, false);
}
