// The merge queue through GitHub pull requests (design part 14.2, merge.via pull-request), for a
// session that cannot push main: a cloud session's git access refuses it, and a protected main may
// refuse it anywhere. Main still moves only to a commit the named checks passed on. One pass:
//
//   1. fetch     main and each waiting branch from the remote; a branch only this checkout has is
//                pushed first (never forced)
//   2. guard     on each branch, against main: the commit guard on every commit it brings, two
//                tracker items with one ID, a change to the quarantine file, and the item closed in
//                the branch itself, so the close lands in the same pull request; a failure goes back
//                to the executor
//   3. open      or update the branch's pull request: its title and body from the item, the report's
//                evidence and the release note, checked against the private term list first
//   4. checks    only the checks merge.pull_request.checks names. One that failed sends the branch
//                back. One still running holds the branches after it, until it has run longer than
//                merge.pull_request.check_timeout_minutes: then the branch is stalled and the queue
//                goes on without it, so a check that never completes never stalls the queue
//   5. owner     whether a green pull request waits for the owner is one function of the paths it
//                changes (pullRequestWaits): in owner mode, one that changes a file under
//                merge.owner_paths or in merge.owner_areas waits, and with both empty every one
//                does. One that waits merges only with a recorded approval of its head, which
//                carries the owner's Signed-off-by. One that does not is merged without asking;
//                when merge.pull_request.delegated_by names the owner's decision that delegated
//                it, the squash carries the owner's sign-off (the one their latest approval gave)
//                and a Delegated-by trailer naming that decision, and with no sign-off known yet
//                it waits for the owner instead
//   6. update    a green branch behind main is brought up to date: main merged in (never a rebase,
//                never a force-push), generated files rebuilt and committed, pushed, and checked
//                again; a conflict goes back to the executor. An approval holds across the queue's
//                own updates, and no other new commit. An approval recorded before the queue
//                presented a head (approveAhead, HITLD-821) is applied when the queue reaches that
//                point with the head approved, or with only clean merges of main after it, each
//                exactly what git makes of it (aheadHolds); with anything else after it, it is
//                dropped and the pull request is presented. One the queue sends back, or one left
//                when nothing is waiting, is dropped unused. A branch main moved past only under work/,
//                in files the branch leaves alone, is not updated and its checks are not run again
//                (HITLD-777): tracker merges would otherwise restart them without end
//   7. merge     squash-merge through the API, only while the head is the commit checked, with a
//                message carrying the item's trailers and, when the owner approved, their sign-off;
//                then the next waiting branch is brought up to date (step 6)
//
// GitHub's own merge queue is a later backend for the same steps (design 14.5).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STRICT, checkCommits, problemLines } from '../guard/classification.mjs';
import { findTerms, matchMessage } from '../guard/private-terms.mjs';
import { UNASSIGNED } from '../rights/trust.mjs';
import { matchesAny } from '../precedent/glob.mjs';
import { unverifiedAnswers } from './answers.mjs';
import { areasOf, waitsForOwner } from './owner.mjs';
import { QUARANTINE_PATH } from './quarantine.mjs';
import { dependencyOrder, kbMessage, shellExec, stageAll } from './queue.mjs';

