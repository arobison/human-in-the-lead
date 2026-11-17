// The write-ahead dispatch protocol, so a crash at any point loses or duplicates no dispatch.
//
//   1. record `dispatched`   the intent; the ledger is written before the harness is called
//   2. adapter.dispatch(...) the harness starts the executor
//   3. record `started`      the harness accepted it; carries the harness's reference (harness_ref)
//   4. record `reported`     the completion, whenever it arrives
//
// Each `record` appends to the ledger first and then checkpoints. A crash before step 2 leaves a
// dispatch no executor ever started: on resume it has no live executor and no report, so it is
// abandoned and its item unclaimed, and the item is dispatched afresh. A crash after step 2 and
// before step 3 leaves a started executor with no harness_ref on file: resume finds it live (or its
// completion waiting) by dispatch ID and adopts it. Neither starts a second executor for an item
// whose first is running.

import { createHash } from 'node:crypto';
import { VERSION } from '../version.mjs';
import { lifecycleId, nextDispatchId, readLedger, startEstimate } from '../ledger/ledger.mjs';

/**
 * @typedef {import('../../harness/interface.mjs').HarnessAdapter} HarnessAdapter
 * @typedef {import('../../harness/interface.mjs').DispatchRequest} DispatchRequest
 * @typedef {import('../../harness/interface.mjs').DispatchHandle} DispatchHandle
 * @typedef {import('../../harness/interface.mjs').Completion} Completion
 * @typedef {import('./run.mjs').Run} Run
 */

/**
 * The result in a report's `result:` line (design part 5.6), or its `status:` line in a report
 * written before HITLD-82. Undefined when there is none, so the ledger never carries a guess;
 * piece (d)'s parser is the real reader of reports.
 * @param {string} report
 * @returns {'done' | 'partial' | 'blocked' | undefined}
 */
export function reportResult(report) {
  const m = /^(?:result|status):[ \t]*(done|partial|blocked)\b/im.exec(report ?? '');
  return m ? /** @type {'done' | 'partial' | 'blocked'} */ (m[1].toLowerCase()) : undefined;
}

/**
 * A completion's token figure this many times its dispatch's estimate or more is far above it:
 * `hitld dispatch complete` refuses to record it unless told the run really cost that much
 * (HITLD-436). The brief asks the executor to report at 1.5 times the estimate by default, so three
 * times is twice past the point where it should have stopped.
 */
export const TOKENS_FAR_ABOVE_ESTIMATE = 3;

/**
 * Whether a completion's tokens are far above the estimate it started with. False when either is
 * unknown, or the estimate is 0 (inline work has none).
 * @param {number | null | undefined} tokens @param {number | null | undefined} estimate
 */
export const farAboveEstimate = (tokens, estimate) =>
  typeof tokens === 'number' &&
  typeof estimate === 'number' &&
  estimate > 0 &&
  tokens >= TOKENS_FAR_ABOVE_ESTIMATE * estimate;

/**
 * The `reported` event for a completion. It carries the estimate the dispatch started with beside
 * the tokens it cost, so estimate against actual can be read per item (HITLD-436). The tokens are
 * output plus fresh input, never cache reads (core/harness/claude-code/completion.mjs). Beside them
 * (HITLD-438): where the figure came from (tokens_source), the harness's counts kept apart with the
 * cost it reports (usage), and what the executor said its own run cost (self_reported_tokens), a
 * guess that is never the tokens.
 * @param {{ dispatch: string, item: string, role?: string, host?: string | null }} entry an in-flight entry
 * @param {Omit<Completion, 'dispatch'> & { dispatch?: string, tokensSource?: string | null,
 *   parts?: Record<string, number | null> | null, selfReported?: number | null }} completion
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} [events] the ledger, to find the estimate
 * @param {Record<string, any>} [d] policy.dispatch: the bound the estimate is read under
 */
