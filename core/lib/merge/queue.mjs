// The basic local merge queue (design part 14): main moves only to a commit that passed the full
// suite as part of its batch.
//
//   1. order     dependency order among the waiting branches, then the order given (priority)
//   2. rebase    each onto the tip of the batch under construction, in a worktree of the queue's
//                own (the main checkout is the orchestrator's); a conflict confined to generated
//                files takes the batch's version, any other conflict goes back to the executor
//   3. fast      the classification guard on each of the branch's commits (design part 10.3),
//                then the fast checks on the rebased branch; a failure goes back to the executor
//   4. batch     after batch_max branches: regenerate generated files and the tracker views, commit
//                them, then the full suite once
//   5. failure   rerun on the same commit; a pass is a flake candidate: recorded, nothing blamed,
//                and the batch is held for the owner (v0 has no base comparison, design 14.7);
//                otherwise run the suite on main (a failure there is an incident); otherwise
//                bisect the batch's stack of commits to the first failing branch, send it back,
//                and rebuild the batch without it
//   6. advance   fast-forward main to the tested commit
//
// The queue never pushes and never merges generated files by hand.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesAny } from '../precedent/glob.mjs';
import { STRICT, checkCommits, problemLines } from '../guard/classification.mjs';

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
 * @property {string[]} [setup] commands run once in the queue's fresh worktree (env.worktree_setup)
 * @property {import('../guard/classification.mjs').Rules} [classification] the commit guard's
 *   rules, from main's policy and tracker.json; the strictest (ceiling public) when not given
 *
 * @typedef {(command: string, cwd: string, env: Record<string, string>) => { ok: boolean, output: string }} Exec
 *
 * @typedef {{ item: string, branch: string, reason: 'conflict' | 'classification' | 'fast_check' | 'suite' | 'missing' | 'needs_rejected',
 *   files?: string[], conflict_class?: 'semantic', command?: string, output?: string, dispatch?: string }} Rejected
 * @typedef {{ commit: string, command: string, output: string }} Flake
 */

const TAIL = 2000;
/** @param {string} s */
const tail = (s) => (s.length > TAIL ? `...${s.slice(-TAIL)}` : s);

