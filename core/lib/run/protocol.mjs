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
import { lifecycleId, nextDispatchId, readLedger } from '../ledger/ledger.mjs';

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
 * The `reported` event for a completion.
 * @param {{ dispatch: string, item: string, role?: string, host?: string | null }} entry an in-flight entry
 * @param {Omit<Completion, 'dispatch'> & { dispatch?: string }} completion
 */
export function reportedEvent(entry, completion) {
  const result = reportResult(completion.report);
  return {
    id: lifecycleId('reported', entry.dispatch),
    event: 'reported',
    dispatch: entry.dispatch,
    item: entry.item,
    ...(entry.role !== undefined ? { role: entry.role } : {}),
    ...(result ? { result } : {}),
    tokens: completion.usage?.tokens ?? null,
    tool_calls: completion.usage?.toolCalls ?? null,
    duration_ms: completion.usage?.durationMs ?? null,
    ...(completion.commit && /^[0-9a-f]{7,64}$/.test(completion.commit)
      ? { commit: completion.commit }
      : {}),
  };
}

/**
 * Start an executor under the write-ahead protocol.
 * @param {Run} run
 * @param {HarnessAdapter} adapter
 * @param {Omit<DispatchRequest, 'dispatch'> & { dispatch?: string }} request
 * @param {{ worktree?: string, estimateTokens?: number, serialResources?: string[], skillVersions?: Record<string, string>, model?: string, effort?: string }} [extra]
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
  if (entry) run.record(reportedEvent(entry, completion));
  return completion;
}
