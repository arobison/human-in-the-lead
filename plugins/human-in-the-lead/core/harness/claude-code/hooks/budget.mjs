// The budget reading the executor's hooks share (HITLD-782): its usage since its dispatch started,
// from its own transcript, against its dispatch's cap (core/lib/dispatch/budget.mjs). The
// PostToolUse hook (progress.mjs) tells the executor at the cap; the PreToolUse guard (guard.mjs)
// refuses all but the closing steps past it.
//
// Whose transcript: a background agent known by its agent ID (the harness reference hitld dispatch
// handle recorded) is read from its own transcript; a session that is the executor (HITLD_DISPATCH,
// or a claim commit on its checkout) from the session's transcript and its subagents', since a
// subagent's usage is the executor's too. Only the numbers are read (transcriptUsage).
//
// It never fails a tool call: anything it cannot read (no store, no ledger entry, no estimate, no
// transcript) is no reading, and nothing is enforced. The reconcile pass is the backstop for that.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DISPATCH_ID } from '../../../lib/ledger/ids.mjs';
import { claimedDispatches } from './input.mjs';

/**
 * @typedef {{ dispatch: string, tokens: number, cap: number, reached: boolean }} BudgetReading
 */

/** @param {string} path */
const readOr = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/**
 * The transcripts that hold an executor's usage.
 * @param {Record<string, any>} input @param {boolean} agent the executor is the background agent
 *   that made this call, not the session
 * @returns {string[]}
 */
export function transcriptsOf(input, agent) {
  const main = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  const id =
    typeof input.agent_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.agent_id)
      ? input.agent_id
      : null;
  const subagents = main ? join(dirname(main), basename(main, '.jsonl'), 'subagents') : '';
  if (agent) {
    if (typeof input.agent_transcript_path === 'string') return [input.agent_transcript_path];
    return id && subagents ? [join(subagents, `agent-${id}.jsonl`)] : [];
  }
  if (!main) return [];
  /** @type {string[]} */
  let subs = [];
  try {
    subs = existsSync(subagents)
      ? readdirSync(subagents)
          .filter((f) => /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(f))
          .map((f) => join(subagents, f))
      : [];
  } catch {
    subs = [];
  }
  return [main, ...subs];
}

/**
 * Read the executor's budget, or null when there is nothing to enforce.
 * @param {Record<string, any>} input the hook input @param {NodeJS.ProcessEnv} env
 * @returns {Promise<BudgetReading | null>}
 */
export async function readBudget(input, env) {
  try {
    const [{ ownerCheckoutOf }, { loadPolicy }, { openStore, privateStorePath }, ledger, budget] =
      await Promise.all([
        import('../../../lib/env/primary.mjs'),
        import('../../../lib/policy/policy.mjs'),
        import('../../../lib/store/store.mjs'),
        import('../../../lib/ledger/inflight.mjs'),
        import('../../../lib/dispatch/budget.mjs'),
      ]);
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    const root = ownerCheckoutOf(cwd);
    const loaded = root ? loadPolicy({ cwd: root }) : null;
    if (!root || !loaded?.policy) return null;
    const store = openStore(privateStorePath(loaded.policy.project.id, { env, repoRoot: root }));
    const { readLedger } = await import('../../../lib/ledger/ledger.mjs');
    const events = readLedger(store).events;
    const flying = ledger.inflight(events);
    const ref = typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : null;
    const byRef = ref ? flying.find((d) => d.harness_ref === ref) : undefined;
    /** @type {string | undefined} */
    let dispatch = byRef?.dispatch;
    if (
      !dispatch &&
      typeof env.HITLD_DISPATCH === 'string' &&
      DISPATCH_ID.test(env.HITLD_DISPATCH)
    ) {
      dispatch = env.HITLD_DISPATCH;
    }
    if (!dispatch) dispatch = claimedDispatches(cwd)?.[0];
    if (!dispatch) return null;
    // A follow-up continues the item under a new dispatch ID: the one in flight is the one to read.
    let entry = flying.find((d) => d.dispatch === dispatch);
    if (!entry) {
      const item = events.find((e) => e.event === 'dispatched' && e.dispatch === dispatch)?.item;
      entry = item ? flying.findLast((d) => d.item === item) : undefined;
    }
    if (!entry) return null;
    const b = budget.budgetOf(events, entry.dispatch, loaded.policy.dispatch);
    if (!b) return null;
    let tokens = 0;
    for (const path of transcriptsOf(input, Boolean(byRef))) {
      tokens += budget.transcriptUsage(readOr(path), { since: b.since }).tokens;
    }
    return { dispatch: entry.dispatch, tokens, cap: b.cap, reached: tokens >= b.cap };
  } catch {
    return null;
  }
}