/**
 * @typedef {import('./queue.mjs').Entry} Entry
 * @typedef {import('./queue.mjs').Exec} Exec
 * @typedef {import('./github.mjs').GitHub} GitHub
 * @typedef {import('./github.mjs').Check} Check
 *
 * @typedef {{ state: string | null, title: string, release_note?: string | null, body: string }} ItemAt
 *
 * @typedef {object} PullSettings
 * @property {string} mainBranch
 * @property {string} remote the git remote that is GitHub
 * @property {string[]} checks the checks a pull request waits for, by name
 * @property {number} checkTimeoutMinutes
 * @property {{ globs: string[], regenerate?: string }[]} generated rebuilt after main is merged in
 * @property {string[]} [setup] commands run once in the queue's fresh worktree (env.worktree_setup)
 * @property {import('../guard/classification.mjs').Rules} [classification]
 * @property {(dir: string) => string[]} [trackerCheck]
 * @property {(dir: string) => string[]} [kbCheck] the knowledge base's errors (`hitld kb check`)
 * @property {(dir: string, item: string) => ItemAt | null} itemAt the item as the checked-out tree holds it
 * @property {{ name: string, unless_only: string[] }[]} [conditionalChecks]
 *   merge.pull_request.conditional_checks: waited for unless every changed file matches unless_only
 * @property {Record<string, any>[]} [answers] the ledger's effective events: a changed decision
 *   answer merges without asking only when one of them records it (answers.mjs); none, none does
 * @property {string | null} [delegatedBy] merge.pull_request.delegated_by: the owner's decision that
 *   delegated merging, without asking, the pull requests that do not wait for them
 *
 * @typedef {{ number: number, head: string, signed_off_by: string, at: string, by: string,
 *   presented_at?: string, as_presented?: boolean, ahead?: string }} Approval the owner's approval
 *   of one pull request's head: presented_at is when it was put to them, and as_presented whether
 *   they took everything presented then or named a list that left some out; ahead, on one given
 *   before the queue presented the pull request, is the head the owner approved (head is then
 *   the one the queue applied it to)
 *
 * @typedef {object} PullState what the queue remembers about one branch's pull request
 * @property {string} item
 * @property {number} number
 * @property {string} url
 * @property {string} head the head last seen
 * @property {string} since when that head was first seen: the check timeout runs from here
 * @property {string[]} updates the commits the queue itself added to the branch (main merged in, rebuilt files)
 * @property {Approval} [approval]
 * @property {string} [refused_behind] a head GitHub would not merge while it was behind main only
 *   by tracker changes: the next pass brings it up to date
 *
 * @typedef {object} PullQueueState kept in the private store at PULL_STATE_KEY
 * @property {1} schema_version
 * @property {Record<string, PullState>} branches
 * @property {{ at: string, branches: Presented[] } | null} presented the green pull requests that wait for the owner
 * @property {string | null} [owner_signoff] the sign-off the owner's latest approval gave: the one a
 *   merge made under their delegation carries
 * @property {Record<string, Approval>} [approved_ahead] by branch: approvals of a pull request's
 *   head recorded before the queue presented it (HITLD-821), applied or dropped when it would
 *
 * @typedef {{ item: string, branch: string, number: number, url: string, head: string, changed: string[],
 *   checks: string[], dispatch?: string, no_signoff?: true, links?: string[],
 *   answer_unverified?: { decision: string, path: string, why: string }[] }} Presented no_signoff: it
 *   would merge under the owner's delegation, but no sign-off of theirs is known yet; links: the
 *   symbolic links it adds, changes or removes, which make it wait; answer_unverified: the decision
 *   answers it changes that no recorded answer matches, which make it wait
 * @typedef {{ item: string, branch: string, number: number, url: string, commit: string, signed_off: boolean,
 *   changed: string[], approval: { at: string, presented_at: string | null, as_presented: boolean } | null,
 *   delegated_by: string | null, dispatch?: string }} PullMerged approval: the owner's, when they
 *   approved it; delegated_by: the decision it was merged under without asking, with the owner's sign-off
 * @typedef {{ item: string, branch: string, reason: 'conflict' | 'classification' | 'duplicate_id' | 'knowledge_base' | 'quarantine'
 *   | 'not_closed' | 'publish' | 'checks' | 'missing' | 'needs_rejected', files?: string[], checks?: Check[],
 *   output?: string, message?: string, number?: number, url?: string, dispatch?: string }} PullRejected
 * @typedef {{ item: string, branch: string, number: number, url: string, head: string, checks: string[],
 *   waited_ms: number, dispatch?: string }} PullWaiting a pull request whose named checks have not all finished
 * @typedef {{ item: string, branch: string, number: number, url: string, approved_head: string,
 *   head: string, by: string, at: string, presented_at: string, dispatch?: string }} AheadOutcome
 *   an approval recorded before the queue presented the pull request (at), and the head the queue
 *   reached it with (at presented_at)
 * @typedef {{ branch: string, number: number, approved_head: string, by: string, at: string,
 *   why: 'rejected' | 'nothing_waiting' }} AheadExpired an approval recorded before the queue
 *   presented the pull request, dropped unused: its branch was sent back, or nothing was waiting
 */

/** The private store key of the pull-request queue's state. */
export const PULL_STATE_KEY = 'merge/pull-requests.json';

/** The trailers a squash commit carries from the branch's own commits. */
export const SQUASH_TRAILERS = [
  'Work-Item',
  'Dispatch',
  'Agent-Role',
  'Agent-Model',
  'Agent-Effort',
];

/** @returns {PullQueueState} */
export const emptyPullState = () => ({
  schema_version: 1,
  branches: {},
  presented: null,
  owner_signoff: null,
});

/**
 * The stored state; empty when there is none or it does not read.
 * @param {import('../store/store.mjs').PrivateStore} store @returns {PullQueueState}
 */
export function readPullState(store) {
  try {
    const s = JSON.parse(store.read(PULL_STATE_KEY) ?? 'null');
    return s && s.schema_version === 1 && s.branches && typeof s.branches === 'object'
      ? { ...emptyPullState(), ...s }
      : emptyPullState();
  } catch {
    return emptyPullState();
  }
}

/**
 * Whether a green pull request waits for the owner before it merges, from the paths it changes and
 * nothing else: never its author or its description. The one place the pull-request path decides
 * it. None waits in queue mode. In owner mode one waits when it changes a file under
 * merge.owner_paths or in an area named in merge.owner_areas, and every one waits when both are
 * empty (waitsForOwner, the local queue's rule); one that changes nothing that git can name waits
 * too.
 * @param {string[]} paths the files the pull request changes against main, a rename as both paths
 * @param {Record<string, any>} policy
 * @param {string[]} [links] the changed paths that are a symbolic link on either side; in owner
 *   mode any one waits
 */
export function pullRequestWaits(paths, policy, links = []) {
  if (policy.merge?.mode !== 'owner') return false;
  if (!paths.length) return true;
  // A symbolic link added, changed or removed anywhere waits (decision HITLD-313): a link would
  // let a change under a delegated path reach past it.
  if (links.length) return true;
  return waitsForOwner(paths, policy);
}

/** The git file mode of a symbolic link. */
const LINK_MODE = '120000';

/**
 * The files a branch changes against main (a three-dot diff): a rename or a copy as both of its
 * paths, so a file moved out of an owner path still counts where it came from, and each name as
 * git stores it, never quoted. `links` are the changed paths that are a symbolic link on either
 * side (git mode 120000).
 * @param {string} dir @param {string} main @param {string} head
 * @returns {{ paths: string[], links: string[] }}
 */