/** @type {Exec} */
export function shellExec(command, cwd, env) {
  // Not this process's test-runner context: a project's own `node --test` would report to it.
  const { NODE_TEST_CONTEXT: _context, ...inherited } = process.env;
  const r = spawnSync(command, {
    shell: true,
    cwd,
    env: { ...inherited, ...env },
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
  });
  return {
    ok: r.status === 0,
    output: tail(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`),
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
 * Run the queue over the waiting entries.
 * @param {{ repoRoot: string, entries: Entry[], settings: Settings, exec?: Exec,
 *   regenerateViews?: (dir: string) => void }} r
 */
export async function runMergeQueue(r) {
  const exec = r.exec ?? shellExec;
  const s = r.settings;
  const result = {
    /** @type {{ item: string, branch: string, commit: string, dispatch?: string }[]} */
    merged: [],
    /** @type {Rejected[]} */
    rejected: [],
    /** @type {Flake[]} */
    flakes: [],
    suite_runs: 0,
    bisection_runs: 0,
    batches: 0,
    main: { before: '', after: '' },
    /** @type {{ kind: 'main_red' | 'regeneration_red' | 'main_moved' | 'classification', message: string, output?: string } | null} */
    incident: null,
    /** A batch that failed and then passed on a rerun: not merged, nothing blamed, the owner decides.
     * @type {{ kind: 'flake_candidate', commit: string, items: string[], message: string } | null} */
    held: null,
  };
  if (!s.fullSuite.length) {
    throw new Error(
      'policy merge.full_suite is empty: the queue cannot keep main green without a full suite, so it will not move main',
    );
  }
  const main = s.mainBranch;
  result.main.before = gitOk(r.repoRoot, ['rev-parse', `refs/heads/${main}`]);
  result.main.after = result.main.before;
  if (!r.entries.length) return result;

  const dir = mkdtempSync(join(tmpdir(), 'hitld-merge-'));
  gitOk(r.repoRoot, ['worktree', 'add', '--detach', '--force', dir, result.main.before]);
  try {
    for (const cmd of s.setup ?? []) {
      const out = exec(cmd, dir, {});
      if (!out.ok) throw new Error(`the queue worktree's setup failed at "${cmd}": ${out.output}`);
    }
    /** @param {string} sha */
    const checkout = (sha) => gitOk(dir, ['checkout', '--detach', '--force', '--quiet', sha]);

    /** @param {string} sha @returns {{ ok: boolean, command?: string, output?: string }} */
    const suite = (sha) => {
      checkout(sha);
      for (const cmd of s.fullSuite) {
        const out = exec(cmd, dir, { HITLD_MERGE_COMMIT: sha });
        if (!out.ok) return { ok: false, command: cmd, output: out.output };
      }
      return { ok: true };
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
      /** @type {(Entry & { commit: string })[]} */
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
        // The commit guard's rule, on every commit the branch brings. Not a policy fast check, so
        // it runs whatever merge.fast_checks says, and a hook skipped with --no-verify gains nothing.
        const guard = checkCommits(dir, tip, rb.sha, s.classification ?? STRICT);
        if (guard.refused.length) {
          result.rejected.push({
            item: e.item,
            branch: e.branch,
            reason: 'classification',
            files: [...new Set(guard.refused.map((x) => x.path))],
            output: problemLines(guard.refused).join('\n'),
            dispatch: e.dispatch,
          });
          rejectedNow.add(e.item);
          continue;
        }
        const changed = git(dir, ['diff', '--name-only', tip, rb.sha]).out.replace(/\n/g, ' ');
        /** @type {{ cmd: string, output: string } | null} */
        let failed = null;
        for (const cmd of s.fastChecks) {
          const out = exec(cmd, dir, {
            HITLD_ITEM: e.item,
            HITLD_TOUCHES: (e.touches ?? []).join(' '),
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
        batch.push({ ...e, commit: rb.sha });
        tip = rb.sha;
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
      if (git(dir, ['status', '--porcelain']).out) {
        gitOk(dir, ['add', '--all']);
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
      result.suite_runs++;
      let verdict = suite(tip);
      let candidate = false;
      for (let n = 0; !verdict.ok && !candidate && n < s.flakeReruns; n++) {
        result.suite_runs++;
        const again = suite(tip);
        if (again.ok) {
          result.flakes.push({
            commit: tip,
            command: String(verdict.command),
            output: String(verdict.output),
          });
          candidate = true;
        }
      }
      if (candidate) {
        // A rerun pass does not show the batch is good: until the base comparison exists (design
        // 14.7), hold it. Nothing is rejected and main does not move.
        result.held = {
          kind: 'flake_candidate',
          commit: tip,
          items: batch.map((b) => b.item),
          message: `the full suite failed and then passed on the same commit (${tip.slice(0, 12)}): a flake candidate, so the batch is held for the owner`,
        };
        break;
      }
      if (!verdict.ok) {
        result.suite_runs++;
        const onMain = suite(base);
        if (!onMain.ok) {
          result.incident = {
            kind: 'main_red',
            message: `the full suite fails on ${main} itself (${base.slice(0, 12)}): main was not green`,
            output: onMain.output,
          };
          break;
        }
        // Bisect the stack: the first branch whose commit fails the suite.
        let lo = 0;
        let hi = batch.length - 1;
        result.bisection_runs++;
        result.suite_runs++;
        if (suite(batch[hi].commit).ok) {
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
          result.bisection_runs++;
          result.suite_runs++;
          if (suite(batch[mid].commit).ok) lo = mid + 1;
          else hi = mid;
        }
        const culprit = batch[lo];
        result.rejected.push({
          item: culprit.item,
          branch: culprit.branch,
          reason: 'suite',
          command: verdict.command,
          output: verdict.output,
          dispatch: culprit.dispatch,
        });
        // Rebuild without it; the others are rebased again.
        pending = [
          ...batch.filter((b) => b !== culprit).map(({ commit: _c, ...e }) => e),
          ...later,
        ];
        continue;
      }

      // Advance main to the tested commit, only if it has not moved meanwhile.
      const now = gitOk(r.repoRoot, ['rev-parse', `refs/heads/${main}`]);
      if (now !== base) {
        result.incident = {
          kind: 'main_moved',
          message: `${main} moved during the batch (${base.slice(0, 12)} to ${now.slice(0, 12)}); only the queue may move it`,
        };
        break;
      }
      const current = git(r.repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out;
      if (current === main) gitOk(r.repoRoot, ['merge', '--ff-only', '--quiet', tip]);
      else gitOk(r.repoRoot, ['update-ref', `refs/heads/${main}`, tip, base]);
      base = tip;
      result.main.after = tip;
      for (const b of batch)
        result.merged.push({
          item: b.item,
          branch: b.branch,
          commit: b.commit,
          ...(b.dispatch ? { dispatch: b.dispatch } : {}),
        });
      pending = later;
    }
  } finally {
    git(r.repoRoot, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
    git(r.repoRoot, ['worktree', 'prune']);
  }
  return result;
}
