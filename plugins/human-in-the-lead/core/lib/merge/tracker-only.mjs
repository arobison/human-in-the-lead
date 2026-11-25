// A pull request whose every changed file is in the tracker, merged by one command (HITLD-871):
// `hitld merge --tracker-only <pull request>`. The chief of staff merges these outside the queue
// (a published answer, a curator's change, the owner's own), and its steps were prose, which
// skipped the queue's guards. This runs them, in order, and merges only when each holds:
//
//   1. the pull request    open, into the main branch, its head branch in this repository (not a
//                          fork) and on the remote at the pull request's head
//   2. tracker-only        every changed file is under the tracker's folder; anything else goes
//                          through the queue
//   3. the queue's guards  the commit guard on every commit the branch brings (classification and
//                          the private term list), the quarantine file, two items with one ID in
//                          the merged tree, a conflict with main
//   4. who decides         in owner mode: a symbolic link, or a path under merge.owner_paths, waits
//                          for the owner; a changed decision answer must be one the rights flow
//                          recorded (answers.mjs); beyond that the branch changes only what
//                          delegatedTrackerScope allows (the item a live dispatch on it claimed, a
//                          recorded answer, a recorded choice), and an item promoted out of proposed
//                          is refused
//   5. the checks          the named checks this change waits for are green on the head
//   6. merge               a squash of that head, carrying the owner's sign-off: under their
//                          delegation (merge.pull_request.delegated_by) the one their latest
//                          approval gave, with a Delegated-by trailer; or, with their own yes to this
//                          pull request, the sign-off that yes carries. Their yes is only an approval
//                          `hitld merge approve` recorded in the queue's state for this pull request,
//                          holding for this head (approvalHolds): no flag stands in for it. With it,
//                          what waits for them (step 4) is theirs to merge; the guards still hold.
//
// Outside owner mode (merge.mode queue) step 4 and the sign-off are skipped, as the queue skips
// them: the merge is not signed. Each refusal names its reason and what to do; nothing is merged
// then.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STRICT, checkCommits } from '../guard/classification.mjs';
import { parseItem } from '../tracker/files/frontmatter.mjs';
import { delegatedTrackerScope, unverifiedAnswers } from './answers.mjs';
import {
  approvalHolds,
  changedFiles,
  checksFor,
  classificationRejection,
  pullRequestWaits,
  revertCommand,
  squashMessage,
} from './pull-request.mjs';
import { QUARANTINE_PATH } from './quarantine.mjs';

/**
 * @typedef {object} TrackerOnlySettings
 * @property {string} mainBranch
 * @property {string} remote
 * @property {string[]} checks merge.pull_request.checks
 * @property {{ name: string, unless_only: string[] }[]} [conditionalChecks]
 * @property {string} workDir the tracker's folder
 * @property {import('../guard/classification.mjs').Rules} [classification] main's rules, with the
 *   private terms
 * @property {(dir: string) => string[]} [trackerCheck] two items with one ID in a checked-out tree
 * @property {Record<string, any>[]} [answers] what the rights flow recorded (recordedAnswers)
 * @property {string | null} [delegatedBy] merge.pull_request.delegated_by
 * @property {(id: string) => import('../rights/flow.mjs').AskedRecord | null} [asked] a decision's
 *   ask record, when the ledger records it asked (delegatedTrackerScope)
 *
 * @typedef {{ code: string, message: string, findings?: { path?: string, item?: string | null,
 *   decision?: string, why: string }[], files?: string[] }} TrackerOnlyRefusal
 * @typedef {{ number: number, url: string, branch: string, head: string, commit: string,
 *   claimed: string | null, signed_off_by: string, delegated_by: string | null,
 *   approved_by_owner: boolean, approval: { source: 'presented' | 'ahead', at: string, by: string,
 *   head: string } | null, changed: string[], reverse: string }} TrackerOnlyMerged approval: the
 *   owner's recorded yes it merged with, for the caller to mark used
 */

/**
 * The owner's recorded yes to this pull request that holds for this head, or null; `stale` when one
 * was recorded for it and the branch moved since.
 * @param {string} dir @param {import('./pull-request.mjs').PullQueueState} state
 * @param {string} branch @param {number} number @param {string} head
 * @returns {{ approval: import('./pull-request.mjs').Approval, source: 'presented' | 'ahead', stale: false }
 *   | { approval: null, source: null, stale: boolean }}
 */
