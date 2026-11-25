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
// The cap is the ledger's, from the private store. A session whose store does not hold the
// dispatch (a cloud executor has none, HITLD-841) reads it instead from the `Budget-Tokens` trailer
// of its own claim commit. That trailer is the executor's own writing: it can leave it out or
// inflate it, and a brief that does not pass --budget-tokens gets none; the reconcile pass stays
// the backstop.
//
// It never fails a tool call: anything it cannot read (no store and no cap in the claim, no
// estimate, no transcript) is no reading, and nothing is enforced. The reconcile pass is the
// backstop for that.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DISPATCH_ID } from '../../../lib/ledger/ids.mjs';
import { claimedBudgets } from './input.mjs';

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

/** @typedef {{ dispatch: string, cap: number, since: string | null, agent: boolean }} Cap */

/**
 * The cap from the ledger in the private store: the dispatch in flight and its start. Null when
 * the ledger holds the dispatch but there is nothing to enforce (not in flight, no estimate);
 * undefined when there is no policy or the ledger does not hold the dispatch at all (no store, as
 * in a cloud executor, or a copy of the store without it): only then is the claim's cap read.
 * @param {Record<string, any>} input @param {NodeJS.ProcessEnv} env @param {string} cwd
 * @param {() => import('./input.mjs').Claim[]} claims read only when needed (git runs twice)
 * @returns {Promise<Cap | null | undefined>}
 */
async function ledgerCap(input, env, cwd, claims) {
  const [{ ownerCheckoutOf }, { loadPolicy }, { openStore, privateStorePath }, ledger, budget] =
    await Promise.all([
      import('../../../lib/env/primary.mjs'),
      import('../../../lib/policy/policy.mjs'),
      import('../../../lib/store/store.mjs'),
      import('../../../lib/ledger/inflight.mjs'),
      import('../../../lib/dispatch/budget.mjs'),
    ]);
  const root = ownerCheckoutOf(cwd);
  const loaded = root ? loadPolicy({ cwd: root }) : null;
  if (!root || !loaded?.policy) return undefined;
  const store = openStore(privateStorePath(loaded.policy.project.id, { env, repoRoot: root }));
  const { readLedger } = await import('../../../lib/ledger/ledger.mjs');
  const events = readLedger(store).events;
  const flying = ledger.inflight(events);
  const ref = typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : null;
  const byRef = ref ? flying.find((d) => d.harness_ref === ref) : undefined;
  const dispatch = byRef?.dispatch ?? namedDispatch(env, claims);
  if (!dispatch) return undefined;
  const item = events.find((e) => e.event === 'dispatched' && e.dispatch === dispatch)?.item;
  if (!item) return undefined;
  // A follow-up continues the item under a new dispatch ID: the one in flight is the one to read.
  const entry =
    flying.find((d) => d.dispatch === dispatch) ?? flying.findLast((d) => d.item === item);
  if (!entry) return null;
  const b = budget.budgetOf(events, entry.dispatch, loaded.policy.dispatch);
  return b ? { dispatch: entry.dispatch, cap: b.cap, since: b.since, agent: Boolean(byRef) } : null;
}

/**
 * The executor's dispatch: HITLD_DISPATCH, or else the newest claim's.
 * @param {NodeJS.ProcessEnv} env @param {() => import('./input.mjs').Claim[]} claims
 */
const namedDispatch = (env, claims) =>
  typeof env.HITLD_DISPATCH === 'string' && DISPATCH_ID.test(env.HITLD_DISPATCH)
    ? env.HITLD_DISPATCH
    : claims()[0]?.dispatch;

/**
 * The cap from the executor's own claim commit, for a session whose store does not hold the
 * dispatch (a cloud executor, HITLD-841): the `Budget-Tokens` trailer `hitld work claim` wrote.
 * Usage counts from the claim's time, or from the item's last close after it, where a follow-up in
 * the same session starts; the reading before the claim is not counted.
 * @param {NodeJS.ProcessEnv} env @param {() => import('./input.mjs').Claim[]} claims
 * @returns {Cap | null}
 */
function claimCap(env, claims) {
  const named = namedDispatch(env, claims);
  const found = claims().find((c) => c.dispatch === named && c.cap !== null);
  return found?.cap
    ? { dispatch: found.dispatch, cap: found.cap, since: found.since, agent: false }
    : null;
}

/**
 * Read the executor's budget, or null when there is nothing to enforce. The ledger's cap when the
 * private store holds the dispatch; else the cap in the executor's claim commit. A store that
 * cannot be read gives no reading, as before HITLD-841.
 * @param {Record<string, any>} input the hook input @param {NodeJS.ProcessEnv} env
 * @returns {Promise<BudgetReading | null>}
 */
export async function readBudget(input, env) {
  try {
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    // Read once, and only when a path needs them: the ledger path with HITLD_DISPATCH does not.
    /** @type {import('./input.mjs').Claim[] | undefined} */
    let read;
    const claims = () => (read ??= claimedBudgets(cwd) ?? []);
    const fromLedger = await ledgerCap(input, env, cwd, claims);
    const b = fromLedger === undefined ? claimCap(env, claims) : fromLedger;
    if (!b) return null;
    const { transcriptUsage } = await import('../../../lib/dispatch/budget.mjs');
    let tokens = 0;
    for (const path of transcriptsOf(input, b.agent)) {
      tokens += transcriptUsage(readOr(path), { since: b.since }).tokens;
    }
    return { dispatch: b.dispatch, tokens, cap: b.cap, reached: tokens >= b.cap };
  } catch {
    return null;
  }
}
