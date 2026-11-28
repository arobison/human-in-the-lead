// The merge backlog (design parts 2.5 and 13.4): finished branches that have not merged, as a
// limit on starting more work (HITLD-1046). The owner's attention and the merge queue are both
// scarce: starting work while finished branches pile up only lengthens the wait.
//
// Each branch awaiting merge waits on one of three things:
//
//   owner        it changes a path the owner holds (merge.owner_paths and merge.owner_areas, in
//                owner mode, as the merge path routes it) and has no approval of theirs yet
//   checks       its pull request is open and its named checks have not let it merge yet, or the
//                merge queue sent it back for a follow-up
//   merge_queue  anything else not held for the owner: approved by the owner, or routed past them,
//                and waiting for the queue to take it
//
// Two rules read the split. With dispatch.owner_queue_max or more branches waiting on the owner,
// the plan offers ready work whose touches do not route to the owner ahead of work that does, in
// the same tier of the ready queue. With merge.batch_max or more waiting on the merge queue or its
// checks (one full batch), no new dispatch starts; a branch waiting on the owner does not count,
// since the owner's queue is a different backlog, and an item that fixes a stuck merge still may.

import { spawnSync } from 'node:child_process';
import { sample } from './item.mjs';
import { waited, waitsForOwner } from '../merge/owner.mjs';

/** The setting that names the most branches that may wait on the owner. */
export const OWNER_QUEUE_KEY = 'dispatch.owner_queue_max';
/** The setting one batch is read from. */
export const BATCH_KEY = 'merge.batch_max';

/** @typedef {'owner' | 'checks' | 'merge_queue'} Waits */

/**
 * @typedef {object} BacklogEntry one finished branch awaiting merge
 * @property {string} item
 * @property {string} branch
 * @property {string} since when its work was verified and queued to merge
 * @property {boolean} [sent_back]
 *
 * @typedef {{ count: number, items: string[], oldest: string | null, oldest_since: string | null,
 *   oldest_waited_ms: number | null }} BacklogPart
 *
 * @typedef {object} Backlog
 * @property {number} total
 * @property {BacklogPart} owner
 * @property {BacklogPart} merge_queue
 * @property {BacklogPart} checks
 * @property {number} owner_queue_max
 * @property {boolean} owner_queue_full the owner's queue is at or over owner_queue_max
 * @property {number} batch_max
 * @property {number} queue_held waiting on the merge queue or its checks: what the hold counts
 * @property {boolean} hold starts hold: queue_held is at or over batch_max
 */

/**
 * Whether a branch that changes these paths waits for the owner, as the merge path decides it
 * (merge/pull-request.mjs pullRequestWaits): never outside owner mode; always when no path is
 * known; otherwise by merge.owner_paths and merge.owner_areas.
 * @param {string[]} paths @param {Record<string, any>} policy
 */
export function routesToOwner(paths, policy) {
  if (policy.merge?.mode !== 'owner') return false;
  if (!paths.length) return true;
  return waitsForOwner(paths, policy);
}

/**
 * Whether a ready item's work will wait for the owner once finished, judged from the paths it
 * will change: a sample path for each of its touches globs, and its own item file, which its
 * close changes. With no touches the paths are not known, and it counts as routed to the owner.
 * @param {string[]} touches @param {string | undefined} itemPath @param {Record<string, any>} policy
 */
export function touchesRouteToOwner(touches, itemPath, policy) {
  if (!touches.length) return policy.merge?.mode === 'owner';
  const paths = touches.map(sample);
  if (typeof itemPath === 'string' && itemPath) paths.push(itemPath);
  return routesToOwner(paths, policy);
}

/**
 * What one branch awaiting merge waits on.
 * @param {BacklogEntry} a @param {Record<string, any>} policy
 * @param {import('../merge/pull-request.mjs').PullQueueState | null} pulls the pull-request
 *   queue's state, when merge.via is pull-request
 * @param {(a: BacklogEntry) => string[] | null} changed the files the branch changes against main,
 *   null when git cannot tell
 * @returns {Waits}
 */
export function waitsOn(a, policy, pulls, changed) {
  if (a.sent_back) return 'checks';
  const pr = pulls?.branches?.[a.branch];
  if (pr?.approval) return 'merge_queue';
  const presented = pulls?.presented?.branches?.find((b) => b.branch === a.branch);
  if (presented) return 'owner';
  if (routesToOwner(changed(a) ?? [], policy)) return 'owner';
  return pr ? 'checks' : 'merge_queue';
}

/**
 * The merge backlog: the branches awaiting merge split by what each waits on, with the oldest of
 * each and how long it has waited, and whether the two rules apply.
 * @param {BacklogEntry[]} awaiting
 * @param {{ policy: Record<string, any>, pulls?: import('../merge/pull-request.mjs').PullQueueState | null,
 *   changed?: (a: BacklogEntry) => string[] | null, now?: number }} o
 * @returns {Backlog}
 */