export function ownerYes(dir, state, branch, number, head) {
  const ps = state.branches[branch];
  if (ps?.approval && approvalHolds(dir, ps, number, head)) {
    return { approval: ps.approval, source: 'presented', stale: false };
  }
  const ahead = state.approved_ahead?.[branch];
  if (ahead) {
    /** @type {import('./pull-request.mjs').PullState} */
    const shell = { item: '', number, url: '', head, since: '', updates: [], approval: ahead };
    if (approvalHolds(dir, shell, number, head)) {
      return { approval: ahead, source: 'ahead', stale: false };
    }
  }
  const stale = [ps?.approval, ahead].some((a) => a?.number === number);
  return { approval: null, source: null, stale };
}

/** The ledger events that end a dispatch's claim on its branch. */
const CLAIM_ENDS = ['abandoned', 'unclaimed', 'interrupted'];

/**
 * The live dispatch on a branch and the item it claimed, from the ledger, or null: the latest
 * `dispatched` event naming the branch, unless that dispatch was abandoned, unclaimed or
 * interrupted since, or its item merged after it. A branch whose dispatch is over claims nothing,
 * whatever its name.
 * @param {Record<string, any>[]} events the ledger's events @param {string} branch
 * @returns {{ item: string, dispatch: string } | null}
 */
export function liveClaim(events, branch) {
  const live = events.filter((e) => e.corrects === undefined);
  const at = live.findLastIndex(
    (e) => e.event === 'dispatched' && e.branch === branch && typeof e.item === 'string',
  );
  if (at < 0) return null;
  const d = live[at];
  const over = live
    .slice(at + 1)
    .some(
      (e) =>
        (CLAIM_ENDS.includes(e.event) && e.dispatch === d.dispatch) ||
        (e.event === 'merged' && e.item === d.item),
    );
  return over ? null : { item: String(d.item), dispatch: String(d.dispatch) };
}

/**
 * Whether a live dispatch's claim is this branch's own: the item's file at the head names that
 * dispatch as its claimant. A branch pushed later under the name of an earlier dispatch's branch
 * does not inherit its claim.
 * @param {string} dir @param {string} head @param {string[]} paths
 * @param {{ item: string, dispatch: string }} claim
 */
function claimOnBranch(dir, head, paths, claim) {
  for (const path of paths) {
    if (!path.endsWith('.md')) continue;
    const r = spawnSync('git', ['show', `${head}:${path}`], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) continue;
    const data = parseItem(r.stdout).data;
    if (data && String(data.id) === claim.item) return data.claimed_by === claim.dispatch;
  }
  return false;
}

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function git(cwd, args, env) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** The identity of the throwaway commit the merged tree is checked in; it is never pushed. */
const CHECK_IDENTITY = {
  GIT_AUTHOR_NAME: 'hitld',
  GIT_AUTHOR_EMAIL: 'hitld@localhost',
  GIT_COMMITTER_NAME: 'hitld',
  GIT_COMMITTER_EMAIL: 'hitld@localhost',
};

/**
 * Check one tracker-only pull request and merge it when every step above holds.
 * @param {{ repoRoot: string, number: number, github: import('./github.mjs').GitHub,
 *   settings: TrackerOnlySettings, policy: Record<string, any>,
 *   claimOf: (branch: string) => { item: string, dispatch: string } | null,
 *   state: import('./pull-request.mjs').PullQueueState }} o claimOf: the live dispatch on that
 *   branch and the item it was for, from the ledger; state: the queue's state, which holds the
 *   owner's recorded approvals and the sign-off their latest one gave
 * @returns {{ merged: TrackerOnlyMerged, refused: null } | { merged: null, refused: TrackerOnlyRefusal }}
 */
