// What a quota report reads besides the policy: the usage snapshots (this project's and every
// account's from the machine registry) and the ledger. Shared by the quota commands and the digest,
// so both report from the same readings.

import { machineRootFor } from '../env/manager.mjs';
import { readAccountSnapshots } from '../registry/machine.mjs';
import { loadEffectivePolicy } from '../settings/layers.mjs';
import { dispatchGate } from './gate.mjs';
import { readLedgerEntries, readSnapshots } from './usage.mjs';

/**
 * @param {import('../store/store.mjs').PrivateStore} store
 */
export function readQuotaInputs(store) {
  const own = readSnapshots(store);
  return {
    snapshots: [...own.snapshots, ...readAccountSnapshots(machineRootFor(store.root))],
    skipped: own.skipped,
    ledger: readLedgerEntries(store),
  };
}

/**
 * The gate's asks for a fresh usage figure the owner declared (HITLD-164), for `hitld run status`:
 * the person's limits layered over the project's, read as the quota commands read them. Empty when
 * the policy cannot be read; run status never fails for want of it.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, now: number }} o
 * @returns {{ limit: string, why: string }[]}
 */
export function declaredFigureAsks(store, { cwd, env, now }) {
  try {
    const loaded = loadEffectivePolicy({ cwd, env });
    if (!loaded.policy) return [];
    const { snapshots, ledger } = readQuotaInputs(store);
    return dispatchGate(loaded.policy, snapshots, {}, { now, ledger }).refresh;
  } catch {
    return [];
  }
}
