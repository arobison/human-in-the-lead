// The dispatch cycle (design part 5.2), as one library function: dispatch from the head of the
// ready queue up to the cap, then wait for the next completion notice and refill the slot it
// freed. Never polling: with background_completion each wait is one onComplete per dispatch, raced;
// without it, completions are collected at a defined point, right after each dispatch returns.
//
// The orchestrator skill runs the same cycle across turns with `hitld dispatch plan / start /
// complete`, because in Claude Code the completion notice arrives as a new turn. This function is
// the in-process form, for harnesses whose adapter can be awaited and for the offline evals.

import { dispatchExecutor, reportedEvent } from '../run/protocol.mjs';
import { nextDispatchId, readLedger } from '../ledger/ledger.mjs';
import { decisionOverlaps, deriveReady, rankQueue, weightsOf } from './queue.mjs';
import { sizeItem } from './sizing.mjs';
import { planDispatch } from './plan.mjs';
import { renderBrief } from './brief.mjs';
import { globsOverlap, slugify } from './item.mjs';
import { parseReport } from '../contract/report.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {import('../run/run.mjs').Run} Run
 * @typedef {import('../../harness/interface.mjs').HarnessAdapter} HarnessAdapter
 * @typedef {import('../../harness/interface.mjs').Completion} Completion
 * @typedef {{ step: 'dispatch' | 'complete' | 'inline' | 'refused', dispatch?: string, item: string, running: number }} TraceStep
 */

/**
 * `items` is changed in place: a done report sets its item Done (a stand-in for the merge).
 * `maxDispatches` is a safety stop.
 * @param {{
 *   run: Run,
 *   adapter: HarnessAdapter,
 *   policy: Record<string, any>,
 *   items: Item[],
 *   cap?: number,
 *   gate?: (item: Item) => import('./plan.mjs').GateAnswer,
 *   maxDispatches?: number,
 * }} r
 */
export async function runDispatchLoop(r) {
  const caps = r.adapter.capabilities();
  const cap = r.cap ?? r.policy.execution?.max_executors?.value ?? 3;
  const gate = r.gate ?? (() => ({ mode: 'normal', allow: true, reason: 'no gate' }));
  const branchPrefix = r.policy.env?.branch_prefix ?? 'hitld';
  /** @type {TraceStep[]} */
  const trace = [];
  /** @type {Map<string, Promise<{ dispatch: string, completion: Completion }>>} */
  const pending = new Map();
  /** @type {Map<string, string>} dispatch -> item */
  const itemOf = new Map();
  /** @type {Set<string>} items the harness refused: not offered again in this loop */
  const refused = new Set();
  let dispatches = 0;
  let maxRunning = 0;
  const max = r.maxDispatches ?? 100;

  /** @param {string} dispatch @param {Completion} completion */
  const absorb = (dispatch, completion) => {
    const entry = r.run.state.in_flight.find((/** @type {any} */ d) => d.dispatch === dispatch);
    if (entry) {
      r.run.record(
        reportedEvent(entry, completion, readLedger(r.run.store).events, r.policy.dispatch),
      );
    }
    pending.delete(dispatch);
    const id = /** @type {string} */ (itemOf.get(dispatch));
    const { report } = parseReport(completion.report);
    const item = r.items.find((i) => String(i.id) === id);
    if (item) item.state = report?.result === 'done' ? 'done' : 'planned';
    trace.push({ step: 'complete', dispatch, item: id, running: pending.size });
  };

  for (;;) {
    const running = r.run.state.in_flight.map((/** @type {any} */ d) => ({
      dispatch: d.dispatch,
      item: d.item,
      serial_resources: d.serial_resources ?? [],
      touches: r.items.find((i) => String(i.id) === d.item)?.touches ?? [],
    }));
    const ready = deriveReady(r.items, {
      inFlight: running.map((/** @type {{ item: string }} */ d) => d.item),
    });
    const readyItems = r.items.filter((i) => ready.has(String(i.id)) && !refused.has(String(i.id)));
    const sizes = new Map(readyItems.map((i) => [String(i.id), sizeItem(i, r.policy)]));
    const ranking = rankQueue({
      items: r.items,
      ready: readyItems,
      sizes,
      weight: weightsOf(r.items, r.policy, [], { sizes }),
    });
    const onDecisions = decisionOverlaps({
      items: r.items,
      ready: readyItems,
      ranking,
      // Own touches only, as this loop's overlap rule uses: it has no repository to derive from.
      touches: (i) => /** @type {string[]} */ (i.touches ?? []),
      overlap: globsOverlap,
    });
    const plan = planDispatch({
      queue: ranking.queue,
      sizes,
      running,
      cap,
      capabilities: caps,
      gate,
      overlapSerialize: r.policy.dispatch?.serialize_overlap_share,
      critical: ranking.critical,
      decisions: (i) => onDecisions.get(String(i.id)) ?? [],
    });

    for (const p of plan.inline) {
      const item = /** @type {Item} */ (r.items.find((i) => String(i.id) === p.item));
      item.state = 'done';
      trace.push({ step: 'inline', item: p.item, running: pending.size });
    }

    for (const p of plan.start) {
      if (dispatches >= max) break;
      const item = /** @type {Item} */ (r.items.find((i) => String(i.id) === p.item));
      const dispatch = nextDispatchId(readLedger(r.run.store).events);
      const branch = `${branchPrefix}/${item.id}-${slugify(item.title)}`;
      const isolation = caps.worktrees ? 'worktree' : 'none';
      const brief = renderBrief({
        item,
        sizing: p.sizing,
        dispatch,
        branch,
        policy: r.policy,
        isolation,
      });
      /** @type {import('../../harness/interface.mjs').DispatchHandle} */
      let handle;
      try {
        handle = await dispatchExecutor(
          r.run,
          r.adapter,
          {
            dispatch,
            item: String(item.id),
            brief,
            tier: p.tier,
            role: 'executor',
            model: p.sizing.model,
            effort: p.sizing.effort,
            isolation,
            branch,
            budgetTokens: p.sizing.estimate_tokens,
            classification: item.classification ?? 'internal',
          },
          {
            estimateTokens: p.sizing.estimate_tokens,
            estimateSource: p.sizing.estimate_source,
            estimateSamples: p.sizing.estimate_samples,
            serialResources: p.serial,
          },
        );
      } catch {
        refused.add(String(item.id));
        trace.push({ step: 'refused', dispatch, item: String(item.id), running: pending.size });
        continue;
      }
      dispatches++;
      itemOf.set(dispatch, String(item.id));
      pending.set(
        dispatch,
        r.adapter.onComplete(handle).then((completion) => ({ dispatch, completion })),
      );
      maxRunning = Math.max(maxRunning, pending.size);
      trace.push({ step: 'dispatch', dispatch, item: String(item.id), running: pending.size });
      if (!caps.background_completion) {
        // No completion events: collect this one now, at the point the dispatch returned.
        const done = /** @type {Promise<{ dispatch: string, completion: Completion }>} */ (
          pending.get(dispatch)
        );
        const { completion } = await done;
        absorb(dispatch, completion);
      }
    }

    if (pending.size === 0) {
      if (plan.start.length === 0 && plan.inline.length === 0) break;
      if (dispatches >= max) break;
      continue;
    }
    // Wait for the next completion notice, and refill the slot it frees.
    const next = await Promise.race(pending.values());
    absorb(next.dispatch, next.completion);
  }
  return {
    trace,
    dispatches,
    maxRunning,
    remaining: r.items.filter((i) => i.state !== 'done').map((i) => String(i.id)),
  };
}
