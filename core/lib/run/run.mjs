// Orchestrator continuity (design part 13.1): starting a run, recording events at clean points,
// taking and releasing the lease, resuming and rebuilding, and when a session should hand over.
//
// Every write follows one rule: the ledger first (it is the truth), then the run state as the
// next checkpoint. The state is then always the ledger folded up to `ledger_position`, and
// anything the ledger holds beyond it is absorbed the next time anything is recorded or resumed.

import { VERSION } from '../version.mjs';
import { canonicalJson } from '../policy/policy.mjs';
import { appendEvent, readLedger, LedgerError } from '../ledger/ledger.mjs';
import { absorb, foldLedger } from './state.mjs';
import { loadState, saveCheckpoint } from './checkpoint.mjs';
import { LeaseError, assertHolds, leaseAgeSeconds, leaseExpired } from './lease.mjs';
import { reportedEvent } from './protocol.mjs';
import { runVersionCheck } from '../install/drift.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {import('./state.mjs').RunState} RunState
 * @typedef {import('../ledger/inflight.mjs').InFlight} InFlight
 * @typedef {import('../../harness/interface.mjs').Completion} Completion
 *
 * @typedef {object} RunOptions
 * @property {string} session this orchestrator session's ID
 * @property {string} host the machine it runs on
 * @property {() => Date} [now] a clock, for tests
 * @property {number} [kept] policy run.checkpoints_kept
 * @property {number} [expirySeconds] policy run.lease_expiry_seconds
 * @property {string} [harnessRef] this session's own reference in its harness, where it has one:
 *   recorded with the lease, so wakes for the run can be sent to it
 * @property {string} [cwd] where the command runs: the project whose pin `startRun` and `resumeRun`
 *   compare with this release (design part 16.5, Upgrades)
 *
 * @typedef {object} Reality what exists outside the files; each part is optional
 * @property {string} [harness] the adapter ID, for adopting an executor found running
 * @property {() => unknown[] | Promise<unknown[]>} [live] dispatch IDs (or { dispatch, harness?, ref? })
 *   the harness still shows running on this host. Left out, nothing can be called dead.
 * @property {() => Completion[] | Promise<Completion[]>} [completed] completions delivered while
 *   no orchestrator was running
 * @property {(entry: InFlight) => boolean} [hasCommits] whether the dispatch's worktree or branch
 *   holds work worth a follow-up
 * @property {() => string[]} [branches] the branches that exist, to cross-check claims
 */

const DEFAULTS = { kept: 5, expirySeconds: 1800 };

/**
 * One orchestrator session's handle on the run.
 */
export class Run {
  /** @param {PrivateStore} store @param {RunOptions} options @param {RunState} state */
  constructor(store, options, state) {
    this.store = store;
    this.session = options.session;
    this.host = options.host;
    this.now = options.now ?? (() => new Date());
    this.kept = options.kept ?? DEFAULTS.kept;
    this.expirySeconds = options.expirySeconds ?? DEFAULTS.expirySeconds;
    /** The state as this session last wrote it. */
    this.state = state;
    /** @type {import('../install/drift.mjs').Drift | null} what startRun found about versions */
    this.drift = null;
  }

  /**
   * A clean point: append the event to the ledger, then write the next checkpoint. Refused if this
   * session no longer holds the lease. Recording the same event again (same ID) is a no-op for
   * the ledger, and the checkpoint still catches up with anything the ledger holds beyond it.
   * @param {LedgerEntry} event
   * @returns {{ event: LedgerEntry, appended: boolean }}
   */
  record(event) {
    const persisted = this.#persisted();
    const {
      event: written,
      appended,
      events,
    } = appendEvent(this.store, { ...event, run: persisted.run.id }, { now: this.now });
    this.#checkpoint(persisted, events);
    return { event: written, appended };
  }

  /** A clean point with nothing to record: absorb the ledger and renew the lease. */
  checkpoint() {
    this.#checkpoint(this.#persisted(), readLedger(this.store).events);
    return this.state;
  }

