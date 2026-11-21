// The basic local merge queue (design part 14): main moves only to a commit that passed the full
// suite as part of its batch.
//
//   1. order     dependency order among the waiting branches, then the order given (priority)
//   2. rebase    each onto the tip of the batch under construction, in a worktree of the queue's
//                own (the main checkout is the orchestrator's); a conflict confined to generated
//                files takes the batch's version, any other conflict goes back to the executor
//   3. close     each item a branch's commits name in a `Closes:` trailer gets its `state: done`
//                edit, committed on top of the branch's own commits, so it merges (and reverts)
//                with them (design 3.4, HITLD-49); a trailer that cannot be honored goes back to
//                the executor. `Refs:` changes nothing. Then, on the branch with that edit:
//      fast      the classification guard on each of the branch's commits, their files and,
//                with private terms in the settings, their messages (design part 10.3),
//                two tracker items with one ID in the rebased tree are refused (design 3.4),
//                a branch that changes the quarantine file is refused (design 14.7), then the
//                fast checks on the rebased branch, the burn-in of the tests it adds or changes
//                (design 14.7), then the declared security scans (security.mjs); a failure goes
//                back to the executor
//   4. batch     after batch_max branches: regenerate generated files and the tracker views, commit
//                them, then the full suite once
//   5. failure   rerun on the same commit. A pass is a flake candidate, and the base comparison
//                decides (design 14.7): the suite runs on the batch's base, then on the candidate,
//                `flake.compare_runs` times each. It fails on the base: a pre-existing flake, the
//                batch is not blamed and goes on. It fails only on the candidate: the change
//                brought an intermittent failure, so the batch is bisected as below. It fails on
//                neither: inconclusive, nobody is blamed, and it is counted. A failure that fails
//                again on the rerun runs the suite on main (a failure there is an incident), then
//                bisects the batch's stack of commits to the first failing branch, sends it back,
//                and rebuilds the batch without it. A test in the quarantine file does not fail
//                the suite by itself (quarantine.mjs)
//   6. advance   fast-forward main to the tested commit; or, with `hold` (owner merge mode), keep
//                the tested commit under HELD_REF, build the next batch on it, and leave main
//                where it is: the owner approves what passed, and advanceTo moves main later
//
// The queue never pushes and never merges generated files by hand.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesAny } from '../precedent/glob.mjs';
import { runShell } from './shell.mjs';
import { STRICT, checkCommits, problemLines } from '../guard/classification.mjs';
import {
  QUARANTINE_PATH,
  activeEntries,
  environmentLabels,
  quarantineAt,
  readTestReport,
} from './quarantine.mjs';

