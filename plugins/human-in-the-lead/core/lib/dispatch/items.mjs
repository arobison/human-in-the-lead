// Where the orchestrator's commands read work items from: the files tracker (piece (a)). Its
// `query` gives every entity, and the derived `ready` set (Planned, needs Done, not claimed on a
// branch); items already in flight in the ledger are taken out too, in case a claim branch is not
// visible yet, and so are items the main branch closed past this checkout (HITLD-839).

import { openTracker } from '../tracker/files/tracker.mjs';
import { git, loadPlaces } from '../tracker/files/tree.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {{ items: Item[], ready: Set<string>, tracker: ReturnType<typeof openTracker> }} WorkItems
 */

/**
 * @param {{ repoRoot: string, policy: Record<string, any>, inFlight?: string[], env?: NodeJS.ProcessEnv }} r
 * @returns {WorkItems}
 */
export function readWorkItems(r) {
  const tracker = openTracker({ repoRoot: r.repoRoot, policy: r.policy, env: r.env ?? {} });
  const items = /** @type {Item[]} */ (tracker.query({}));
  const busy = new Set(r.inFlight ?? []);
  const candidates = /** @type {Item[]} */ (tracker.query({ ready: true }))
    .filter((i) => i.kind === 'work')
    .map((i) => String(i.id))
    .filter((id) => !busy.has(id));
  const closed = candidates.length ? closedOnMain(tracker, r.policy) : new Set();
  const ready = new Set(candidates.filter((id) => !closed.has(id)));
  return { items, ready, tracker };
}

/**
 * The items the main branch has closed (done or dropped) in commits this checkout does not have:
 * the local main branch and the remote-tracking one the merge fetches. With merge.via pull-request
 * the squash lands on the remote and the merge fetches it, but a checkout it could not fast-forward
 * (or one on another branch) still reads each merged item as planned, and would offer it again
 * (HITLD-839). A main ref this checkout already contains adds nothing, so a stale remote-tracking
 * ref, or a revert here that reopened an item, is not read over the checkout. Only closes count:
 * an item main has open stays as this checkout has it, so an item promoted here, not yet
 * published, is still offered.
 * @param {ReturnType<typeof openTracker>} tracker @param {Record<string, any>} policy
 * @returns {Set<string>}
 */
function closedOnMain(tracker, policy) {
  const root = tracker.root();
  const main = String(policy.merge?.main_branch ?? 'main');
  const remote = String(policy.merge?.pull_request?.remote ?? 'origin');
  /** @type {Map<string, string>} commit → ref, one ref per commit */
  const ahead = new Map();
  for (const ref of [`refs/remotes/${remote}/${main}`, `refs/heads/${main}`]) {
    const commit = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      allowFail: true,
    }).trim();
    if (!commit || ahead.has(commit)) continue;
    if (!isAncestor(root, commit)) ahead.set(commit, ref);
  }
  /** @type {Set<string>} */
  const closed = new Set();
  if (!ahead.size) return closed;
  const places = [...ahead.values()].map((ref) => ({ where: ref, ref }));
  for (const place of loadPlaces(root, tracker.layout(), places)) {
    for (const e of place.items) {
      const state = String(e.data?.state ?? '');
      if (e.data?.id && (state === 'done' || state === 'dropped')) closed.add(String(e.data.id));
    }
  }
  return closed;
}

/**
 * Whether a commit is an ancestor of HEAD. `git merge-base --is-ancestor` prints nothing either way,
 * so its exit status is read: tree.mjs's git returns '' on success and on a failure alike.
 * @param {string} root @param {string} commit
 */
function isAncestor(root, commit) {
  try {
    git(root, ['merge-base', '--is-ancestor', commit, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}
