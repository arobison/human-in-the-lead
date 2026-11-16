// Teardown of finished worktrees (design part 13.2). After a merge, and each time the watchdog runs,
// every worktree the manager leased goes once its branch has merged or its dispatch has ended,
// through the manager's own release (uncommitted work saved first, links unlinked, its port and
// locks freed). The primary checkout is never removed, and neither is a worktree a live dispatch
// holds: one in flight under that holder, or on that branch or path (a follow-up continues in the
// worktree of the dispatch it follows).
//
// A worktree the harness made and the executor adopted is removed only once its branch has
// merged: its work is then on the main branch. When its dispatch ended unmerged, only the lease is
// dropped and the harness keeps it. A worktree kept after a failure stays for inspection, within
// env.failed_worktrees_kept.

import { realpathSync } from 'node:fs';
import { applyInflight } from '../ledger/inflight.mjs';
import { git, gitOk } from './git.mjs';

/**
 * @typedef {import('./registry.mjs').WorktreeLease} WorktreeLease
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {{ holder: string, path: string, branch: string, result: 'merged' | 'abandoned', why: string }} Removal
 * @typedef {{ holder: string, path: string, branch: string, why: string }} Kept
 */

/** @param {string} p */
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Which leased worktrees go, and why each that stays stays. Pure.
 * @param {{ leases: WorktreeLease[], events: LedgerEntry[], merged: (lease: WorktreeLease) => boolean,
 *   primary: string }} r
 *   merged: whether git says the lease's branch is in the main branch; the ledger's merged events
 *   are read here
 * @returns {{ remove: Removal[], keep: Kept[] }}
 */
export function teardownPlan(r) {
  /** @type {import('../ledger/inflight.mjs').InFlight[]} */
  const live = [];
  for (const e of r.events) applyInflight(live, e);
  /** @type {Map<string, LedgerEntry>} */
  const dispatched = new Map();
  /** @type {Set<string>} */
  const abandoned = new Set();
  for (const e of r.events) {
    if (e.event === 'dispatched' && e.dispatch && !dispatched.has(e.dispatch))
      dispatched.set(e.dispatch, e);
    if (e.event === 'abandoned' && e.dispatch) abandoned.add(e.dispatch);
  }
  /** @param {WorktreeLease} l */
  const mergedInLedger = (l) => {
    const d = dispatched.get(l.holder);
    return r.events.some(
      (e) =>
        e.event === 'merged' &&
        ((e.branch && e.branch === l.branch) ||
          (e.dispatch && e.dispatch === l.holder) ||
          (d && e.item === d.item && String(e.at) >= String(d.at))),
    );
  };
  const primary = real(r.primary);
  /** @type {Removal[]} */
  const remove = [];
  /** @type {Kept[]} */
  const keep = [];
  for (const l of r.leases) {
    const at = { holder: l.holder, path: l.path, branch: l.branch };
    if (real(l.path) === primary || real(l.path) === real(l.repo_root)) {
      keep.push({ ...at, why: 'the primary checkout' });
      continue;
    }
    const holder = live.find(
      (d) =>
        d.dispatch === l.holder ||
        d.branch === l.branch ||
        (d.worktree && real(d.worktree) === real(l.path)),
    );
    if (holder) {
      keep.push({ ...at, why: `held by ${holder.dispatch}, which is in flight` });
      continue;
    }
    if (l.state === 'failed') {
      keep.push({ ...at, why: 'kept for inspection after a failure (env.failed_worktrees_kept)' });
      continue;
    }
    if (mergedInLedger(l) || r.merged(l)) {
      remove.push({ ...at, result: 'merged', why: `${l.branch} has merged` });
      continue;
    }
    if (abandoned.has(l.holder)) {
      remove.push({
        ...at,
        result: 'abandoned',
        why: `${l.holder} was abandoned; the branch stays`,
      });
      continue;
    }
    keep.push({ ...at, why: 'not merged, and its dispatch has not ended' });
  }
  return { remove, keep };
}

/**
 * Remove the worktrees that are done (teardownPlan), through the manager's release, and list the
 * worktrees git has that the manager never leased, which it leaves alone.
 * @param {ReturnType<typeof import('./manager.mjs').openEnv>} env
 * @param {{ events: LedgerEntry[], primary: string }} r
 */
export async function tearDown(env, r) {
  const main = env.settings.mainBranch;
  const leases = Object.values(env.registry().worktrees);
  /** @type {Map<string, boolean>} */
  const ancestry = new Map();
  for (const l of leases) {
    if (l.branch === 'HEAD') continue;
    ancestry.set(
      l.holder,
      await gitOk(['merge-base', '--is-ancestor', `refs/heads/${l.branch}`, main], l.repo_root),
    );
  }
  const planned = teardownPlan({
    leases,
    events: r.events,
    merged: (l) => ancestry.get(l.holder) === true,
    primary: r.primary,
  });
  /** @type {(Removal & { error?: string })[]} */
  const removed = [];
  for (const x of planned.remove) {
    try {
      await env.releaseHolder({
        holder: x.holder,
        result: x.result,
        removeAdopted: x.result === 'merged',
      });
      removed.push(x);
    } catch (e) {
      removed.push({ ...x, error: /** @type {Error} */ (e).message });
    }
  }
  return {
    removed: removed.filter((x) => !x.error),
    failed: removed.filter((x) => x.error),
    kept: planned.keep,
    untracked: await untrackedWorktrees(r.primary, leases),
  };
}

/**
 * The worktrees git lists for the primary checkout that no lease names, beside the primary itself.
 * @param {string} primary @param {WorktreeLease[]} leases
 * @returns {Promise<{ path: string, branch: string | null }[]>}
 */
async function untrackedWorktrees(primary, leases) {
  let out = '';
  try {
    out = await git(['worktree', 'list', '--porcelain'], primary);
  } catch {
    return [];
  }
  const leased = new Set(leases.map((l) => real(l.path)));
  const top = real(primary);
  /** @type {{ path: string, branch: string | null }[]} */
  const list = [];
  for (const block of out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path || real(path) === top || leased.has(real(path))) continue;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    list.push({ path, branch });
  }
  return list;
}