/**
 * @typedef {object} Entry a verified branch waiting to merge
 * @property {string} item
 * @property {string} branch
 * @property {string[]} [needs] items it needs; ordered after those that are waiting too
 * @property {string[]} [touches]
 * @property {string} [dispatch]
 *
 * @typedef {object} Settings
 * @property {string} mainBranch
 * @property {number} batchMax
 * @property {string[]} fastChecks
 * @property {string[]} fullSuite
 * @property {{ globs: string[], regenerate?: string }[]} generated
 * @property {number} flakeReruns
 * @property {FlakeSettings} [flake] policy flake; the defaults when not given
 * @property {string[]} [setup] commands run once in the queue's fresh worktree (env.worktree_setup)
 * @property {import('../guard/classification.mjs').Rules} [classification] the commit guard's
 *   rules, from main's policy and tracker.json, with the private terms from the private store; the
 *   strictest (ceiling public, no terms) when not given
 * @property {(dir: string) => string[]} [trackerCheck] the problems of the tracker in a checked-out
 *   tree that refuse a branch: two items with one ID (design 3.4). Not a policy fast check, so it
 *   runs whatever merge.fast_checks says
 * @property {(dir: string, from: string, to: string, own: string | null) => { closed: { id: string }[], problems: string[] }} [closeByTrailer]
 *   in the queue's worktree, checked out at the rebased branch `to`: commit the `state: done` edit
 *   of each item a commit in from..to names in a `Closes:` trailer (tracker/files/closing.mjs).
 *   own: the entry's item when a dispatch made the branch, the only item it may close; null for a
 *   branch made by hand. `hitld merge` always sets this; there is no policy setting to turn it
 *   off. Only code that calls runMergeQueue itself can leave it out, and then no trailer closes
 *   anything
 *
 * @typedef {object} FlakeSettings
 * @property {number} [compareRuns] runs of the full suite on each side of the base comparison
 * @property {number} [compareRunsMax] the ceiling on compareRuns
 * @property {number} [burnInRuns]
 * @property {string} [burnInCommand] with none, new tests are not burned in
 * @property {string[]} [testGlobs] which files are tests
 * @property {string[]} [environments] environment labels beyond the operating system
 *
 * @typedef {(command: string, cwd: string, env: Record<string, string>) => { ok: boolean, output: string }} Exec
 *
 * @typedef {{ item: string, branch: string, reason: 'conflict' | 'closes' | 'classification' | 'duplicate_id' | 'quarantine' | 'fast_check' | 'burn_in' | 'security' | 'suite' | 'missing' | 'needs_rejected',
 *   files?: string[], conflict_class?: 'semantic', command?: string, output?: string, dispatch?: string,
 *   message?: string, findings?: import('./security.mjs').SentBack[] }} Rejected
 * @typedef {{ runs: number, failures: number }} SideRuns
 * @typedef {{ commit: string, command: string, output: string,
 *   outcome: 'preexisting' | 'introduced' | 'inconclusive' | 'real', items: string[],
 *   tests: string[], quarantinable: string[], base: SideRuns, candidate: SideRuns, runs: number }} Failure
 *   a full suite that failed on a batch. runs: the suite runs spent on it beyond the first (the rerun and the comparison).
 *   tests: the tests that failed, when the suite's test report names them. quarantinable: those that also
 *   failed on the base and that no branch in the batch changed
 * @typedef {Failure} Flake a failure whose rerun passed (outcome is not real)
 * @typedef {{ commit: string, tests: string[] }} Excused failures of quarantined tests that did not fail the suite
 * @typedef {{ item: string, runs: number, ok: boolean }} BurnIn
 * @typedef {{ item: string, branch: string, commit: string, parent: string, changed: string[],
 *   dispatch?: string, closed?: string[] }} Tested a branch that passed every check, rebased onto
 *   `parent`; closed: the items its `Closes:` trailers closed in it
 */

/** The ref that keeps a held batch's tested commit while it waits for the owner. */
export const HELD_REF = 'refs/hitld/merge-held';

const TAIL = 2000;
/** @param {string} s */
const tail = (s) => (s.length > TAIL ? `...${s.slice(-TAIL)}` : s);

/** @type {Exec} */
export function shellExec(command, cwd, env) {
  // Not this process's test-runner context: a project's own `node --test` would report to it.
  const { NODE_TEST_CONTEXT: _context, ...inherited } = process.env;
  // A POSIX shell command line, on Windows too (shell.mjs).
  const r = runShell(command, {
    cwd,
    env: { ...inherited, ...env },
    timeout: 30 * 60 * 1000,
  });
  return {
    ok: r.status === 0,
    output: tail(`${r.stdout}${r.stderr}${r.error ? String(r.error) : ''}`),
  };
}

