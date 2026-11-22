#!/usr/bin/env node
// PostToolUse: each tool call an executor makes is a progress signal for the watchdog (design part
// 5.2), so the executor never has to report that it is alive. A background agent is known by its
// agent ID (the harness reference hitld dispatch handle recorded), a headless run by HITLD_DISPATCH.
// Anyone else's tool calls are not recorded, and the hook never fails or delays a tool call: on
// any problem it writes nothing.
//
// It is also the executor's budget meter (HITLD-782): at its dispatch's cap it tells the executor
// to close (budget.mjs), and the guard refuses all but the closing steps from then on.

import { readBudget } from './budget.mjs';
import { isExecutor, readHookInput } from './input.mjs';
import { DISPATCH_ID } from '../../../lib/ledger/ids.mjs';

const input = readHookInput();
if (isExecutor(input, process.env)) {
  try {
    // Loaded only for executors, so the hook costs everyone else nothing but its start.
    const [{ ownerCheckoutOf }, { loadPolicy }, { openStore, privateStorePath }, progress] =
      await Promise.all([
        import('../../../lib/env/primary.mjs'),
        import('../../../lib/policy/policy.mjs'),
        import('../../../lib/store/store.mjs'),
        import('../../../lib/dispatch/progress.mjs'),
      ]);
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    const root = ownerCheckoutOf(cwd);
    const loaded = root ? loadPolicy({ cwd: root }) : null;
    const env = process.env.HITLD_DISPATCH;
    const dispatch = typeof env === 'string' && DISPATCH_ID.test(env) ? env : undefined;
    const ref = typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : undefined;
    if (root && loaded?.policy && (dispatch || ref)) {
      const store = openStore(
        privateStorePath(loaded.policy.project.id, { env: process.env, repoRoot: root }),
      );
      const tool =
        typeof input.tool_name === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.tool_name)
          ? input.tool_name
          : undefined;
      progress.recordProgress(store, {
        source: 'harness',
        ...(dispatch ? { dispatch } : { harness_ref: ref }),
        tool_calls: 1,
        ...(tool ? { tool } : {}),
      });
    }
  } catch {
    // A progress signal is never worth failing a tool call for.
  }
  const budget = await readBudget(input, process.env);
  if (budget?.reached) {
    const { BUDGET_REACHED } = await import('../../../lib/dispatch/budget.mjs');
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `human-in-the-lead: ${BUDGET_REACHED}. ${budget.dispatch} has used ${budget.tokens} of its ${budget.cap} tokens: commit what you have, push your branch, run hitld work close, and send your report now; every other tool call is refused.`,
        },
      }) + '\n',
    );
  }
}