export function mergeBacklog(awaiting, o) {
  const now = o.now ?? Date.now();
  const changed = o.changed ?? (() => null);
  /** @type {Record<Waits, BacklogEntry[]>} */
  const by = { owner: [], checks: [], merge_queue: [] };
  for (const a of awaiting) by[waitsOn(a, o.policy, o.pulls ?? null, changed)].push(a);
  /** @param {BacklogEntry[]} list @returns {BacklogPart} */
  const part = (list) => {
    const dated = list
      .map((a) => ({ a, t: Date.parse(a.since) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((x, y) => x.t - y.t);
    const first = dated[0];
    return {
      count: list.length,
      items: list.map((a) => a.item),
      oldest: first?.a.item ?? null,
      oldest_since: first?.a.since ?? null,
      oldest_waited_ms: first ? Math.max(0, now - first.t) : null,
    };
  };
  const ownerMax = ownerQueueMax(o.policy);
  const batchMax = batchMaxOf(o.policy);
  const queueHeld = by.merge_queue.length + by.checks.length;
  return {
    total: awaiting.length,
    owner: part(by.owner),
    merge_queue: part(by.merge_queue),
    checks: part(by.checks),
    owner_queue_max: ownerMax,
    owner_queue_full: by.owner.length >= ownerMax,
    batch_max: batchMax,
    queue_held: queueHeld,
    hold: queueHeld >= batchMax,
  };
}

/** @param {Record<string, any>} policy */
export const ownerQueueMax = (policy) => positive(policy.dispatch?.owner_queue_max, 4);
/** @param {Record<string, any>} policy */
export const batchMaxOf = (policy) => positive(policy.merge?.batch_max, 4);

/** @param {unknown} v @param {number} d */
const positive = (v, d) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : d;
};

/**
 * The ready queue with the owner's queue full: in each tier, the items whose work does not route
 * to the owner go first, each part in the order it had. A tier is the release an item serves, and
 * the items outside every release make one tier after them all. With the owner's queue not full
 * the queue is unchanged.
 * @template {Record<string, any>} T
 * @param {T[]} queue in release-chain order
 * @param {Backlog} backlog
 * @param {(id: string) => number | null} tierOf the item's release tier, null outside every release
 * @param {(item: T) => boolean} toOwner whether the item's work routes to the owner
 * @returns {{ queue: T[], deferred: string[], note: string | null }}
 */
export function ownerQueueOrder(queue, backlog, tierOf, toOwner) {
  if (!backlog.owner_queue_full) return { queue, deferred: [], note: null };
  const rank = (/** @type {T} */ i) => tierOf(String(i.id)) ?? Number.MAX_SAFE_INTEGER;
  const routed = new Map(queue.map((i) => [String(i.id), toOwner(i)]));
  const out = queue
    .map((i, n) => ({ i, n }))
    .sort(
      (x, y) =>
        rank(x.i) - rank(y.i) ||
        Number(routed.get(String(x.i.id))) - Number(routed.get(String(y.i.id))) ||
        x.n - y.n,
    )
    .map((x) => x.i);
  // An item is deferred when an item of its tier that does not route to the owner was behind it.
  const deferred = queue
    .filter((i, n) => routed.get(String(i.id)) && out.indexOf(i) > n)
    .map((i) => String(i.id));
  const waiting = `${backlog.owner.count} finished branch${backlog.owner.count === 1 ? '' : 'es'} wait${backlog.owner.count === 1 ? 's' : ''} on the owner (${OWNER_QUEUE_KEY} ${backlog.owner_queue_max})`;
  const note = deferred.length
    ? `${waiting}: in each tier, work that does not route to the owner is offered first, so ${deferred.join(', ')} ${deferred.length === 1 ? 'goes' : 'go'} after it; starting more work for the owner would only lengthen their wait`
    : `${waiting}: work that does not route to the owner goes first in each tier, and no ready item moved`;
  return { queue: out, deferred, note };
}

/**
 * Why starts hold for the merge backlog, in the plan's words.
 * @param {Backlog} b
 */
export const backlogHoldText = (b) =>
  `${b.queue_held} finished branch${b.queue_held === 1 ? '' : 'es'} wait${b.queue_held === 1 ? 's' : ''} on the merge queue (${b.merge_queue.count} queued, ${b.checks.count} on checks; ${BATCH_KEY} ${b.batch_max}, one full batch): no new work starts until the queue takes some; ${b.owner.count} waiting on the owner do not count`;

/**
 * The files each finished branch changes against main, from git as data: this checkout's branch
 * and main, else the remote's copies (a branch an executor pushed, in a session that cannot keep
 * it locally). Null when git finds neither.
 * @param {string} repoRoot @param {Record<string, any>} policy
 * @returns {(a: BacklogEntry) => string[] | null}
 */
export function branchChanges(repoRoot, policy) {
  const main = String(policy.merge?.main_branch ?? 'main');
  const remote = String(policy.merge?.pull_request?.remote ?? 'origin');
  return (a) => {
    if (!/^[\w./-]+$/.test(a.branch)) return null;
    for (const [m, b] of [
      [`refs/heads/${main}`, `refs/heads/${a.branch}`],
      [`refs/remotes/${remote}/${main}`, `refs/remotes/${remote}/${a.branch}`],
    ]) {
      const r = spawnSync('git', ['diff', '--name-only', `${m}...${b}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      if (r.status === 0) return (r.stdout ?? '').split('\n').filter(Boolean);
    }
    return null;
  };
}

/**
 * The merge backlog as the plan and the run's status show it: how many finished branches wait,
 * split by what they wait on, the oldest of each and how long it has waited, and whether starts
 * hold for it.
 * @param {Backlog} b
 */
export const backlogJson = (b) => {
  const part = (/** @type {BacklogPart} */ x) => ({
    ...x,
    oldest_waited: x.oldest ? waited(x.oldest_waited_ms) : null,
  });
  return {
    total: b.total,
    owner: part(b.owner),
    merge_queue: part(b.merge_queue),
    checks: part(b.checks),
    owner_queue_max: b.owner_queue_max,
    owner_queue_full: b.owner_queue_full,
    batch_max: b.batch_max,
    queue_held: b.queue_held,
    hold: b.hold,
  };
};
