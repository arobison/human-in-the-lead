// The one-orchestrator lease (design part 13.1). The lease lives in the run state; a session
// renews it at every checkpoint, and a checkpoint or ledger write by a session that no longer
// holds it is refused, so a stale orchestrator cannot keep driving a run another has taken.
//
// The store offers no compare-and-swap, so takeover reads, then writes, then reads back to confirm
// it won. That is enough for one machine and one owner; two sessions racing within the same few
// milliseconds could still both believe they won, and the loser finds out at its next checkpoint.
//
// A lease can also be released before it expires (design part 13.1, disposable orchestrators): by
// its holder when it hands over, or by the chief of staff when it saw the holder's session end. A
// released lease is free for a successor at once, and its holder can no longer record.

/** @typedef {import('./state.mjs').RunState} RunState */

export class LeaseError extends Error {
  /**
   * @param {'held' | 'lost' | 'released' | 'none'} code
   * @param {string} message
   * @param {{ session: string, host: string, renewed_at: string } | null} [holder]
   */
  constructor(code, message, holder = null) {
    super(message);
    this.name = 'LeaseError';
    this.code = code;
    this.holder = holder;
  }
}

/**
 * Seconds since the lease was last renewed.
 * @param {RunState} state @param {Date} now
 */
export const leaseAgeSeconds = (state, now) =>
  Math.max(0, (now.getTime() - Date.parse(state.lease.renewed_at)) / 1000);

/**
 * Whether the lease is old enough to take over without the owner's say-so.
 * @param {RunState} state @param {Date} now @param {number} expirySeconds
 */
export const leaseExpired = (state, now, expirySeconds) =>
  leaseAgeSeconds(state, now) > expirySeconds;

/**
 * Throw unless this session holds the lease.
 * @param {RunState} state @param {string} session @param {string} host
 */
export function assertHolds(state, session, host) {
  const l = state.lease;
  if (l.session !== session || l.host !== host) {
    throw new LeaseError(
      'lost',
      `the lease on run ${state.run.id} is held by session ${l.session} on ${l.host}, not by this session`,
      l,
    );
  }
  if (l.released) {
    throw new LeaseError(
      'released',
      `this session gave up the lease on run ${state.run.id} (${l.released.reason === 'handover' ? 'it handed over' : `retired by ${l.released.by}: its session ended`}); a successor resumes the run`,
      l,
    );
  }
}