export function changedFiles(dir, main, head) {
  // Not through git(), which trims: a name may start with a space.
  const r = spawnSync('git', ['diff', '--raw', '--no-renames', '-z', `${main}...${head}`], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`git diff ${main}...${head}: ${(r.stderr ?? '').trim() || 'failed'}`);
  }
  // Each entry is ":<old mode> <new mode> <old sha> <new sha> <status>" then its path, NUL-ended.
  const fields = r.stdout.split('\0');
  /** @type {string[]} */
  const paths = [];
  /** @type {string[]} */
  const links = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i].replace(/^\n/, '');
    const path = fields[i + 1];
    if (!meta.startsWith(':') || !path) {
      throw new Error(
        `git diff ${main}...${head}: an entry that does not read: ${JSON.stringify(meta)}`,
      );
    }
    const [oldMode, newMode] = meta.slice(1).split(' ');
    paths.push(path);
    if (oldMode === LINK_MODE || newMode === LINK_MODE) links.push(path);
  }
  return { paths, links };
}

/**
 * The checks a pull request with these changed files waits for: merge.pull_request.checks, and each
 * conditional check unless every changed file matches its unless_only globs (a check CI reports
 * only for some changes, such as the code scanning result for code CodeQL analyzes). An empty
 * change waits for them all.
 * @param {string[]} paths @param {PullSettings} s @returns {string[]}
 */
