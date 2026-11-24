// The merges the owner has seen or approved that have not happened yet (HITLD-823): what a
// hand-over must not leave behind unnamed. Read from the two places owner mode keeps them, the
// pull-request queue's state (merge.via pull-request) and the local queue's presentation, and
// from the ledger's merge-approved events. Reads only.

import { readPresentation, recordedApproval } from './owner.mjs';
import { readPullState } from './pull-request.mjs';

/**
 * @typedef {{ item: string | null, branch: string, number: number | null, url: string | null,
 *   status: 'approved' | 'presented' }} PendingMerge approved: the owner said yes and the merge
 *   has not been applied; presented: put to the owner, no answer recorded yet
 */

/**
 * Every approved or presented merge still waiting, approved first. With `waiting` (the run's merge
 * queue), a branch that no longer waits there (merged, or sent back) is left out.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {Record<string, any>[]} events the ledger
 * @param {{ branch: string | null }[]} [waiting]
 * @returns {PendingMerge[]}
 */
export function pendingMerges(store, events, waiting) {
  /** @type {Map<string, PendingMerge>} */
  const found = new Map();
  /** @param {PendingMerge} x */
  const add = (x) => {
    const prev = found.get(x.branch);
    found.set(x.branch, {
      item: x.item ?? prev?.item ?? null,
      branch: x.branch,
      number: x.number ?? prev?.number ?? null,
      url: x.url ?? prev?.url ?? null,
      status: prev?.status === 'approved' || x.status === 'approved' ? 'approved' : 'presented',
    });
  };
  const pull = readPullState(store);
  for (const b of pull.presented?.branches ?? []) {
    add({ item: b.item, branch: b.branch, number: b.number, url: b.url, status: 'presented' });
  }
  for (const [branch, s] of Object.entries(pull.branches)) {
    if (s.approval) {
      add({ item: s.item, branch, number: s.number, url: s.url, status: 'approved' });
    }
  }
  for (const [branch, a] of Object.entries(pull.approved_ahead ?? {})) {
    add({ item: null, branch, number: a.number, url: null, status: 'approved' });
  }
  const local = readPresentation(store);
  if (local) {
    const yes = new Set(recordedApproval(events, local)?.branches ?? []);
    for (const b of local.branches) {
      add({
        item: b.item,
        branch: b.branch,
        number: null,
        url: null,
        status: yes.has(b.branch) ? 'approved' : 'presented',
      });
    }
  }
  const still = waiting ? new Set(waiting.map((w) => w.branch)) : null;
  return [...found.values()]
    .filter((x) => !still || still.has(x.branch))
    .sort(
      (a, b) =>
        Number(b.status === 'approved') - Number(a.status === 'approved') ||
        a.branch.localeCompare(b.branch),
    );
}
