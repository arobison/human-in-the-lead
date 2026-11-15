// What a quota report reads besides the policy: the usage snapshots (this project's and every
// account's from the machine registry) and the ledger. Shared by the quota commands and the digest,
// so both report from the same readings.

import { machineRootFor } from '../env/manager.mjs';
import { readAccountSnapshots } from '../registry/machine.mjs';
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