export function checksFor(paths, s) {
  const extra = (s.conditionalChecks ?? [])
    .filter((c) => !(paths.length && paths.every((p) => matchesAny(c.unless_only, p))))
    .map((c) => c.name);
  return [...new Set([...s.checks, ...extra])];
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** @param {string} cwd @param {string[]} args */
function gitOk(cwd, args) {
  const r = git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}

/** @param {string} cwd @param {string} a @param {string} b whether a is an ancestor of b */
const isAncestor = (cwd, a, b) => git(cwd, ['merge-base', '--is-ancestor', a, b]).ok;

/** The tracker's directory: a change only under it never makes a branch behind main (HITLD-777). */
export const TRACKER_PREFIX = 'work/';

/**
 * Whether main moved past a branch only by tracker changes the branch leaves alone: every file
 * main changed since the branch's base is under work/, and the branch changes none of them. Such
 * a branch is not brought up to date: the owner merges tracker changes out of band, and each one
 * would otherwise restart the checks of every waiting pull request.
 * @param {string} dir @param {string} base the merge base of main and the branch
 * @param {string} main @param {string[]} branchChanged the files the branch changes against main
 */
export function trackerOnlyBehind(dir, base, main, branchChanged) {
  const moved = changedFiles(dir, base, main).paths;
  const mine = new Set(branchChanged);
  return moved.every((p) => p.startsWith(TRACKER_PREFIX) && !mine.has(p));
}

/** The text of one `## <heading>` section of an item body. @param {string} body @param {string} heading */
function section(body, heading) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

/**
 * The pull request's title and body: from the item, the report's evidence and the release note.
 * @param {{ item: string, at: ItemAt, evidence: string[], checks: string[] }} o
 */
export function pullRequestText(o) {
  const done = section(o.at.body, 'Done when');
  const body = [
    `Work item: ${o.item}, ${o.at.title}`,
    '',
    ...(done ? ['## Done when', '', done, ''] : []),
    '## Evidence',
    '',
    ...(o.evidence.length ? o.evidence.map((e) => `- ${e}`) : ['- none reported']),
    '',
    '## Release note',
    '',
    o.at.release_note ? String(o.at.release_note) : 'none',
    '',
    `Opened by the HITLd merge queue. It merges once these checks pass: ${o.checks.join(', ')}.`,
    '',
  ].join('\n');
  return { title: `${o.at.title} (${o.item})`, body };
}

/**
 * The squash commit's message: the trailers the branch's own commits carry (the queue's updates
 * aside), the item's at least, and the owner's sign-off when they approved it or when the merge
 * was delegated; a delegated one adds a Delegated-by trailer naming the owner's decision.
 * @param {{ dir: string, base: string, head: string, item: string, signedOffBy?: string | null,
 *   delegatedBy?: string | null }} o
 */
export function squashMessage(o) {
  const raw = git(o.dir, [
    'log',
    '--no-merges',
    '--reverse',
    '--format=%B%x00',
    `${o.base}..${o.head}`,
  ]).out;
  /** @type {Map<string, string[]>} */
  const found = new Map(SQUASH_TRAILERS.map((k) => [k, []]));
  for (const message of raw.split('\0')) {
    for (const line of message.split('\n')) {
      const m = /^([A-Za-z-]+):[ \t]*(\S.*?)[ \t]*$/.exec(line);
      const values = m ? found.get(m[1]) : undefined;
      if (m && values && !values.includes(m[2])) values.push(m[2]);
    }
  }
  if (!found.get('Work-Item')?.length) found.set('Work-Item', [o.item]);
  const lines = [...found].flatMap(([k, vs]) => vs.map((v) => `${k}: ${v}`));
  if (o.signedOffBy) lines.push(`Signed-off-by: ${o.signedOffBy}`);
  if (o.signedOffBy && o.delegatedBy) lines.push(`Delegated-by: ${o.delegatedBy}`);
  return lines.join('\n');
}

/**
 * Whether an approval still covers a head: the head approved, or that head followed only by the
 * queue's own updates.
 * @param {string} dir @param {PullState} s @param {number} number @param {string} head
 */
export function approvalHolds(dir, s, number, head) {
  const a = s.approval;
  if (!a || a.number !== number) return false;
  if (a.head === head) return true;
  if (!isAncestor(dir, a.head, head)) return false;
  const after = git(dir, ['rev-list', '--first-parent', `${a.head}..${head}`])
    .out.split('\n')
    .filter(Boolean);
  return after.every((c) => s.updates.includes(c));
}

/**
 * Whether an approval recorded before the queue presented the pull request (HITLD-821) covers the
 * head the queue would present now: the same pull request, and the head approved, or that head
 * followed only by merges of main whose result is exactly what git makes of it. Every commit after
 * the approved head on the branch must be a merge whose other parents main holds, and the head's
 * tree must be the tree `git merge-tree --write-tree` gives for the approved head and the newest
 * main commit the head holds. A merge with a conflict, a conflict resolution, or any other change
 * made in the merge (an approved change moved elsewhere, say) drops the approval, and the owner is
 * asked about the head as it is. A git that cannot run the check drops it too.
 * @param {string} dir @param {Approval} a @param {number} number @param {string} head
 * @param {string} main the commit main is at
 */
export function aheadHolds(dir, a, number, head, main) {
  if (a.number !== number) return false;
  if (a.head === head) return true;
  if (!isAncestor(dir, a.head, head)) return false;
  const after = git(dir, ['rev-list', '--first-parent', '--parents', `${a.head}..${head}`])
    .out.split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '));
  const mergesOfMain = after.every(
    ([, , ...others]) => others.length > 0 && others.every((c) => isAncestor(dir, c, main)),
  );
  if (!mergesOfMain) return false;
  const merged = git(dir, ['merge-base', head, main]);
  if (!merged.ok) return false;
  const clean = git(dir, ['merge-tree', '--write-tree', a.head, merged.out]);
  const tree = git(dir, ['rev-parse', `${head}^{tree}`]);
  return clean.ok && tree.ok && clean.out.split('\n')[0] === tree.out;
}

/**
 * One pass of the pull-request queue over the waiting entries (the steps above). It changes only
 * branches on the remote and pull requests; main moves only by GitHub's squash merge.
 * @param {{ repoRoot: string, entries: Entry[], settings: PullSettings, policy: Record<string, any>,
 *   github: GitHub, state: PullQueueState, evidence?: (item: string) => string[],
 *   exec?: Exec, now?: () => Date }} r
 */
export async function runPullRequestQueue(r) {
  const s = r.settings;
  const exec = r.exec ?? shellExec;
  const now = r.now ?? (() => new Date());
  const remote = s.remote;
  const mainRef = `refs/remotes/${remote}/${s.mainBranch}`;
  /** Approvals recorded before a presentation, by branch: this pass applies or drops them. */
  const approvedAhead = { ...r.state.approved_ahead };
  /** @type {PullQueueState} */
  const state = { ...r.state, branches: { ...r.state.branches }, approved_ahead: approvedAhead };
  const result = {
    /** @type {PullMerged[]} */
    merged: [],
    /** @type {PullRejected[]} */
    rejected: [],
    /** @type {PullWaiting[]} */
    pending: [],
    /** Pull requests whose named checks ran past the timeout: the queue went on without them.
     * @type {PullWaiting[]} */
    stalled: [],
    /** @type {Presented[]} */
    awaiting_owner: [],
    /** Approvals recorded before the queue presented a pull request (HITLD-821): applied to the
     * head it presents, or dropped because the head moved by more than a merge of main.
     * Expired: dropped unused, its branch sent back or nothing waiting.
     * @type {{ applied: AheadOutcome[], dropped: AheadOutcome[], expired: AheadExpired[] }} */
    ahead: { applied: [], dropped: [], expired: [] },
    /** Branches the queue brought up to date with main and pushed; their checks run again.
     * @type {{ item: string, branch: string, number: number, commit: string, rebuilt: boolean }[]} */
    updated: [],
    main: { before: '', after: '' },
    /** @type {{ kind: 'fetch' | 'push' | 'update', message: string } | null} */
    incident: null,
    state,
  };
  if (!s.checks.length) {
    throw new Error(
      'policy merge.pull_request.checks is empty: with merge.via pull-request the queue waits for the checks it names, and with none it could not keep main green, so it will not merge',
    );
  }
  // Main and every waiting branch in one fetch: one round trip, not one per branch. It fails as a
  // whole when one branch is not on the remote yet; then main is fetched alone, and each branch
  // on its own below, as before.
  const branchRefspecs = [...new Set(r.entries.map((e) => e.branch))].map(
    (b) => `+refs/heads/${b}:refs/remotes/${remote}/${b}`,
  );
  const together = branchRefspecs.length
    ? git(r.repoRoot, [
        'fetch',
        '--quiet',
        remote,
        `+refs/heads/${s.mainBranch}:${mainRef}`,
        ...branchRefspecs,
      ])
    : null;
  const allFetched = together?.ok === true;
  const fetched = allFetched
    ? /** @type {{ ok: boolean, out: string, err: string }} */ (together)
    : git(r.repoRoot, ['fetch', '--quiet', remote, `+refs/heads/${s.mainBranch}:${mainRef}`]);
  if (!fetched.ok) {
    result.incident = { kind: 'fetch', message: `fetching ${s.mainBranch}: ${fetched.err}` };
    return result;
  }
  let main = gitOk(r.repoRoot, ['rev-parse', mainRef]);
  result.main.before = main;
  result.main.after = main;
  // Branches no longer waiting are no longer the queue's.
  const waitingBranches = new Set(r.entries.map((e) => e.branch));
  for (const b of Object.keys(state.branches))
    if (!waitingBranches.has(b)) delete state.branches[b];
  /** @param {string} branch @param {AheadExpired['why']} why */
  const expire = (branch, why) => {
    const a = approvedAhead[branch];
    if (!a) return;
    delete approvedAhead[branch];
    result.ahead.expired.push({
      branch,
      number: a.number,
      approved_head: a.head,
      by: a.by,
      at: a.at,
      why,
    });
  };
  /** @type {Presented[]} */
  const presented = [];
  if (!r.entries.length) {
    state.presented = null;
    for (const b of Object.keys(approvedAhead)) expire(b, 'nothing_waiting');
    return result;
  }

  const dir = mkdtempSync(join(tmpdir(), 'hitld-merge-pr-'));
  gitOk(r.repoRoot, ['worktree', 'add', '--detach', '--force', dir, main]);
  try {
    for (const cmd of s.setup ?? []) {
      const out = exec(cmd, dir, {});
      if (!out.ok) throw new Error(`the queue worktree's setup failed at "${cmd}": ${out.output}`);
    }
    /** @param {string} sha */
    const checkout = (sha) => gitOk(dir, ['checkout', '--detach', '--force', '--quiet', sha]);
    const rejectedNow = new Set();
    /** @param {Entry} e @param {Omit<PullRejected, 'item' | 'branch' | 'dispatch'>} why */
    const reject = (e, why) => {
      result.rejected.push({
        item: e.item,
        branch: e.branch,
        ...why,
        ...(e.dispatch ? { dispatch: e.dispatch } : {}),
      });
      rejectedNow.add(e.item);
      delete state.branches[e.branch];
      // An approval given before the presentation is not kept for what the executor sends next.
      expire(e.branch, 'rejected');
    };
    // A pull request still running its checks, or one just updated, holds the merges after it.
    let held = false;

    for (const e of dependencyOrder(r.entries)) {
      if ((e.needs ?? []).some((n) => rejectedNow.has(n))) {
        reject(e, { reason: 'needs_rejected' });
        continue;
      }
      const branchRef = `refs/remotes/${remote}/${e.branch}`;
      const got = allFetched
        ? { ok: true }
        : git(r.repoRoot, ['fetch', '--quiet', remote, `+refs/heads/${e.branch}:${branchRef}`]);
      if (!got.ok) {
        // Only this checkout has it: push it, never forced.
        if (!git(r.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${e.branch}`]).ok) {
          reject(e, { reason: 'missing' });
          continue;
        }
        const pushed = git(r.repoRoot, [
          'push',
          '--quiet',
          remote,
          `refs/heads/${e.branch}:refs/heads/${e.branch}`,
        ]);
        if (!pushed.ok) {
          result.incident = { kind: 'push', message: `pushing ${e.branch}: ${pushed.err}` };
          break;
        }
        gitOk(r.repoRoot, ['fetch', '--quiet', remote, `+refs/heads/${e.branch}:${branchRef}`]);
      }
      let head = gitOk(r.repoRoot, ['rev-parse', branchRef]);
      const base = gitOk(r.repoRoot, ['merge-base', main, head]);
      checkout(head);

      // The guards the local queue runs whatever the policy says.
      const guard = checkCommits(dir, base, head, s.classification ?? STRICT);
      if (guard.refused.length) {
        reject(e, {
          reason: 'classification',
          files: [...new Set(guard.refused.filter((x) => !x.commit).map((x) => x.path))],
          output: problemLines(guard.refused).join('\n'),
        });
        continue;
      }
      const duplicates = s.trackerCheck?.(dir) ?? [];
      if (duplicates.length) {
        reject(e, {
          reason: 'duplicate_id',
          output: duplicates.join('\n'),
          message: `Your branch holds two tracker items with one ID: ${duplicates.join('; ')}. Give the item your branch adds a new ID (only the orchestrator creates items) and take the duplicate out of the branch.`,
        });
        continue;
      }
      const kbErrors = s.kbCheck?.(dir) ?? [];
      if (kbErrors.length) {
        reject(e, {
          reason: 'knowledge_base',
          output: kbErrors.join('\n'),
          message: kbMessage('', kbErrors),
        });
        continue;
      }
      const diff = changedFiles(dir, main, head);
      const changed = diff.paths;
      // The checks this change waits for: the named ones, and a conditional one it calls for.
      const checks = checksFor(changed, s);
      if (changed.includes(QUARANTINE_PATH)) {
        reject(e, {
          reason: 'quarantine',
          files: [QUARANTINE_PATH],
          message: `Your branch changes ${QUARANTINE_PATH}. Only the orchestrator quarantines a test, and only on evidence; take the change out of the branch. If a test is flaky, say so in your report, with the rerun that shows it.`,
        });
        continue;
      }
      const at = s.itemAt(dir, e.item);
      if (!at || at.state !== 'done') {
        reject(e, {
          reason: 'not_closed',
          message: `Your branch does not close ${e.item}${at ? ` (it is ${at.state ?? 'without a state'})` : ' (the item is not in it)'}. Run hitld work close ${e.item} in the branch, as the last change, so the close lands in the same pull request.`,
        });
        continue;
      }

      // The pull request, opened or brought up to date, its text checked before it is posted.
      const text = pullRequestText({
        item: e.item,
        at,
        evidence: r.evidence?.(e.item) ?? [],
        checks,
      });
      const terms = s.classification?.terms ?? [];
      const found = [
        ...findTerms(text.title, terms).map((m) => matchMessage(m, 'title')),
        ...findTerms(text.body, terms).map((m) => matchMessage(m, 'body')),
      ];
      if (found.length) {
        reject(e, {
          reason: 'publish',
          output: found.join('\n'),
          message: `The pull request for ${e.item}, written from the item and your report, holds a private term (${found.join('; ')}). Write it again by role in the item or your report, and check it with hitld publish check.`,
        });
        continue;
      }
      let pr = r.github.findPull(e.branch, s.mainBranch);
      pr = pr
        ? r.github.updatePull(pr.number, text)
        : r.github.createPull({ head: e.branch, base: s.mainBranch, ...text });
      const known = state.branches[e.branch];
      /** @type {PullState} */
      const ps = {
        item: e.item,
        number: pr.number,
        url: pr.url,
        head,
        since:
          known && known.head === head && known.number === pr.number
            ? known.since
            : now().toISOString(),
        updates: known?.number === pr.number ? known.updates : [],
        ...(known?.approval ? { approval: known.approval } : {}),
        ...(known?.refused_behind === head ? { refused_behind: head } : {}),
      };
      state.branches[e.branch] = ps;
      const info = {
        item: e.item,
        branch: e.branch,
        number: pr.number,
        url: pr.url,
        ...(e.dispatch ? { dispatch: e.dispatch } : {}),
      };

      // The named checks, and only those.
      const reported = r.github.checks(head);
      /** @type {Check[]} */
      const named = checks.map((name) => {
        const hits = reported.filter((c) => c.name === name);
        const url = hits.find((c) => c.url)?.url;
        /** @type {Check['state']} */
        const state = hits.some((c) => c.state === 'failure')
          ? 'failure'
          : hits.length && hits.every((c) => c.state === 'success')
            ? 'success'
            : 'pending';
        return { name, state, ...(url ? { url } : {}) };
      });
      const failed = named.filter((c) => c.state === 'failure');
      if (failed.length) {
        reject(e, {
          reason: 'checks',
          checks: failed,
          number: pr.number,
          url: pr.url,
          message: `The checks ${failed.map((c) => `"${c.name}"`).join(', ')} failed on your pull request ${pr.url}${failed.some((c) => c.url) ? ` (${failed.flatMap((c) => (c.url ? [c.url] : [])).join(', ')})` : ''}. Fix it on your branch and push it; never force-push.`,
        });
        continue;
      }
      const pendingNames = named.filter((c) => c.state === 'pending').map((c) => c.name);
      if (pendingNames.length) {
        const waited = Math.max(0, now().getTime() - Date.parse(ps.since));
        const w = { ...info, head, checks: pendingNames, waited_ms: waited };
        if (waited > s.checkTimeoutMinutes * 60_000) result.stalled.push(w);
        else {
          result.pending.push(w);
          held = true;
        }
        continue;
      }

      // Green. Whether it waits for the owner is decided from its paths alone. One that does not
      // wait merges under the owner's delegation when the policy names it, with their sign-off;
      // with none of theirs known yet, it waits for them after all.
      const waits = pullRequestWaits(changed, r.policy, diff.links);
      const owner = r.policy.merge?.mode === 'owner';
      // A change to a decision's answer merges without asking only as rights answer recorded it
      // (decision HITLD-310); one that does not match waits for the owner.
      const unverified =
        !waits && owner
          ? unverifiedAnswers({ dir, base, head, paths: changed, events: s.answers ?? [] })
          : [];
      const delegatedBy = !waits && owner ? (s.delegatedBy ?? null) : null;
      const noSignoff = Boolean(delegatedBy) && !state.owner_signoff;
      const holds = waits || noSignoff || unverified.length > 0;
      let approved = holds && approvalHolds(dir, ps, pr.number, head);
      // An approval given before this point (HITLD-821) is used here, where the queue would put
      // the pull request to the owner, once: applied to this head, or dropped.
      const ahead = holds ? approvedAhead[e.branch] : undefined;
      if (ahead) {
        delete approvedAhead[e.branch];
        const outcome = {
          ...info,
          approved_head: ahead.head,
          head,
          by: ahead.by,
          at: ahead.at,
          presented_at: now().toISOString(),
        };
        if (!approved && aheadHolds(dir, ahead, pr.number, head, main)) {
          ps.approval = { ...ahead, head, ahead: ahead.head };
          approved = true;
          result.ahead.applied.push(outcome);
        } else if (!approved) result.ahead.dropped.push(outcome);
      }
      if (holds && !approved) {
        const shown = {
          ...info,
          head,
          changed,
          checks: [...checks],
          ...(diff.links.length ? { links: diff.links } : {}),
          ...(noSignoff ? { no_signoff: /** @type {const} */ (true) } : {}),
          ...(unverified.length ? { answer_unverified: unverified } : {}),
        };
        presented.push(shown);
        result.awaiting_owner.push(shown);
        continue;
      }
      if (held) continue;

      // Behind main only by tracker changes the branch does not touch: merged as it is, its
      // checks not run again (HITLD-777), unless GitHub refused that once for this head.
      const behind =
        !isAncestor(dir, main, head) &&
        !(ps.refused_behind !== head && trackerOnlyBehind(dir, base, main, changed));
      if (behind) {
        // Behind main: merge main in, rebuild, push, and check again.
        const merged = git(dir, [
          'merge',
          '--no-edit',
          '--quiet',
          '-m',
          `merge queue: bring ${e.branch} up to date with ${s.mainBranch}`,
          main,
        ]);
        if (!merged.ok) {
          const files = git(dir, ['diff', '--name-only', '--diff-filter=U'])
            .out.split('\n')
            .filter(Boolean);
          git(dir, ['merge', '--abort']);
          if (!files.length) {
            // Not a conflict: git could not merge at all (no committer identity, say). Nothing is
            // the executor's to fix, so nothing is sent back; the queue stops and says why.
            result.incident = {
              kind: 'update',
              message: `merging ${s.mainBranch} into ${e.branch} failed without a conflict: ${merged.err || merged.out}`,
            };
            break;
          }
          reject(e, {
            reason: 'conflict',
            files,
            number: pr.number,
            url: pr.url,
            message: `Merge ${s.mainBranch} into your branch: it conflicts with merged work in ${files.join(', ') || 'your branch'}. Keep both intents (merge, never rebase or force-push); if they contradict, say so under questions.`,
          });
          continue;
        }
        const added = [gitOk(dir, ['rev-parse', 'HEAD'])];
        let rebuilt = false;
        for (const g of s.generated) {
          if (!g.regenerate) continue;
          const out = exec(g.regenerate, dir, {});
          if (!out.ok) throw new Error(`regenerating ${g.globs.join(', ')} failed: ${out.output}`);
        }
        if (stageAll(dir)) {
          gitOk(dir, [
            'commit',
            '--quiet',
            '--no-verify',
            '-m',
            `merge queue: rebuild generated files (${e.item})`,
          ]);
          added.push(gitOk(dir, ['rev-parse', 'HEAD']));
          rebuilt = true;
        }
        const fresh = gitOk(dir, ['rev-parse', 'HEAD']);
        // The queue's own commits skip hooks, so the rule runs on them directly.
        const again = checkCommits(dir, head, fresh, s.classification ?? STRICT);
        if (again.refused.length) {
          reject(e, { reason: 'classification', output: problemLines(again.refused).join('\n') });
          continue;
        }
        const pushed = git(dir, ['push', '--quiet', remote, `HEAD:refs/heads/${e.branch}`]);
        if (!pushed.ok) {
          // The branch moved on the remote meanwhile: the next pass starts from it.
          result.pending.push({ ...info, head, checks: [...checks], waited_ms: 0 });
          held = true;
          continue;
        }
        gitOk(r.repoRoot, ['fetch', '--quiet', remote, `+refs/heads/${e.branch}:${branchRef}`]);
        head = fresh;
        const { refused_behind: _, ...kept } = ps;
        state.branches[e.branch] = {
          ...kept,
          head,
          since: now().toISOString(),
          updates: [...ps.updates, ...added],
        };
        result.updated.push({
          item: e.item,
          branch: e.branch,
          number: pr.number,
          commit: head,
          rebuilt,
        });
        held = true;
        continue;
      }

      // Up to date and green: squash-merge it, only while the head is still the one checked.
      const delegated = !approved && delegatedBy && state.owner_signoff ? delegatedBy : null;
      const signedOffBy = approved
        ? (ps.approval?.signed_off_by ?? null)
        : delegated
          ? (state.owner_signoff ?? null)
          : null;
      const done = r.github.mergePull(pr.number, {
        sha: head,
        title: `${text.title} (#${pr.number})`,
        message: squashMessage({
          dir,
          base: main,
          head,
          item: e.item,
          signedOffBy,
          delegatedBy: delegated,
        }),
      });
      if (!done.merged) {
        // One left behind main that GitHub would not merge (a protected main can require it up
        // to date) is brought up to date on the next pass, as before.
        if (!isAncestor(dir, main, head))
          state.branches[e.branch] = { ...ps, refused_behind: head };
        result.pending.push({ ...info, head, checks: [], waited_ms: 0 });
        held = true;
        continue;
      }
      const again = git(r.repoRoot, [
        'fetch',
        '--quiet',
        remote,
        `+refs/heads/${s.mainBranch}:${mainRef}`,
      ]);
      if (!again.ok) {
        result.incident = {
          kind: 'fetch',
          message: `fetching ${s.mainBranch} after #${pr.number}: ${again.err}`,
        };
        break;
      }
      main = gitOk(r.repoRoot, ['rev-parse', mainRef]);
      result.main.after = main;
      const a = approved ? ps.approval : undefined;
      result.merged.push({
        ...info,
        commit: done.sha,
        signed_off: Boolean(signedOffBy),
        changed,
        approval: a
          ? {
              at: a.at,
              presented_at: a.presented_at ?? null,
              as_presented: a.as_presented ?? true,
            }
          : null,
        delegated_by: delegated,
      });
      delete state.branches[e.branch];
      delete approvedAhead[e.branch];
    }
  } finally {
    git(r.repoRoot, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
    git(r.repoRoot, ['worktree', 'prune']);
  }
  state.presented = presented.length ? { at: now().toISOString(), branches: presented } : null;
  return result;
}

/**
 * Record the owner's approval of presented pull requests in the state: `all`, or the names given
 * (branch or item). Each must be presented, with its head unmoved since. Returns the approvals made,
 * or what refused them; the state is changed only when nothing is refused. The sign-off given is
 * kept as the owner's latest (owner_signoff), for merges under their delegation.
 * @param {{ state: PullQueueState, all?: boolean, names?: string[], signedOffBy: string, by: string, at: string,
 *   heads: (branch: string) => string | null }} o
 * @returns {{ approved: Presented[], refused: { unknown: string[], moved: string[] } | null }}
 */
export function approvePulls(o) {
  const shown = o.state.presented?.branches ?? [];
  const names = o.names ?? [];
  /** @type {string[]} */
  const unknown = [];
  /** @type {Presented[]} */
  const chosen = [];
  if (o.all) chosen.push(...shown);
  else {
    if (!names.length) unknown.push('(none named)');
    for (const n of names) {
      const hit = shown.filter((b) => b.branch === n || b.item === n);
      if (hit.length === 1) chosen.push(hit[0]);
      else unknown.push(n);
    }
  }
  if (!chosen.length && !unknown.length) unknown.push('(nothing presented)');
  const moved = chosen.filter((b) => o.heads(b.branch) !== b.head).map((b) => b.branch);
  if (unknown.length || moved.length) return { approved: [], refused: { unknown, moved } };
  const asPresented = chosen.length === shown.length;
  for (const b of chosen) {
    const ps = o.state.branches[b.branch];
    if (!ps) continue;
    ps.approval = {
      number: b.number,
      head: b.head,
      signed_off_by: o.signedOffBy,
      at: o.at,
      by: o.by,
      ...(o.state.presented?.at ? { presented_at: o.state.presented.at } : {}),
      as_presented: asPresented,
    };
  }
  // The sign-off the owner gave here is the one a merge under their delegation carries.
  if (chosen.length) o.state.owner_signoff = o.signedOffBy;
  return { approved: chosen, refused: null };
}

/**
 * Record the owner's approval of one pull request's head before the queue presents it (HITLD-821):
 * the owner answered from the pull request itself, so the approval need not wait a round trip for
 * the presentation. It needs an open pull request whose head is the one approved; the queue
 * applies it when it would present that head, or that head followed only by merges of main
 * (aheadHolds), and drops it otherwise. The state is changed only when nothing is refused; the
 * sign-off given is kept as the owner's latest, as approvePulls keeps it.
 * @param {{ state: PullQueueState, branch: string, head: string,
 *   pull: import('./github.mjs').PullRequest | null, signedOffBy: string, by: string, at: string }} o
 * @returns {{ refused: 'no_pull_request' | 'moved' | null }}
 */
export function approveAhead(o) {
  if (!o.pull || o.pull.state !== 'open') return { refused: 'no_pull_request' };
  if (o.pull.head !== o.head) return { refused: 'moved' };
  o.state.approved_ahead = {
    ...o.state.approved_ahead,
    [o.branch]: {
      number: o.pull.number,
      head: o.head,
      signed_off_by: o.signedOffBy,
      at: o.at,
      by: o.by,
      as_presented: true,
    },
  };
  o.state.owner_signoff = o.signedOffBy;
  return { refused: null };
}

/**
 * The trust events for merged pull requests (design 14.2): for each the owner approved, a
 * merge-approval per area it changes, with the latency from its presentation to the approval and
 * whether the owner took what was presented; for each merged under their delegation, a
 * merge-delegated per area, which a later revert counts against.
 * @param {PullMerged[]} merged @param {Record<string, any>} policy
 * @returns {Record<string, any>[]} events for recordTrustEvent, without schema_version and at
 */
export function pullTrustEvents(merged, policy) {
  return merged.flatMap((m) => trustEventsOf(m, policy));
}

/** @param {PullMerged} m @param {Record<string, any>} policy @returns {Record<string, any>[]} */
function trustEventsOf(m, policy) {
  const found = areasOf(m.changed, policy);
  const areas = found.length ? found : [UNASSIGNED];
  if (m.approval) {
    const a = m.approval;
    const latency = a.presented_at ? Date.parse(a.at) - Date.parse(a.presented_at) : NaN;
    return areas.map((area) => ({
      kind: 'merge-approval',
      area,
      subject: m.item,
      decider: 'owner',
      commit: m.commit,
      ...(Number.isFinite(latency) ? { latency_ms: Math.max(0, latency) } : {}),
      as_presented: a.as_presented,
    }));
  }
  if (m.delegated_by) {
    return areas.map((area) => ({
      kind: 'merge-delegated',
      area,
      subject: m.item,
      commit: m.commit,
      note: `merged without asking under ${m.delegated_by}`,
    }));
  }
  return [];
}

/**
 * The command that reverses a squash merge on this path: main moves only through a pull request,
 * so the revert is a branch of its own, and the ledger is told, which counts it against the area.
 * @param {{ item: string, commit: string }} m
 */
export const revertCommand = (m) =>
  `git revert --no-edit ${m.commit} on a branch of its own, merged through a pull request; then hitld ledger append '${JSON.stringify({ event: 'reverted', item: m.item })}'`;

/** A sign-off line's value: `Name <email>`. @param {string} s */
export const validSignoff = (s) => /^[^<>\n]+\S <[^<>\s@]+@[^<>\s@]+>$/.test(s.trim());