/** @param {string} cwd @param {string[]} args @param {Record<string, string>} [env] */
function git(cwd, args, env = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', ...env },
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** @param {string} cwd @param {string[]} args */
function gitOk(cwd, args) {
  const r = git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}

/**
 * Stage every change in a working tree; whether anything is staged. `git status` can list a file
 * whose only difference is its line endings (core.autocrlf wrote it with CRLF on checkout, and a
 * generator wrote it again with LF), which `git add` then stages as no change at all.
 * @param {string} cwd @returns {boolean}
 */
export function stageAll(cwd) {
  if (!git(cwd, ['status', '--porcelain']).out) return false;
  gitOk(cwd, ['add', '--all']);
  return !git(cwd, ['diff', '--cached', '--quiet']).ok;
}

/**
 * The files `git diff --name-only from to` lists (a rename by its new path), each with its status
 * letter, from one `git diff --name-status -z`.
 * @param {string} cwd @param {string} from @param {string} to
 * @returns {{ status: string, path: string }[]}
 */
export function changedBetween(cwd, from, to) {
  const parts = git(cwd, ['diff', '--name-status', '-z', from, to]).out.split('\0');
  /** @type {{ status: string, path: string }[]} */
  const out = [];
  for (let i = 0; i + 1 < parts.length;) {
    const status = parts[i].charAt(0);
    // A rename or copy names the old path, then the new one.
    const path = status === 'R' || status === 'C' ? parts[i + 2] : parts[i + 1];
    i += status === 'R' || status === 'C' ? 3 : 2;
    if (path) out.push({ status, path });
  }
  return out;
}

/**
 * Dependency order: an entry goes after the waiting entries it needs; otherwise the given order.
 * An entry whose needs form a cycle among the waiting ones keeps its place at the end.
 * @param {Entry[]} entries @returns {Entry[]}
 */
export function dependencyOrder(entries) {
  const waiting = new Set(entries.map((e) => e.item));
  /** @type {Entry[]} */
  const out = [];
  const placed = new Set();
  let rest = [...entries];
  while (rest.length) {
    const next = rest.find((e) => (e.needs ?? []).every((n) => !waiting.has(n) || placed.has(n)));
    const pick = next ?? rest[0];
    out.push(pick);
    placed.add(pick.item);
    rest = rest.filter((e) => e !== pick);
  }
  return out;
}

/**
 * Fast-forward main from `base` to `tip`, only if main is still at `base`.
 * @param {string} repoRoot @param {string} main @param {string} base @param {string} tip
 * @returns {string | null} the problem, or null when main moved
 */
function advanceMain(repoRoot, main, base, tip) {
  const now = gitOk(repoRoot, ['rev-parse', `refs/heads/${main}`]);
  if (now !== base) {
    return `${main} moved (${base.slice(0, 12)} to ${now.slice(0, 12)}); only the queue may move it`;
  }
  const current = git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out;
  if (current === main) gitOk(repoRoot, ['merge', '--ff-only', '--quiet', tip]);
  else gitOk(repoRoot, ['update-ref', `refs/heads/${main}`, tip, base]);
  return null;
}

/**
 * Move main to a held batch the owner approved, without testing it again: the commit is the one
 * the queue tested (`hold`), and main must not have moved since. The scanners' baseline then drops
 * the findings the merged code fixed, as after any batch.
 * @param {{ repoRoot: string, mainBranch: string, base: string, commit: string,
 *   lastBranchCommit: string, security?: import('./security.mjs').SecurityGate }} r
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function advanceTo(r) {
  const held = git(r.repoRoot, ['rev-parse', '--verify', '--quiet', HELD_REF]).out;
  if (held !== r.commit) {
    return { ok: false, message: `the held batch is not ${r.commit.slice(0, 12)}` };
  }
  const problem = advanceMain(r.repoRoot, r.mainBranch, r.base, r.commit);
  if (problem) return { ok: false, message: problem };
  git(r.repoRoot, ['update-ref', '-d', HELD_REF]);
  if (r.security) {
    const dir = mkdtempSync(join(tmpdir(), 'hitld-merge-'));
    gitOk(r.repoRoot, ['worktree', 'add', '--detach', '--force', dir, r.commit]);
    try {
      r.security.merged({
        dir,
        commit: r.lastBranchCommit,
        checkout: (sha) => gitOk(dir, ['checkout', '--detach', '--force', '--quiet', sha]),
      });
    } finally {
      git(r.repoRoot, ['worktree', 'remove', '--force', dir]);
      rmSync(dir, { recursive: true, force: true });
      git(r.repoRoot, ['worktree', 'prune']);
    }
  }
  return { ok: true };
}

/**
 * Run the queue over the waiting entries. With `hold`, nothing moves main: each batch that passes
 * is kept for the owner (`ready`), and the next batch is built on it.
 * @param {{ repoRoot: string, entries: Entry[], settings: Settings, exec?: Exec,
 *   regenerateViews?: (dir: string) => void, security?: import('./security.mjs').SecurityGate,
 *   hold?: boolean, now?: () => Date }} r
 */
export async function runMergeQueue(r) {
  const exec = r.exec ?? shellExec;
  const s = r.settings;
  const result = {
    /** closed: the items the branch's `Closes:` trailers closed in the same merge.
     * @type {{ item: string, branch: string, commit: string, dispatch?: string, closed?: string[] }[]} */
    merged: [],
    /** @type {Rejected[]} */
    rejected: [],
    /** Failures whose rerun passed: flake candidates, each with what the comparison found.
     * @type {Flake[]} */
    flakes: [],
    /** Every full-suite failure of a batch, flake or not: the denominator of the flake rate.
     * @type {Failure[]} */
    failures: [],
    /** @type {Excused[]} */
    excused: [],
    /** @type {BurnIn[]} */
    burn_ins: [],
    suite_runs: 0,
    bisection_runs: 0,
    batches: 0,
    main: { before: '', after: '' },
    /** @type {{ kind: 'main_red' | 'regeneration_red' | 'main_moved' | 'classification' | 'quarantine', message: string, output?: string } | null} */
    incident: null,
    /** With `hold`: the tested commit holding every branch that passed, for the owner. Main has
     * not moved; advanceTo moves it there once the owner approves.
     * @type {{ base: string, commit: string, branches: Tested[] } | null} */
    ready: null,
  };
  if (!s.fullSuite.length) {
    throw new Error(
      'policy merge.full_suite is empty: the queue cannot keep main green without a full suite, so it will not move main',
    );
  }
  const main = s.mainBranch;
  result.main.before = gitOk(r.repoRoot, ['rev-parse', `refs/heads/${main}`]);
  result.main.after = result.main.before;
  // A held batch from an earlier presentation is no longer the one the owner will be shown.
  if (r.hold) git(r.repoRoot, ['update-ref', '-d', HELD_REF]);
  if (!r.entries.length) return result;

  const now = r.now ?? (() => new Date());
  const flake = s.flake ?? {};
  // Runs on each side of the base comparison, and per probe of a bisection of an intermittent failure.
  const compareRuns = Math.max(1, Math.min(flake.compareRuns ?? 10, flake.compareRunsMax ?? 30));
  // The quarantine file as main holds it: no branch may change it (checked below), so it is the
  // list for every batch of this run. A file that fails its guard stops the queue.
  const stored = quarantineAt(r.repoRoot, result.main.before);
  if (!stored.file) {
    result.incident = {
      kind: 'quarantine',
      message: `${QUARANTINE_PATH} on ${main} is refused, so nothing merged: ${stored.problems.join('; ')}`,
    };
    return result;
  }
  const quarantined = activeEntries(stored.file, now(), environmentLabels(flake));

  const dir = mkdtempSync(join(tmpdir(), 'hitld-merge-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'hitld-report-'));
  gitOk(r.repoRoot, ['worktree', 'add', '--detach', '--force', dir, result.main.before]);
  try {
    for (const cmd of s.setup ?? []) {
      const out = exec(cmd, dir, {});
      if (!out.ok) throw new Error(`the queue worktree's setup failed at "${cmd}": ${out.output}`);
    }
    /** @param {string} sha */
    const checkout = (sha) => gitOk(dir, ['checkout', '--detach', '--force', '--quiet', sha]);

    let reports = 0;
    /** The files the batch under test adds or changes: a quarantined test defined in one of them is the branch's to fix.
     * @type {Set<string>} */
    let changedNow = new Set();

    /**
     * The full suite on a commit. Each command gets HITLD_TEST_REPORT, the path where the
     * project's test report goes (quarantine.mjs). A command that fails only on quarantined
     * tests does not fail the suite: they ran and their results are recorded, but they do not gate,
     * unless the batch changed them: that is the branch's to fix. The base does not have the
     * batch's changes, so it passes `onBase`.
     * @param {string} sha @param {boolean} [onBase]
     * @returns {{ ok: boolean, command?: string, output?: string, failed?: import('./quarantine.mjs').TestResult[] | null }}
     */
    const suite = (sha, onBase = false) => {
      checkout(sha);
      for (const cmd of s.fullSuite) {
        const report = join(reportDir, `report-${++reports}.json`);
        const out = exec(cmd, dir, { HITLD_MERGE_COMMIT: sha, HITLD_TEST_REPORT: report });
        if (out.ok) continue;
        const tests = readTestReport(report);
        const failed = tests ? tests.filter((t) => t.outcome === 'fail') : null;
        if (
          failed?.length &&
          failed.every(
            (t) =>
              quarantined.some((q) => q.id === t.id) &&
              (onBase || !(t.file && changedNow.has(t.file))),
          )
        ) {
          result.excused.push({ commit: sha, tests: failed.map((t) => t.id) });
          continue;
        }
        return { ok: false, command: cmd, output: out.output, failed };
      }
      return { ok: true };
    };
    /** A counted run of the full suite. @param {string} sha @param {boolean} [onBase] */
    const run = (sha, onBase = false) => {
      result.suite_runs++;
      return suite(sha, onBase);
    };

    /**
     * The base comparison (design 14.7), for a failure that passed on rerun: the suite on the
     * batch's base, up to compare_runs times, and if it never fails there, on the candidate. It is
     * the same failure on the base when the tests that failed share one, or when a report does not
     * say which.
     * @param {string} tip @param {string} base
     * @param {{ failed?: import('./quarantine.mjs').TestResult[] | null }} first the failing run
     * @param {Failure} f the record, filled in
     * @returns {{ ok: boolean, command?: string, output?: string } | null} the candidate's failure, when it introduced one
     */
    const compare = (tip, base, first, f) => {
      const runs = compareRuns;
      const named = new Map((first.failed ?? []).map((t) => [t.id, t]));
      for (let i = 0; i < runs; i++) {
        f.runs++;
        f.base.runs++;
        const v = run(base, true);
        if (v.ok) continue;
        const shared = (v.failed ?? []).filter((t) => named.has(t.id));
        if (named.size && v.failed?.length && !shared.length) continue;
        f.base.failures++;
        f.outcome = 'preexisting';
        f.quarantinable = shared
          .filter((t) => {
            const path = t.file ?? named.get(t.id)?.file;
            return !(path && changedNow.has(path));
          })
          .map((t) => t.id);
        return null;
      }
      for (let i = 0; i < runs; i++) {
        f.runs++;
        f.candidate.runs++;
        const v = run(tip);
        if (v.ok) continue;
        f.candidate.failures++;
        f.outcome = 'introduced';
        return v;
      }
      f.outcome = 'inconclusive';
      return null;
    };

    /**
     * Rebase a branch onto the tip; resolve conflicts confined to generated files by taking the
     * tip's version.
     * @param {Entry} e @param {string} tip
     * @returns {{ ok: true, sha: string } | { ok: false, files: string[] }}
     */
    const rebase = (e, tip) => {
      checkout(gitOk(r.repoRoot, ['rev-parse', `refs/heads/${e.branch}`]));
      let step = git(dir, ['rebase', '--quiet', tip]);
      for (let guard = 0; !step.ok && guard < 200; guard++) {
        const files = git(dir, ['diff', '--name-only', '--diff-filter=U'])
          .out.split('\n')
          .filter(Boolean);
        if (!files.length) {
          // Nothing unmerged: the commit became empty once the generated files were resolved.
          step = git(dir, ['rebase', '--skip']);
          continue;
        }
        const generated = s.generated.flatMap((g) => g.globs);
        if (!files.every((f) => matchesAny(generated, f))) {
          git(dir, ['rebase', '--abort']);
          return { ok: false, files };
        }
        gitOk(dir, ['checkout', '--ours', '--', ...files]);
        gitOk(dir, ['add', '--', ...files]);
        step = git(dir, ['rebase', '--continue']);
      }
      if (!step.ok) {
        git(dir, ['rebase', '--abort']);
        return { ok: false, files: [] };
      }
      return { ok: true, sha: gitOk(dir, ['rev-parse', 'HEAD']) };
    };

    let pending = dependencyOrder(r.entries);
    let base = result.main.before;
    while (pending.length) {
      // Build a batch on the current base.
      /** @type {(Entry & { commit: string, parent: string, changed: string[], closed: string[] })[]} */
      const batch = [];
      const rejectedNow = new Set(result.rejected.map((x) => x.item));
      let tip = base;
      /** @type {Entry[]} */
      const later = [];
      for (const e of pending) {
        if (batch.length >= s.batchMax) {
          later.push(e);
          continue;
        }
        if ((e.needs ?? []).some((n) => rejectedNow.has(n))) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'needs_rejected',
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        if (!git(r.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${e.branch}`]).ok) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'missing',
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        const rb = rebase(e, tip);
        if (!rb.ok) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'conflict',
            conflict_class: 'semantic',
            files: rb.files,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        // Closing by trailer: the Done edit of each item a `Closes:` trailer names, committed on
        // top of the branch, before every check below, so they all cover it.
        const closing = s.closeByTrailer?.(dir, tip, rb.sha, e.dispatch ? e.item : null) ?? {
          closed: [],
          problems: [],
        };
        if (closing.problems.length) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'closes',
            output: closing.problems.join('\n'),
            message: `A Closes: trailer on your branch cannot be honored: ${closing.problems.join('; ')}. Fix the trailer (git commit --amend, or a rebase for an earlier commit): Closes: names a planned or in-progress work item that the branch finishes, and a dispatched branch only its own item; use Refs: to link one without closing it.`,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        const head = closing.closed.length ? gitOk(dir, ['rev-parse', 'HEAD']) : rb.sha;
        // The commit guard's rule, on every commit the branch brings. Not a policy fast check, so
        // it runs whatever merge.fast_checks says, and a hook skipped with --no-verify gains nothing.
        const guard = checkCommits(dir, tip, head, s.classification ?? STRICT);
        if (guard.refused.length) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'classification',
            files: [...new Set(guard.refused.filter((x) => !x.commit).map((x) => x.path))],
            output: problemLines(guard.refused).join('\n'),
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        // Two items with one ID: two sessions each took the next number from their own copy of
        // main. Refused here, naming both files, whatever the fast checks are.
        const duplicates = s.trackerCheck?.(dir) ?? [];
        if (duplicates.length) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'duplicate_id',
            output: duplicates.join('\n'),
            message: `Your branch, rebased onto ${s.mainBranch}, holds two tracker items with one ID: ${duplicates.join('; ')}. Give the item your branch adds a new ID (only the orchestrator creates items) and take the duplicate out of the branch.`,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        // The files the branch changes, and which of them it adds, modifies or renames to (the
        // burn-in's), from one diff.
        const diff = changedBetween(dir, tip, head);
        const changedFiles = diff.map((d) => d.path);
        const changed = changedFiles.join(' ');
        // Only the orchestrator quarantines a test, and only on evidence (design 14.7).
        if (changedFiles.includes(QUARANTINE_PATH)) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'quarantine',
            files: [QUARANTINE_PATH],
            message: `Your branch changes ${QUARANTINE_PATH}. Only the orchestrator quarantines a test, and only on evidence; take the change out of every commit on the branch. If a test is flaky, say so in your report, with the rerun that shows it.`,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        /** @type {{ cmd: string, output: string } | null} */
        let failed = null;
        for (const cmd of s.fastChecks) {
          const out = exec(cmd, dir, {
            HITLD_ITEM: e.item,
            HITLD_TOUCHES: (e.touches ?? []).join(' '),
            HITLD_CHANGED_FILES: changed,
            // Its name before HITLD-82, for fast checks written against it; until the next minor.
            HITLD_CHANGED: changed,
          });
          if (!out.ok) {
            failed = { cmd, output: out.output };
            break;
          }
        }
        if (failed) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'fast_check',
            command: failed.cmd,
            output: failed.output,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        // Burn-in: the tests the branch adds or changes run several times, with the order and the
        // seed varied, before they can gate anyone else (design 14.7).
        const testFiles = diff
          .filter((d) => 'AMR'.includes(d.status) && matchesAny(flake.testGlobs ?? [], d.path))
          .map((d) => d.path);
        if (flake.burnInCommand && testFiles.length) {
          const wanted = flake.burnInRuns ?? 5;
          let done = 0;
          /** @type {string | null} */
          let burnt = null;
          while (done < wanted && burnt === null) {
            done++;
            const out = exec(flake.burnInCommand, dir, {
              HITLD_ITEM: e.item,
              HITLD_TOUCHES: (e.touches ?? []).join(' '),
              HITLD_CHANGED_FILES: changed,
              HITLD_BURN_IN_FILES: testFiles.join('\n'),
              HITLD_BURN_IN_RUN: String(done),
              HITLD_BURN_IN_SEED: String(Number.parseInt(head.slice(0, 8), 16) + done * 7919),
            });
            if (!out.ok) burnt = out.output;
          }
          result.burn_ins.push({ item: e.item, runs: done, ok: burnt === null });
          if (burnt !== null) {
            result.rejected.push({
              item: e.item,
              branch: e.branch,
              reason: 'burn_in',
              files: testFiles,
              command: flake.burnInCommand,
              output: burnt,
              message: `The tests your branch adds or changes (${testFiles.join(', ')}) failed on run ${done} of ${wanted}, with the order and seed varied. A new test that fails once is the branch's problem before it can gate anyone else: make it deterministic on your branch.`,
              dispatch: e.dispatch,
            });
            rejectedNow.add(e.item);
            continue;
          }
        }
        const scan = r.security?.check({ ...e, dir, commit: head, base, checkout }) ?? {
          ok: true,
        };
        if (!scan.ok) {
          const { ok: _ok, ...why } = scan;
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'security',
            ...why,
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        batch.push({
          ...e,
          commit: head,
          parent: tip,
          changed: changedFiles,
          closed: closing.closed.map((c) => c.id),
        });
        tip = head;
      }
      if (!batch.length) {
        pending = later;
        continue;
      }

      // Regenerate generated files and views on top, so the tested commit includes them.
      checkout(tip);
      for (const g of s.generated) {
        if (!g.regenerate) continue;
        const out = exec(g.regenerate, dir, {});
        if (!out.ok) throw new Error(`regenerating ${g.globs.join(', ')} failed: ${out.output}`);
      }
      r.regenerateViews?.(dir);
      if (stageAll(dir)) {
        gitOk(dir, [
          'commit',
          '--quiet',
          '--no-verify',
          '-m',
          `merge queue: regenerate generated files and views (${batch.map((b) => b.item).join(', ')})`,
        ]);
        const before = tip;
        tip = gitOk(dir, ['rev-parse', 'HEAD']);
        // The queue's own commit skips hooks too, so the rule runs on it directly: a generator
        // must not put anything above the ceiling on main either.
        const regenerated = checkCommits(dir, before, tip, s.classification ?? STRICT);
        if (regenerated.refused.length) {
          result.incident = {
            kind: 'classification',
            message: `regenerating files for the batch (${batch.map((b) => b.item).join(', ')}) wrote files above the classification ceiling; nothing merged`,
            output: problemLines(regenerated.refused).join('\n'),
          };
          break;
        }
      }

      result.batches++;
      changedNow = new Set(batch.flatMap((b) => b.changed));
      const first = run(tip);
      /** @type {{ ok: boolean, command?: string, output?: string }} */
      let verdict = first;
      /** @type {Failure | null} */
      let failure = null;
      // Runs of each probe in the bisection: several for an intermittent failure.
      let probeRuns = 1;
      if (!first.ok) {
        failure = {
          commit: tip,
          command: String(first.command),
          output: String(first.output),
          outcome: 'real',
          items: batch.map((b) => b.item),
          tests: (first.failed ?? []).map((t) => t.id),
          quarantinable: [],
          base: { runs: 0, failures: 0 },
          candidate: { runs: 0, failures: 0 },
          runs: 0,
        };
        result.failures.push(failure);
        // Rerun on the same commit: a pass makes it a flake candidate, which the comparison on
        // the batch's base then settles.
        let passed = false;
        for (let n = 0; n < s.flakeReruns && !passed; n++) {
          failure.runs++;
          passed = run(tip).ok;
        }
        if (passed) {
          const introduced = compare(tip, base, first, failure);
          result.flakes.push(failure);
          if (introduced) {
            verdict = introduced;
            probeRuns = compareRuns;
          } else {
            // Pre-existing or inconclusive: the commit passed the suite on the rerun, and the
            // evidence does not put the failure on the batch.
            verdict = { ok: true };
          }
        }
      }
      if (!verdict.ok) {
        // An intermittent failure the comparison pinned on the candidate has shown the base clean.
        if (failure?.outcome !== 'introduced') {
          const onMain = run(base, true);
          if (!onMain.ok) {
            result.incident = {
              kind: 'main_red',
              message: `the full suite fails on ${main} itself (${base.slice(0, 12)}): main was not green`,
              output: onMain.output,
            };
            break;
          }
        }
        /** Whether a commit passes the suite: every one of `probeRuns` runs. @param {string} sha */
        const passes = (sha) => {
          for (let n = 0; n < probeRuns; n++) {
            result.bisection_runs++;
            if (!run(sha).ok) return false;
          }
          return true;
        };
        // Bisect the stack: the first branch whose commit fails the suite.
        let lo = 0;
        let hi = batch.length - 1;
        if (passes(batch[hi].commit)) {
          result.incident = {
            kind: 'regeneration_red',
            message:
              'every branch passes, but the batch with regenerated files fails: the generators broke the suite',
            output: verdict.output,
          };
          break;
        }
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (passes(batch[mid].commit)) lo = mid + 1;
          else hi = mid;
        }
        const culprit = batch[lo];
        result.rejected.push({
          item: culprit.item,
          branch: culprit.branch,
          reason: 'suite',
          command: verdict.command,
          output: verdict.output,
          ...(failure?.outcome === 'introduced'
            ? {
                message: `The full suite ("${verdict.command}") fails intermittently with your branch in the batch: it failed and then passed on the same commit, and it failed again on run ${failure.candidate.runs} of ${probeRuns}, while the base (${base.slice(0, 12)}) did not fail in ${failure.base.runs} runs. An intermittent failure is a bug too: look for a race or shared state your change added, reproduce it, and fix it on your branch.`,
              }
            : {}),
          dispatch: culprit.dispatch,
        });
        // Rebuild without it; the others are rebased again.
        pending = [
          ...batch
            .filter((b) => b !== culprit)
            .map(({ commit: _c, parent: _p, changed: _f, closed: _x, ...e }) => e),
          ...later,
        ];
        continue;
      }

      if (r.hold) {
        // Keep the tested commit for the owner and build the next batch on it; main stays.
        gitOk(r.repoRoot, ['update-ref', HELD_REF, tip]);
        result.ready = {
          base: result.main.before,
          commit: tip,
          branches: [
            ...(result.ready?.branches ?? []),
            ...batch.map((b) => ({
              item: b.item,
              branch: b.branch,
              commit: b.commit,
              parent: b.parent,
              changed: b.changed,
              ...(b.dispatch ? { dispatch: b.dispatch } : {}),
              ...(b.closed.length ? { closed: b.closed } : {}),
            })),
          ],
        };
        base = tip;
        pending = later;
        continue;
      }

      // Advance main to the tested commit, only if it has not moved meanwhile.
      const moved = advanceMain(r.repoRoot, main, base, tip);
      if (moved) {
        result.incident = { kind: 'main_moved', message: `during the batch, ${moved}` };
        break;
      }
      r.security?.merged({ dir, commit: batch[batch.length - 1].commit, checkout });
      base = tip;
      result.main.after = tip;
      for (const b of batch)
        result.merged.push({
          item: b.item,
          branch: b.branch,
          commit: b.commit,
          ...(b.dispatch ? { dispatch: b.dispatch } : {}),
          ...(b.closed.length ? { closed: b.closed } : {}),
        });
      pending = later;
    }
  } finally {
    git(r.repoRoot, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
    rmSync(reportDir, { recursive: true, force: true });
    git(r.repoRoot, ['worktree', 'prune']);
  }
  return result;
}
