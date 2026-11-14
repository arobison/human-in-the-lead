// Where the orchestrator's commands read work items from: the files tracker (piece (a)). Its
// `query` gives every entity, and the derived `ready` set (Planned, needs Done, not claimed on a
// branch); items already in flight in the ledger are taken out too, in case a claim branch is not
// visible yet.

import { openTracker } from '../tracker/files/tracker.mjs';

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
  const ready = new Set(
    /** @type {Item[]} */ (tracker.query({ ready: true }))
      .filter((i) => i.kind === 'work')
      .map((i) => String(i.id))
      .filter((id) => !busy.has(id)),
  );
  return { items, ready, tracker };
}