  /** The persisted state, checked: this session must hold the lease. */
  #persisted() {
    const { state, problems } = loadState(this.store);
    if (!state) {
      throw new Error(`no run state (${problems.join('; ')}); run hitld run rebuild`);
    }
    assertHolds(state, this.session, this.host);
    return state;
  }

  /** @param {RunState} previous @param {LedgerEntry[]} events */
  #checkpoint(previous, events) {
    const next = structuredClone(previous);
    absorb(next, events);
    next.lease.renewed_at = this.now().toISOString();
    this.state = saveCheckpoint(this.store, previous, next, { kept: this.kept });
  }
}

/**
 * Start a run: record run-started, write the first checkpoint, hold the lease. First the release
 * is checked against the pin and the data (design part 16.5): a release that is not the pinned one,
 * or a store holding data at a schema version it does not read, records nothing (VersionDriftError).
 * @param {PrivateStore} store
 * @param {RunOptions & { id?: string, scope?: Record<string, unknown>, policyHash?: string | null, replace?: boolean }} options
 * @returns {Run}
 */
export function startRun(store, options) {
  const drift = runVersionCheck(store, options);
  const now = options.now ?? (() => new Date());
  const expiry = options.expirySeconds ?? DEFAULTS.expirySeconds;
  const existing = loadState(store).state;
  if (existing && !options.replace) {
    const active =
      existing.in_flight.length > 0 ||
      (!existing.lease.released && !leaseExpired(existing, now(), expiry));
    if (active) {
      throw new Error(
        `run ${existing.run?.id} is still active (lease held by ${existing.lease.session} on ${existing.lease.host}, ${Math.round(leaseAgeSeconds(existing, now()))}s old; ${existing.in_flight.length} in flight); resume it with hitld run resume, or start a new run with replace`,
      );
    }
  }
  const { events } = readLedger(store);
  const id = options.id ?? defaultRunId(events, now());
  const { events: all } = appendEvent(
    store,
    {
      id: `run-started-${id}`,
      event: 'run-started',
      run: id,
      session: options.session,
      host: options.host,
      ...(options.harnessRef ? { harness_ref: options.harnessRef } : {}),
      skill_versions: { hitld_version: VERSION },
      ...(options.policyHash ? { policy_hash: options.policyHash } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
    },
    { now },
  );
  const state = foldLedger(all);
  const run = new Run(store, options, state);
  run.state = saveCheckpoint(store, existing, state, { kept: options.kept ?? DEFAULTS.kept });
  run.drift = drift;
  return run;
}

/**
 * @param {LedgerEntry[]} events @param {Date} now
 */
function defaultRunId(events, now) {
  const day = now.toISOString().slice(0, 10);
  const n = events.filter((e) => e.event === 'run-started' && e.run?.startsWith(`${day}-`)).length;
  return `${day}-${n + 1}`;
}

/**
 * Hold the lease on the persisted run: renew it if this session holds it, take it over if it was
 * released (a hand-over, or a session the chief of staff retired), has expired, or `force` says the
 * owner wants it, and refuse otherwise. Taking over is a ledger event, recorded before the state
 * changes. Anything the ledger holds beyond the state is absorbed.
 * @param {PrivateStore} store
 * @param {RunOptions & { force?: boolean }} options
 * @returns {{ run: Run, tookOver: { from: { session: string, host: string }, reason: 'expired' | 'owner' | 'handover' | 'ended' } | null, recoveredFrom: string | null, problems: string[] }}
 */
export function takeLease(store, options) {
  const now = options.now ?? (() => new Date());
  const kept = options.kept ?? DEFAULTS.kept;
  const expiry = options.expirySeconds ?? DEFAULTS.expirySeconds;
  const loaded = loadState(store);
  if (!loaded.state) {
    throw new Error(`no run state (${loaded.problems.join('; ')}); run hitld run rebuild`);
  }
  const persisted = loaded.state;
  const read = readLedger(store);
  // The ledger may hold events the state has not absorbed (a crash between the two writes). Absorb
  // them before judging the lease: one of them may be this session's own earlier takeover.
  const state = structuredClone(persisted);
  absorb(state, read.events);

  const previousHolder = { session: state.lease.session, host: state.lease.host };
  const released = state.lease.released ?? null;
  // A released lease is taken afresh, even by the session that gave it up.
  const mine =
    state.lease.session === options.session && state.lease.host === options.host && !released;
  /** @type {'expired' | 'owner' | 'handover' | 'ended' | null} */
  let reason = null;
  let events = read.events;
  if (!mine) {
    const expired = leaseExpired(state, now(), expiry);
    if (!released && !expired && !options.force) {
      throw new LeaseError(
        'held',
        `run ${state.run.id} is held by session ${state.lease.session} on ${state.lease.host}, renewed ${Math.round(leaseAgeSeconds(state, now()))}s ago; it expires after ${expiry}s. Wait, or take it over deliberately with force`,
        state.lease,
      );
    }
    reason = released ? released.reason : expired ? 'expired' : 'owner';
    ({ events } = appendEvent(
      store,
      {
        event: 'lease-taken',
        run: state.run.id,
        session: options.session,
        host: options.host,
        ...(options.harnessRef ? { harness_ref: options.harnessRef } : {}),
        skill_versions: { hitld_version: VERSION },
        notes: `from ${state.lease.session} on ${state.lease.host}; ${reason}`,
      },
      { now },
    ));
  }

  const run = new Run(store, options, persisted);
  const next = structuredClone(persisted);
  absorb(next, events);
  next.lease.renewed_at = now().toISOString();
  run.state = saveCheckpoint(store, persisted, next, { kept });
  // Read back to confirm this session won (see lease.mjs).
  assertHolds(/** @type {RunState} */ (loadState(store).state), options.session, options.host);
  return {
    run,
    tookOver: reason ? { from: previousHolder, reason } : null,
    recoveredFrom: loaded.source === 'run-state.json' ? null : loaded.source,
    problems: loaded.problems,
  };
}

/**
 * Release the lease before it expires (design part 13.1, disposable orchestrators). Two reasons:
 *   handover  the holder itself, after writing the hand-over: it stops driving the run
 *   ended     the chief of staff, which saw the holder's session end without a hand-over
 * A released lease is free for a successor at once (takeLease), and the released session can no
 * longer record (assertHolds). The release is a ledger event, then a checkpoint; the lease's renewal
 * time is left as it was. Releasing a lease already released is a no-op.
 * @param {PrivateStore} store
 * @param {RunOptions & { reason: 'handover' | 'ended', holder?: { session: string, host?: string }, notes?: string }} options
 *   `session` and `host` are the caller's; `holder` is the session to retire (reason ended)
 * @returns {{ released: { at: string, reason: string, by: string }, appended: boolean, state: RunState }}
 */
export function releaseLease(store, options) {
  const now = options.now ?? (() => new Date());
  const loaded = loadState(store);
  if (!loaded.state) {
    throw new Error(`no run state (${loaded.problems.join('; ')}); run hitld run rebuild`);
  }
  const persisted = loaded.state;
  const state = structuredClone(persisted);
  absorb(state, readLedger(store).events);
  const l = state.lease;
  const self = options.reason === 'handover';
  const holder = self
    ? { session: options.session, host: options.host }
    : {
        session: options.holder?.session ?? '',
        host: options.holder?.host ?? (options.holder?.session === l.session ? l.host : ''),
      };
  if (!self && holder.session === options.session && holder.host === options.host) {
    throw new LeaseError('held', 'a session does not retire itself: it hands over', l);
  }
  if (l.session !== holder.session || l.host !== holder.host) {
    throw new LeaseError(
      'lost',
      `the lease on run ${state.run.id} is held by session ${l.session} on ${l.host}, not by ${holder.session}${holder.host ? ` on ${holder.host}` : ''}`,
      l,
    );
  }
  if (l.released) return { released: l.released, appended: false, state };
  const { events } = appendEvent(
    store,
    {
      event: 'lease-released',
      run: state.run.id,
      session: holder.session,
      host: holder.host,
      reason: options.reason,
      by: options.session,
      ...(options.notes ? { notes: options.notes } : {}),
    },
    { now },
  );
  const next = structuredClone(persisted);
  absorb(next, events);
  const written = saveCheckpoint(store, persisted, next, {
    kept: options.kept ?? DEFAULTS.kept,
  });
  return { released: written.lease.released, appended: true, state: written };
}

/**
 * Whether the session holding the lease should hand over (design part 13.1): after
 * `afterCompletions` completions since it took the lease, or once the share of its context it has
 * used reaches `contextShare`. The share is the larger of what the chief of staff last measured
 * from the harness's record of the session (a `context-measured` event since the lease was taken,
 * HITLD-794) and what the session itself reports (`contextUsed`): a lower self-report never undoes
 * a measurement.
 * @param {RunState} state @param {LedgerEntry[]} events
 * @param {{ afterCompletions?: number, contextShare?: number, contextUsed?: number | null }} [limits]
 */
export function handoverDue(state, events, limits = {}) {
  const after = limits.afterCompletions ?? HANDOVER_DEFAULTS.afterCompletions;
  const share = limits.contextShare ?? HANDOVER_DEFAULTS.contextShare;
  const reported = typeof limits.contextUsed === 'number' ? limits.contextUsed : null;
  const l = state.lease;
  const took = events.findLastIndex(
    (e) =>
      (e.event === 'run-started' || e.event === 'lease-taken') &&
      e.session === l.session &&
      e.host === l.host,
  );
  const since = events.slice(took + 1);
  // A correction of a completion's figure (hitld ledger correct-tokens) is not a completion.
  const completions = since.filter(
    (e) => e.event === 'reported' && e.corrects === undefined,
  ).length;
  const measurement = since.findLast(
    (e) =>
      e.event === 'context-measured' &&
      e.session === l.session &&
      e.host === l.host &&
      typeof e.context_share === 'number',
  );
  const measured = measurement ? /** @type {number} */ (measurement.context_share) : null;
  const used =
    measured === null ? reported : reported === null ? measured : Math.max(measured, reported);
  const source =
    used === null ? null : measured !== null && used === measured ? 'measured' : 'reported';
  /** @type {string[]} */
  const reasons = [];
  if (completions >= after) {
    reasons.push(`${completions} completions since this session took the lease (limit ${after})`);
  }
  if (used !== null && used >= share) {
    reasons.push(
      `${Math.round(used * 100)}% of the context used, ${source === 'measured' ? 'as the chief of staff measured it' : 'as the session reported it'} (limit ${Math.round(share * 100)}%)`,
    );
  }
  return {
    due: reasons.length > 0,
    reasons,
    completions,
    after_completions: after,
    context_used: used,
    context_source: source,
    context_measured_at: measurement?.at ?? null,
    context_share: share,
  };
}

/** The package defaults for policy orchestrator.handover_* (HITLD-794). */
export const HANDOVER_DEFAULTS = Object.freeze({ afterCompletions: 8, contextShare: 0.3 });

/**
 * The dispatches whose completion notice reaches only the session that dispatched them: background
 * agents, on this host. A session that hands over waits for these first, since no successor would
 * hear of them. An interactive tier-3 session reports through the chief of staff, which started
 * it, and a headless run is a durable process whose completion any later session's
 * `hitld dispatch reconcile` observes (HITLD-746), so neither holds a hand-over up.
 * @param {RunState} state @param {string} host
 * @returns {InFlight[]}
 */
export const reportingHere = (state, host) =>
  state.in_flight.filter(
    (/** @type {InFlight} */ d) =>
      d.mode !== 'interactive' && d.mode !== 'headless' && (d.host === null || d.host === host),
  );

/**
 * The lease as the chief of staff reads it to route a wake: who holds it, and whether it is free
 * for a successor (released, or expired).
 * @param {RunState} state @param {Date} now @param {number} [expirySeconds]
 */
export function leaseStatus(state, now, expirySeconds = DEFAULTS.expirySeconds) {
  const l = state.lease;
  const expired = leaseExpired(state, now, expirySeconds);
  return {
    session: l.session,
    host: l.host,
    harness_ref: l.harness_ref ?? null,
    renewed_at: l.renewed_at,
    age_seconds: Math.round(leaseAgeSeconds(state, now)),
    expired,
    released: l.released ?? null,
    free: Boolean(l.released) || expired,
  };
}

/**
 * Resume a run in a fresh session (design part 13.1): take the lease, absorb the ledger events
 * after the state's position, reconcile the in-flight dispatches with reality, and return the
 * hand-over summary. The release is checked first, as in startRun.
 *
 * For each dispatch in flight on this host:
 *   a completion arrived  -> its `reported` event is recorded
 *   an executor is live   -> adopted (its harness_ref recorded if the crash lost it)
 *   neither, with commits -> offered as a follow-up (left in flight)
 *   neither               -> abandoned, and its item unclaimed
 * Dispatches on another host cannot be adopted from here and stay in flight. Without `reality.live`
 * nothing can be called dead, so nothing is abandoned and the dispatches are listed as unverified.
 * @param {PrivateStore} store
 * @param {RunOptions & { force?: boolean, reality?: Reality }} options
 */
export async function resumeRun(store, options) {
  const drift = runVersionCheck(store, options);
  const { run, tookOver, recoveredFrom, problems } = takeLease(store, options);
  const reconciled = await reconcile(run, options.reality);
  return {
    run,
    tookOver,
    recoveredFrom,
    problems,
    ...reconciled,
    handover: handOver(run.state, readLedger(store).events),
    drift,
  };
}

/**
 * @param {Run} run @param {Reality} [reality]
 */
async function reconcile(run, reality) {
  /** @type {{ reported: string[], adopted: string[], abandoned: string[], unclaimed_items: string[], follow_up: InFlight[], foreign: InFlight[], unverified: string[] }} */
  const out = {
    reported: [],
    adopted: [],
    abandoned: [],
    unclaimed_items: [],
    follow_up: [],
    foreign: [],
    unverified: [],
  };
  const entries = structuredClone(run.state.in_flight);
  if (!entries.length) return out;
  const liveRaw = reality?.live ? await reality.live() : null;
  /** @type {{ dispatch: string, harness?: string, ref?: string }[] | null} */
  const live = liveRaw
    ? liveRaw.map((l) => (typeof l === 'string' ? { dispatch: l } : /** @type {any} */ (l)))
    : null;
  const completions = reality?.completed ? await reality.completed() : [];

  for (const entry of entries) {
    if (entry.host && entry.host !== run.host) {
      out.foreign.push(entry);
      continue;
    }
    const completion = completions.find((c) => c.dispatch === entry.dispatch);
    if (completion) {
      run.record(reportedEvent(entry, completion, readLedger(run.store).events));
      out.reported.push(entry.dispatch);
      continue;
    }
    if (live === null) {
      out.unverified.push(entry.dispatch);
      continue;
    }
    const found = live.find((l) => l.dispatch === entry.dispatch);
    if (found) {
      if (entry.harness_ref === null && found.ref) {
        run.record({
          id: `started-${entry.dispatch}`,
          event: 'started',
          dispatch: entry.dispatch,
          item: entry.item,
          harness: found.harness ?? reality?.harness ?? 'unknown',
          harness_ref: found.ref,
          host: run.host,
        });
      }
      out.adopted.push(entry.dispatch);
      continue;
    }
    if (reality?.hasCommits?.(entry)) {
      out.follow_up.push(entry);
      continue;
    }
    run.record({
      id: `abandoned-${entry.dispatch}`,
      event: 'abandoned',
      dispatch: entry.dispatch,
      item: entry.item,
      notes: 'no live executor and no report at resume',
    });
    run.record({
      id: `unclaimed-${entry.dispatch}`,
      event: 'unclaimed',
      item: entry.item,
      notes: `after abandoning ${entry.dispatch}`,
    });
    out.abandoned.push(entry.dispatch);
    out.unclaimed_items.push(entry.item);
  }
  return out;
}

/**
 * Rebuild the run state from the ledger (and, when `reality.branches` is given, cross-check claim
 * branches). Controllers and quotas are not in the ledger: they carry over from the state or
 * checkpoint that can still be read, and are empty otherwise. The lease comes from the ledger's
 * last run-started or lease-taken, so a session that held it before the loss still holds it.
 * @param {PrivateStore} store
 * @param {{ now?: () => Date, kept?: number, reality?: Reality, branchPrefix?: string }} [options]
 */
export function rebuildRun(store, options = {}) {
  const { events, problems } = readLedger(store);
  if (!events.some((e) => e.event === 'run-started')) {
    throw new Error('the ledger has no run-started event; start a run with hitld run start');
  }
  const prior = loadState(store);
  const state = foldLedger(events);
  if (prior.state) {
    state.controllers = prior.state.controllers;
    state.quotas = prior.state.quotas;
  }
  const written = saveCheckpoint(store, prior.state, state, {
    kept: options.kept ?? DEFAULTS.kept,
  });

  /** @type {string[]} */
  const changed = [];
  if (prior.state) {
    for (const key of Object.keys(written)) {
      if (['checkpoint', 'lease'].includes(key)) continue;
      if (canonicalJson(written[key]) !== canonicalJson(prior.state[key])) changed.push(key);
    }
  }

  let branches = null;
  if (options.reality?.branches) {
    const existing = new Set(options.reality.branches());
    const known = new Set(events.map((e) => e.branch).filter((b) => b !== undefined));
    const prefix = `${options.branchPrefix ?? 'hitld'}/`;
    branches = {
      missing: written.in_flight
        .filter((/** @type {InFlight} */ d) => d.branch && !existing.has(d.branch))
        .map((/** @type {InFlight} */ d) => d.dispatch),
      unrecorded: [...existing].filter((b) => b.startsWith(prefix) && !known.has(b)).sort(),
    };
  }
  return {
    state: written,
    ledger_events: events.length,
    ledger_problems: problems,
    previous: prior.state
      ? { source: prior.source, changed }
      : { source: null, problems: prior.problems },
    branches,
  };
}

/** Where a hand-over note lives in the private store. @param {string} run @param {number} checkpoint */
export const handoverKey = (run, checkpoint) => `orchestrator/handover-${run}-${checkpoint}.md`;

/**
 * The latest hand-over note of a run, as a store key, or null.
 * @param {PrivateStore} store @param {string} run
 */
export function latestHandover(store, run) {
  const prefix = `orchestrator/handover-${run}-`;
  /** @param {string} k */
  const n = (k) => Number(k.slice(prefix.length, -'.md'.length));
  const keys = store
    .list('orchestrator/')
    .filter((k) => k.startsWith(prefix) && /^\d+\.md$/.test(k.slice(prefix.length)))
    .sort((a, b) => n(b) - n(a));
  return keys[0] ?? null;
}

/**
 * The hand-over summary, generated from the state and the ledger, never from memory.
 * @param {RunState} state @param {LedgerEntry[]} events
 */
export function handOver(state, events) {
  const recent = events.slice(-5).map((e) => ({
    id: e.id,
    event: e.event,
    item: e.item ?? null,
    dispatch: e.dispatch ?? null,
    at: e.at,
  }));
  const lines = [
    `Run ${state.run.id}, started ${state.run.started_at}. Checkpoint ${state.checkpoint.number}, ledger at ${state.ledger_position}.`,
    `Lease: session ${state.lease.session} on ${state.lease.host}, renewed ${state.lease.renewed_at}${state.lease.released ? `; released (${state.lease.released.reason}) by ${state.lease.released.by} at ${state.lease.released.at}` : ''}.`,
    `In flight (${state.in_flight.length}): ${
      state.in_flight
        .map(
          (/** @type {InFlight} */ d) =>
            `${d.dispatch} ${d.item}${d.role ? ` ${d.role}` : ''}${d.host ? ` on ${d.host}` : ''}${d.harness_ref ? '' : ' (no harness_ref yet)'}`,
        )
        .join('; ') || 'none'
    }.`,
    `Decisions open (${state.decisions_open.length}): ${
      state.decisions_open
        .map(
          (/** @type {any} */ q) =>
            `${q.decision} (asked ${q.asked_at}, ${q.sent_at ? `sent ${q.sent_at}` : 'not sent yet'}${q.dispatch ? `, from ${q.dispatch}` : ''})`,
        )
        .join('; ') || 'none'
    }.`,
    `Waiting to merge (${state.merge_queue.waiting.length}): ${state.merge_queue.waiting.map((/** @type {any} */ w) => w.item).join(', ') || 'none'}.`,
    `Decisions answered this run: ${state.decisions_answered.length}.`,
    `Last events: ${recent.map((e) => `${e.event}${e.dispatch ? ` ${e.dispatch}` : e.item ? ` ${e.item}` : ''}`).join(', ') || 'none'}.`,
  ];
  return {
    run: state.run.id,
    checkpoint: state.checkpoint.number,
    ledger_position: state.ledger_position,
    lease: state.lease,
    in_flight: state.in_flight,
    decisions_open: state.decisions_open,
    merge_queue: state.merge_queue,
    decisions_answered: state.decisions_answered.length,
    recent_events: recent,
    text: lines.join('\n'),
  };
}

export { LedgerError, LeaseError };
