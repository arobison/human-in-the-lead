// The owner's device answers, as a test sets them up: lines of devices/approvals.jsonl in a private
// store, as `hitld rights answer` writes them after a device decision (design 0003, section 6).

import { recordApproval } from '../../lib/store/devices.mjs';

let n = 0;
/** A time after every earlier one, so the records fold in the order a test writes them. */
const next = () => new Date(Date.UTC(2026, 10, 15, 9, 0, n++)).toISOString();

/**
 * Record the owner's approval of each device in a store.
 * @param {import('../../lib/store/store.mjs').PrivateStore} store
 * @param {...[string, { recipient: string }]} devices name and key
 */
export function approve(store, ...devices) {
  for (const [name, key] of devices) {
    recordApproval(store, {
      event: 'approved',
      decision: `W-${900 + n}`,
      action: 'enrol',
      name,
      recipient: key.recipient,
      added: '2026-11-15',
      at: next(),
    });
  }
}

/**
 * Record the owner's approval of a device's removal in a store.
 * @param {import('../../lib/store/store.mjs').PrivateStore} store
 * @param {string} name @param {{ recipient: string }} key
 */
export function removeApproved(store, name, key) {
  recordApproval(store, {
    event: 'removed',
    decision: `W-${900 + n}`,
    action: 'remove',
    name,
    recipient: key.recipient,
    at: next(),
  });
}