export function mergeTrackerOnly(o) {
  const s = o.settings;
  /** @param {string} code @param {string} message @param {Partial<TrackerOnlyRefusal>} [more] */
  const refuse = (code, message, more = {}) => ({
    merged: null,
    refused: { code, message: `${message}; nothing was merged`, ...more },
  });
  const pr = o.github.pull(o.number);
  if (!pr) return refuse('no-pull-request', `pull request #${o.number} is not found`);
  if (pr.state !== 'open')
    return refuse('no-pull-request', `pull request #${o.number} is not open`);
  if (pr.base !== s.mainBranch) {
    return refuse(
      'not-tracker-only',
      `pull request #${o.number} merges into ${pr.base}, not ${s.mainBranch}`,
    );
  }
  // The head branch's origin: a fork's branch is not one this project's sessions pushed.
  if (pr.head_repo !== o.github.repo) {
    return refuse(
      'foreign-head',
      `the head branch of #${o.number} is in ${pr.head_repo ?? 'a repository GitHub no longer shows'}, not ${o.github.repo}: only a branch in this repository merges this way`,
    );
  }
  const mainRef = `refs/remotes/${s.remote}/${s.mainBranch}`;
  const branchRef = `refs/remotes/${s.remote}/${pr.branch}`;
  const fetched = git(o.repoRoot, [
    'fetch',
    '--quiet',
    s.remote,
    `+refs/heads/${s.mainBranch}:${mainRef}`,
    `+refs/heads/${pr.branch}:${branchRef}`,
  ]);
  if (!fetched.ok) {
    return refuse('failed', `fetching ${s.mainBranch} and ${pr.branch}: ${fetched.err}`);
  }
  const main = git(o.repoRoot, ['rev-parse', mainRef]).out;
  const head = git(o.repoRoot, ['rev-parse', branchRef]).out;
  if (head !== pr.head) {
    return refuse(
      'foreign-head',
      `branch ${pr.branch} is at ${head.slice(0, 12)} on ${s.remote}, and the pull request's head is ${String(pr.head).slice(0, 12)}: run it again once they agree`,
    );
  }
  const base = git(o.repoRoot, ['merge-base', main, head]).out;
  const diff = changedFiles(o.repoRoot, main, head);
  const changed = diff.paths;
  if (!changed.length)
    return refuse('not-tracker-only', `pull request #${o.number} changes nothing`);
  const prefix = `${s.workDir.replace(/\/+$/, '')}/`;
  const outside = changed.filter((p) => !p.startsWith(prefix));
  if (outside.length) {
    return refuse(
      'not-tracker-only',
      `pull request #${o.number} changes files outside ${prefix}: it goes through the merge queue and reaches ${s.mainBranch} only with the owner's own yes`,
      { files: outside },
    );
  }

  // The queue's guards.
  const guard = checkCommits(o.repoRoot, base, head, s.classification ?? STRICT);
  if (guard.refused.length) {
    const r = classificationRejection(
      `pull request #${o.number}`,
      guard.refused,
      s.classification?.terms ?? [],
    );
    return refuse(
      'classification',
      r.message ??
        `the commit guard refuses the branch's commits: ${r.output.split('\n').join('; ')}`,
      { files: r.files },
    );
  }
  if (changed.includes(QUARANTINE_PATH)) {
    return refuse(
      'quarantine',
      `pull request #${o.number} changes ${QUARANTINE_PATH}: only the orchestrator quarantines a test`,
      { files: [QUARANTINE_PATH] },
    );
  }
  const tree = git(o.repoRoot, ['merge-tree', '--write-tree', main, head]);
  if (!tree.ok) {
    return refuse(
      'conflict',
      `pull request #${o.number} conflicts with ${s.mainBranch}: merge ${s.mainBranch} into its branch (never rebase or force-push), keep both sides of each conflict, run hitld work check, push, and run this again once the checks are green on the new head`,
    );
  }
  const merged = git(
    o.repoRoot,
    ['commit-tree', tree.out.split('\n')[0], '-p', main, '-p', head, '-m', 'tracker-only check'],
    CHECK_IDENTITY,
  );
  if (!merged.ok) return refuse('conflict', `the merged tree could not be built: ${merged.err}`);
  const dir = mkdtempSync(join(tmpdir(), 'hitld-tracker-only-'));
  /** @type {string[]} */
  let duplicates = [];
  try {
    const added = git(o.repoRoot, ['worktree', 'add', '--detach', '--force', dir, merged.out]);
    if (!added.ok) return refuse('failed', `checking the merged tree out: ${added.err}`);
    duplicates = o.settings.trackerCheck?.(dir) ?? [];
  } finally {
    git(o.repoRoot, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  if (duplicates.length) {
    return refuse(
      'duplicate-id',
      `merged into ${s.mainBranch}, pull request #${o.number} leaves two tracker items with one ID: ${duplicates.join('; ')}. Give the item the branch adds a new ID`,
    );
  }

  // Who decides.
  const owner = o.policy.merge?.mode === 'owner';
  const yes = ownerYes(o.repoRoot, o.state, pr.branch, o.number, head);
  const approved = yes.approval !== null;
  const claim = o.claimOf(pr.branch);
  const claimed = claim && claimOnBranch(o.repoRoot, head, changed, claim) ? claim.item : null;
  const ask = `record the owner's own yes with hitld merge approve --only ${pr.branch} --head ${head} --signoff "<their sign-off>", then run this again${yes.stale ? ` (the approval recorded for #${o.number} was of another head: the branch moved since)` : ''}`;
  /** @type {{ path?: string, item?: string | null, decision?: string, why: string }[]} */
  const waits = [];
  /** @type {{ path?: string, item?: string | null, why: string }[]} */
  let promoted = [];
  if (owner) {
    for (const link of diff.links) {
      waits.push({ path: link, why: 'a symbolic link is added, changed or removed' });
    }
    if (pullRequestWaits(changed, o.policy)) {
      waits.push({ why: 'it changes a file under merge.owner_paths or merge.owner_areas' });
    }
    const unverified = unverifiedAnswers({
      dir: o.repoRoot,
      base,
      head,
      paths: changed,
      events: s.answers ?? [],
    });
    waits.push(...unverified);
    const scope = delegatedTrackerScope({
      dir: o.repoRoot,
      base,
      head,
      paths: changed,
      workDir: s.workDir,
      claimed,
      unverified: unverified.map((x) => x.path),
      ...(s.asked ? { asked: s.asked } : {}),
    });
    waits.push(...scope.waits);
    promoted = scope.refused;
  }
  if (promoted.length && !approved) {
    return refuse(
      'owner-only-state',
      `pull request #${o.number} makes a change only the owner's decision makes: ${promoted.map((x) => x.why).join('; ')}. Put it to the owner; on their own yes, ${ask}`,
      { findings: promoted },
    );
  }
  if (waits.length && !approved) {
    return refuse(
      'waits-for-owner',
      `pull request #${o.number} waits for the owner: ${waits.map((x) => x.why).join('; ')}. Put it to the owner with these reasons; on their own yes, ${ask}`,
      { findings: waits },
    );
  }

  // The checks.
  const names = checksFor(changed, { checks: s.checks, conditionalChecks: s.conditionalChecks });
  const reported = o.github.checks(head);
  const failed = names.filter((n) => reported.some((c) => c.name === n && c.state === 'failure'));
  if (failed.length) {
    return refuse(
      'checks-failed',
      `the checks ${failed.join(', ')} failed on #${o.number} at ${head.slice(0, 12)}`,
    );
  }
  const pending = names.filter((n) => {
    const hits = reported.filter((c) => c.name === n);
    return !(hits.length && hits.every((c) => c.state === 'success'));
  });
  if (pending.length) {
    return refuse(
      'checks-pending',
      `the checks ${pending.join(', ')} have not passed on #${o.number} at ${head.slice(0, 12)} yet: run this again once they have`,
    );
  }

  // The sign-off.
  const delegatedBy = owner && !approved ? (s.delegatedBy ?? null) : null;
  if (owner && !approved && !delegatedBy) {
    return refuse(
      'no-signoff',
      `the owner has not delegated merging without asking (merge.pull_request.delegated_by is not set): put #${o.number} to them; on their own yes, ${ask}`,
    );
  }
  const signedOffBy = yes.approval
    ? yes.approval.signed_off_by
    : delegatedBy
      ? (o.state.owner_signoff ?? null)
      : null;
  if (owner && !signedOffBy) {
    return refuse(
      'no-signoff',
      `no sign-off of the owner's is known yet for a merge under ${delegatedBy}: put #${o.number} to them; on their own yes, ${ask}`,
    );
  }
  const done = o.github.mergePull(o.number, {
    sha: head,
    title: `${pr.title} (#${o.number})`,
    message: squashMessage({
      dir: o.repoRoot,
      base: main,
      head,
      item: claimed,
      signedOffBy,
      delegatedBy,
    }),
  });
  if (!done.merged) return refuse('failed', `GitHub refused the merge: ${done.message}`);
  return {
    refused: null,
    merged: {
      number: o.number,
      url: pr.url,
      branch: pr.branch,
      head,
      commit: done.sha,
      claimed,
      signed_off_by: String(signedOffBy ?? ''),
      delegated_by: delegatedBy,
      approved_by_owner: approved,
      approval:
        yes.approval && yes.source
          ? {
              source: yes.source,
              at: yes.approval.at,
              by: yes.approval.by,
              head: yes.approval.head,
            }
          : null,
      changed,
      reverse: revertCommand({ item: claimed ?? `#${o.number}`, commit: done.sha }),
    },
  };
}
