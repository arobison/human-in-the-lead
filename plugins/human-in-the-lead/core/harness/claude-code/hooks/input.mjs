// Shared by the plugin's hook scripts: read the hook input, and tell an executor from anyone else.
// Plugin agent definitions cannot carry hooks of their own (design part 15.4), so the hooks are
// plugin-wide and act only on executors: a subagent of the plugin's executor types, or a headless
// tier-3 run, whose environment carries HITLD_DISPATCH.

import { readFileSync } from 'node:fs';
import { DISPATCH_ID } from '../../../lib/ledger/ids.mjs';

/** @returns {Record<string, any>} */
export function readHookInput() {
  try {
    const data = JSON.parse(readFileSync(0, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, any>} input @param {NodeJS.ProcessEnv} env */
export function isExecutor(input, env) {
  if (typeof input.agent_type === 'string') {
    return /^human-in-the-lead:executor(-tier\d)?$/.test(input.agent_type);
  }
  // Either form of dispatch ID: numbered before HITLD-74, or unique by construction.
  return typeof env.HITLD_DISPATCH === 'string' && DISPATCH_ID.test(env.HITLD_DISPATCH);
}