export function reportedEvent(entry, completion, events = [], d) {
  const result = reportResult(completion.report);
  const estimate = startEstimate(events, entry.dispatch, entry.item, d);
  return {
    id: lifecycleId('reported', entry.dispatch),
    event: 'reported',
    dispatch: entry.dispatch,
    item: entry.item,
    ...(entry.role !== undefined ? { role: entry.role } : {}),
    ...(result ? { result } : {}),
    tokens: completion.usage?.tokens ?? null,
    ...(completion.usage?.tokens != null && completion.tokensSource
      ? { tokens_source: completion.tokensSource }
      : {}),
    ...(completion.parts && Object.keys(usageOf(completion.parts)).length
      ? { usage: usageOf(completion.parts) }
      : {}),
    ...(typeof completion.selfReported === 'number'
      ? { self_reported_tokens: completion.selfReported }
      : {}),
    ...(estimate !== undefined ? { estimate_tokens: estimate } : {}),
    tool_calls: completion.usage?.toolCalls ?? null,
    duration_ms: completion.usage?.durationMs ?? null,
    ...(completion.commit && /^[0-9a-f]{7,64}$/.test(completion.commit)
      ? { commit: completion.commit }
      : {}),
  };
}

/**
 * The harness's counts for the ledger: only those it gave.
 * @param {Record<string, number | null>} parts
 */
const usageOf = (parts) =>
  Object.fromEntries(Object.entries(parts).filter(([, v]) => typeof v === 'number'));

/**
 * Start an executor under the write-ahead protocol.
 * @param {Run} run
 * @param {HarnessAdapter} adapter
 * @param {Omit<DispatchRequest, 'dispatch'> & { dispatch?: string }} request
 * @param {{ worktree?: string, estimateTokens?: number, estimateSource?: string, estimateSamples?: number, serialResources?: string[], skillVersions?: Record<string, string>, model?: string, effort?: string }} [extra]
 * @returns {Promise<DispatchHandle>}
 */
export async function dispatchExecutor(run, adapter, request, extra = {}) {
  const dispatch = request.dispatch ?? nextDispatchId(readLedger(run.store).events);
  const model = request.model ?? extra.model;
  const effort = request.effort ?? extra.effort;
  run.record({
    id: lifecycleId('dispatched', dispatch),
    event: 'dispatched',
    dispatch,
    item: request.item,
    tier: request.tier,
    role: request.role,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(extra.worktree ? { worktree: extra.worktree } : {}),
    ...(request.branch ? { branch: request.branch } : {}),
    brief_hash: createHash('sha256').update(request.brief).digest('hex'),
    skill_versions: {
      hitld_version: VERSION,
      ...(extra.skillVersions ? { skills: extra.skillVersions } : {}),
    },
    ...(extra.estimateTokens !== undefined ? { estimate_tokens: extra.estimateTokens } : {}),
    ...(extra.estimateSource !== undefined ? { estimate_source: extra.estimateSource } : {}),
    ...(extra.estimateSamples !== undefined ? { estimate_samples: extra.estimateSamples } : {}),
    host: run.host,
    ...(extra.serialResources?.length ? { serial_resources: extra.serialResources } : {}),
  });
  /** @type {DispatchHandle} */
  let handle;
  try {
    handle = await adapter.dispatch({ ...request, dispatch });
  } catch (e) {
    // The harness refused: nothing started, so the dispatch ends here and the item is free.
    run.record({
      id: lifecycleId('abandoned', dispatch),
      event: 'abandoned',
      dispatch,
      item: request.item,
      notes: 'the harness refused the dispatch',
    });
    throw e;
  }
  run.record({
    id: lifecycleId('started', dispatch),
    event: 'started',
    dispatch,
    item: request.item,
    harness: handle.harness,
    harness_ref: handle.ref,
    host: run.host,
  });
  return handle;
}

/**
 * Wait for an executor and record its completion.
 * @param {Run} run
 * @param {HarnessAdapter} adapter
 * @param {DispatchHandle} handle
 * @returns {Promise<Completion>}
 */
export async function recordCompletion(run, adapter, handle) {
  const completion = await adapter.onComplete(handle);
  const entry = run.state.in_flight.find((/** @type {any} */ d) => d.dispatch === handle.dispatch);
  if (entry) run.record(reportedEvent(entry, completion, readLedger(run.store).events));
  return completion;
}
