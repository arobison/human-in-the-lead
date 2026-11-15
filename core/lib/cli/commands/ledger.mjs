// Piece (b): the ledger and orchestrator continuity (design parts 5.4 and 13.1), and what the
// chief of staff reads and records about the run: who holds the lease, and retiring a session that
// ended without a hand-over.

import { hostname } from 'node:os';
import { findRepoRoot, loadPolicy, policyDefaults } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { LedgerError, appendEvent, correctsValidly, readLedger } from '../../ledger/ledger.mjs';
import { inflight } from '../../ledger/inflight.mjs';
import { summary } from '../../ledger/summary.mjs';
import { LeaseError } from '../../run/lease.mjs';
import {
  Run,
  handOver,
  handoverDue,
  latestHandover,
  leaseStatus,
  rebuildRun,
  releaseLease,
  reportingHere,
  resumeRun,
  startRun,
} from '../../run/run.mjs';
import { absorb } from '../../run/state.mjs';
import { gitReality } from '../../run/reality.mjs';
import { loadState } from '../../run/checkpoint.mjs';
import { recordPrimaryCheckout } from '../../env/primary.mjs';
import { executorSignal } from '../executor.mjs';
import { revertEvents } from '../../merge/owner.mjs';
import { readTrustEvents, recordTrustEvent } from '../../rights/trust.mjs';

/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead",
};
/** @type {import('../args.mjs').ArgSpec} */
const SESSION = {
  name: 'session',
  type: 'string',
  description:
    "This orchestrator session's ID, the same on every call of the session. Default: $HITLD_SESSION",
};
/** @type {import('../args.mjs').ArgSpec} */
const HOST = {
  name: 'host',
  type: 'string',
  description: "The machine this session runs on. Default: this machine's host name",
};
/** @type {import('../args.mjs').ArgSpec} */
const HARNESS_REF = {
  name: 'harness-ref',
  type: 'string',
  description:
    "This session's own reference in its harness, where it has one (a cloud session's ID): recorded with the lease, so the chief of staff sends wakes there",
};

/** --context-percent as a share, or null. @param {Record<string, unknown>} input */
const contextShareOf = (input) =>
  typeof input['context-percent'] === 'number' ? input['context-percent'] / 100 : null;

/**
 * The store and the settings that come from policy.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function setup(input, ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  const policy = loaded.policy ?? policyDefaults();
  /** @type {string} */
  let root;
  if (typeof input.store === 'string') {
    root = input.store;
  } else {
    if (!loaded.policy) {
      const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
      throw new Error(
        `cannot find the private store without a valid policy.json (${why}); or pass --store`,
      );
    }
    root = privateStorePath(loaded.policy.project.id, {
      env: ctx.env,
      repoRoot: findRepoRoot(ctx.cwd) ?? undefined,
    });
  }
  return {
    store: openStore(root),
    hash: loaded.hash,
    projectId: loaded.policy?.project.id ?? null,
    concurrency: policy.execution?.max_executors?.value,
    kept: policy.run?.checkpoints_kept,
    expirySeconds: policy.run?.lease_expiry_seconds,
    orchestrator: /** @type {Record<string, number | undefined>} */ (policy.orchestrator ?? {}),
    mainBranch: /** @type {string | undefined} */ (policy.merge?.main_branch),
    cwd: ctx.cwd,
  };
}

/** @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx */
function who(input, ctx) {
  const session = /** @type {string | undefined} */ (input.session) ?? ctx.env.HITLD_SESSION;
  if (!session) throw new Error('a session ID is needed: pass --session or set HITLD_SESSION');
  return { session, host: /** @type {string | undefined} */ (input.host) ?? hostname() };
}

/**
 * @param {() => import('../table.mjs').CommandResult | Promise<import('../table.mjs').CommandResult>} fn
 */
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LeaseError) {
      return { ok: false, error: `lease_${e.code}`, message: e.message, holder: e.holder };
    }
    if (e instanceof LedgerError)
      return { ok: false, error: 'invalid_event', message: e.message, errors: e.errors };
    throw e;
  }
}

/**
 * The only events raw append may write: about decisions and about work already reported. Every
 * dispatch lifecycle event (dispatched, started, reported, abandoned, unclaimed) and the run and
 * lease events belong to the run module alone, since they decide what is live and who may act.
 */
/** @type {Record<string, string[]>} */
const RAW_APPEND_FIELDS = {
  asked: ['decision', 'dispatch', 'notes'],
  sent: ['decision', 'notes'],
  answered: ['decision', 'notes'],
  logged: ['text', 'item', 'dispatch', 'area', 'notes', 'corrects'],
  verified: [
    'item',
    'result',
    'defects',
    'dispatch',
    'branch',
    'commit',
    'role',
    'notes',
    'corrects',
  ],
  merged: ['item', 'dispatch', 'branch', 'commit', 'notes', 'corrects'],
  reverted: ['item', 'dispatch', 'commit', 'notes', 'corrects'],
};
const RAW_APPEND_EVENTS = Object.keys(RAW_APPEND_FIELDS);
/** Fields the system sets: a caller's are dropped, not refused. */
const SYSTEM_FIELDS = ['id', 'run', 'at', 'schema_version'];

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'ledger append',
    summary:
      'Append an asked, sent, answered, logged, verified, merged or reverted event, as the session holding the lease (its ID, run and time are set here)',
    built_by: 'b',
    args: [
      {
        name: 'event',
        type: 'string',
        positional: true,
        required: true,
        description:
          'The event as JSON. event and any required fields; id, schema_version and at are filled in. Fields: schemas/ledger-entry.schema.json',
      },
      SESSION,
      HOST,
      STORE,
    ],
    run: (input, ctx) =>
      guarded(() => {
        let event;
        try {
          event = JSON.parse(String(input.event));
        } catch (e) {
          return {
            ok: false,
            error: 'usage',
            message: `the event is not JSON: ${/** @type {Error} */ (e).message}`,
          };
        }
        if (typeof event !== 'object' || event === null || Array.isArray(event)) {
          return { ok: false, error: 'usage', message: 'the event must be a JSON object' };
        }
        if (!RAW_APPEND_EVENTS.includes(event.event)) {
          return {
            ok: false,
            error: 'forbidden_event',
            message: `raw append writes only ${RAW_APPEND_EVENTS.join(', ')} events, not ${JSON.stringify(event.event)}; dispatch, report, abandon, release, run and lease events are written only by the run module`,
          };
        }
        const s = setup(input, ctx);
        const loaded = loadState(s.store);
        if (!loaded.state) {
          throw new Error(
            `no run state (${loaded.problems.join('; ')}); start a run with hitld run start`,
          );
        }
        // Run.record refuses a session that does not hold the lease, then appends and checkpoints.
        const run = new Run(
          s.store,
          { ...who(input, ctx), kept: s.kept, expirySeconds: s.expirySeconds },
          loaded.state,
        );
        // The ID, run and time are the system's, never the caller's.
        const fields = Object.fromEntries(
          Object.entries(event).filter(([k]) => !SYSTEM_FIELDS.includes(k)),
        );
        const allowed = ['event', ...RAW_APPEND_FIELDS[event.event]];
        const unknown = Object.keys(fields).filter((k) => !allowed.includes(k));
        if (unknown.length) {
          return {
            ok: false,
            error: 'forbidden_field',
            message: `a ${event.event} event may carry only ${allowed.join(', ')}; not ${unknown.join(', ')}`,
          };
        }
        if (fields.corrects !== undefined) {
          // A correction may only rewrite an event of its own kind about the same item or dispatch,
          // and that kind must be one raw append could have written.
          const target = readLedger(s.store).events.find((e) => e.id === fields.corrects);
          if (
            !target ||
            !RAW_APPEND_EVENTS.includes(target.event) ||
            !correctsValidly(target, /** @type {any} */ (fields))
          ) {
            return {
              ok: false,
              error: 'forbidden_correction',
              message: `corrects ${JSON.stringify(fields.corrects)}, which is ${target ? `a ${target.event} event about ${target.item ?? target.dispatch ?? 'something else'}` : 'not in the ledger'}; a correction must name an earlier ${fields.event} event with the same item or dispatch`,
            };
          }
        }
        const { event: written, appended } = run.record(fields);
        // A revert of a merge the owner approved is trust-calibration data (design 14.2).
        if (appended && written.event === 'reverted' && typeof written.item === 'string') {
          for (const ev of revertEvents(readTrustEvents(s.store), written.item)) {
            recordTrustEvent(s.store, ev, written.at);
          }
        }
        return { ok: true, appended, event: written };
      }),
  },
  {
    name: 'ledger tail',
    summary: 'Show the latest ledger events',
    built_by: 'b',
    args: [{ name: 'limit', type: 'integer', description: 'How many events (default 10)' }, STORE],
    run: (input, ctx) => {
      const { store } = setup(input, ctx);
      const { events, problems } = readLedger(store);
      const n = Math.max(1, /** @type {number | undefined} */ (input.limit) ?? 10);
      return {
        ok: true,
        total: events.length,
        events: events.slice(-n),
        ledger_problems: problems,
      };
    },
  },
  {
    name: 'ledger in-flight',
    summary: 'Dispatches without a terminal event, for restart',
    built_by: 'b',
    args: [STORE],
    run: (input, ctx) => {
      const { store } = setup(input, ctx);
      const { events, problems } = readLedger(store);
      return { ok: true, in_flight: inflight(events), ledger_problems: problems };
    },
  },
  {
    name: 'ledger summary',
    summary: 'The run report: tokens per accepted item, first-pass yield, waste, decision latency',
    built_by: 'b',
    args: [STORE],
    run: (input, ctx) => ({ ok: true, ...summary(setup(input, ctx).store) }),
  },
  {
    name: 'run start',
    summary: 'Start a run: record it in the ledger, write the first checkpoint and hold the lease',
    built_by: 'b',
    args: [
      { name: 'id', type: 'string', description: 'The run ID. Default: <date>-<n>' },
      {
        name: 'scope',
        type: 'string',
        description:
          'What the run covers, as JSON: items, milestones, budget_tokens, max_executors, stop_when. max_executors defaults to policy execution.max_executors',
      },
      {
        name: 'replace',
        type: 'boolean',
        description:
          'Start even though the last run still holds a fresh lease or has work in flight',
      },
      SESSION,
      HOST,
      HARNESS_REF,
      STORE,
    ],
    run: (input, ctx) =>
      guarded(() => {
        const s = setup(input, ctx);
        /** @type {Record<string, unknown>} */
        let scope = {};
        if (typeof input.scope === 'string') {
          try {
            scope = JSON.parse(input.scope);
          } catch (e) {
            return {
              ok: false,
              error: 'usage',
              message: `--scope is not JSON: ${/** @type {Error} */ (e).message}`,
            };
          }
        }
        if (scope.max_executors === undefined && s.concurrency !== undefined) {
          scope.max_executors = s.concurrency;
        }
        const run = startRun(s.store, {
          ...who(input, ctx),
          id: /** @type {string | undefined} */ (input.id),
          scope,
          policyHash: s.hash,
          replace: input.replace === true,
          harnessRef: /** @type {string | undefined} */ (input['harness-ref']),
          kept: s.kept,
          expirySeconds: s.expirySeconds,
        });
        // Where the owner's primary checkout is, for `hitld env exec` to load policy from (part 13.2).
        // Only after the run has started, so a refused start records nothing. A failure does not stop the run: without a record `env exec` refuses every task, which
        // is the safe outcome. It is reported so the owner sees why.
        /** @type {Record<string, unknown>} */
        let primary = { recorded: false, error: 'no policy.json, so no project to record it for' };
        if (s.projectId) {
          try {
            primary = {
              ...recordPrimaryCheckout(s.store, { projectId: s.projectId, cwd: ctx.cwd }),
            };
          } catch (e) {
            primary = { recorded: false, error: /** @type {Error} */ (e).message };
          }
        }
        return {
          ok: true,
          run: run.state.run,
          checkpoint: run.state.checkpoint.number,
          primary_checkout: primary,
          handover: handOver(run.state, readLedger(s.store).events),
        };
      }),
  },
  {
    name: 'run checkpoint',
    summary:
      'A clean point with nothing new to record: absorb the ledger into the run state and renew the lease',
    built_by: 'b',
    args: [SESSION, HOST, STORE],
    run: (input, ctx) =>
      guarded(() => {
        const s = setup(input, ctx);
        const loaded = loadState(s.store);
        if (!loaded.state)
          throw new Error(`no run state (${loaded.problems.join('; ')}); run hitld run rebuild`);
        const run = new Run(
          s.store,
          { ...who(input, ctx), kept: s.kept, expirySeconds: s.expirySeconds },
          loaded.state,
        );
        const state = run.checkpoint();
        return {
          ok: true,
          checkpoint: state.checkpoint.number,
          ledger_position: state.ledger_position,
        };
      }),
  },
  {
    name: 'run resume',
    summary: 'Take the lease, reconcile in-flight work and print the hand-over summary',
    built_by: 'b',
    args: [
      {
        name: 'live',
        type: 'string',
        description:
          'Comma-separated dispatch IDs the harness still shows running (or "none"). Without it nothing is called dead and nothing is abandoned: in-flight work is listed as unverified',
      },
      {
        name: 'force',
        type: 'boolean',
        description:
          'Take the lease although it has not expired and was not released (the owner says so, for example when moving machines)',
      },
      SESSION,
      HOST,
      HARNESS_REF,
      STORE,
    ],
    run: (input, ctx) =>
      guarded(async () => {
        const s = setup(input, ctx);
        const live =
          typeof input.live === 'string'
            ? input.live
                .split(',')
                .map((x) => x.trim())
                .filter((x) => x && x !== 'none')
            : null;
        const reality = gitReality({ cwd: s.cwd, mainBranch: s.mainBranch });
        if (live) reality.live = () => live;
        const r = await resumeRun(s.store, {
          ...who(input, ctx),
          force: input.force === true,
          kept: s.kept,
          expirySeconds: s.expirySeconds,
          harnessRef: /** @type {string | undefined} */ (input['harness-ref']),
          reality,
        });
        return {
          ok: true,
          took_over: r.tookOver,
          recovered_from: r.recoveredFrom,
          problems: r.problems,
          reported: r.reported,
          adopted: r.adopted,
          abandoned: r.abandoned,
          unclaim_items: r.unclaimed_items,
          follow_up: r.follow_up,
          foreign: r.foreign,
          unverified: r.unverified,
          handover: handOver(r.run.state, readLedger(s.store).events),
        };
      }),
  },
  {
    name: 'run status',
    summary:
      'Who holds the run lease and where wakes go, whether it is free for a successor, and whether its holder should hand over. Reads only',
    built_by: 'b',
    args: [
      {
        name: 'context-percent',
        type: 'integer',
        description:
          'When the holder asks: the percentage of its context it has used, as its harness shows it; compared with policy orchestrator.handover_context_share',
      },
      STORE,
    ],
    run: (input, ctx) =>
      guarded(() => {
        const s = setup(input, ctx);
        const loaded = loadState(s.store);
        if (!loaded.state) {
          return {
            ok: false,
            error: 'no_run',
            message: `no run state (${loaded.problems.join('; ')}); start a run with hitld run start, or hitld run rebuild`,
          };
        }
        // The ledger may hold events the state has not absorbed yet; read them, change nothing.
        const events = readLedger(s.store).events;
        const state = absorb(structuredClone(loaded.state), events).state;
        const lease = leaseStatus(state, new Date(), s.expirySeconds);
        const handover = handoverDue(state, events, {
          afterCompletions: s.orchestrator.handover_after_completions,
          contextShare: s.orchestrator.handover_context_share,
          contextUsed: contextShareOf(input),
        });
        const file = latestHandover(s.store, state.run.id);
        const sessions = state.in_flight
          .filter((/** @type {any} */ d) => d.mode === 'interactive')
          .map((/** @type {any} */ d) => d.dispatch);
        const live = sessions.length ? sessions.join(',') : 'none';
        return {
          ok: true,
          run: state.run,
          lease,
          wake_to: lease.free ? null : (lease.harness_ref ?? lease.session),
          in_flight: state.in_flight.length,
          own_sessions: sessions,
          decisions_open: state.decisions_open.length,
          waiting_to_merge: state.merge_queue.waiting.length,
          handover,
          handover_file: file ? `${s.store.root}/${file}` : null,
          next: lease.free
            ? `the lease is free (${lease.released ? `released: ${lease.released.reason}` : 'expired'}): start a successor orchestrator session${file ? ` with the hand-over ${s.store.root}/${file}` : ''}; it runs hitld run resume --live <of ${live}, the ones still running>`
            : `send wakes for this run to ${lease.harness_ref ?? `session ${lease.session}`}${handover.due ? `; its hand-over is due (${handover.reasons.join('; ')})` : ''}`,
        };
      }),
  },
  {
    name: 'run retire',
    summary:
      "Release the lease of an orchestrator session that ended without a hand-over, so a successor resumes the run at once. The chief of staff's, on the harness's word that the session ended",
    built_by: 'b',
    args: [
      {
        name: 'holder',
        type: 'string',
        required: true,
        description: 'The session that ended: the lease holder, as hitld run status names it',
      },
      {
        name: 'holder-host',
        type: 'string',
        description: "The holder's machine. Default: the lease's",
      },
      SESSION,
      HOST,
      STORE,
    ],
    run: (input, ctx) =>
      guarded(() => {
        const why = executorSignal(ctx.env, ctx.cwd);
        if (why) {
          return {
            ok: false,
            error: 'not_permitted',
            message: `hitld run retire is the chief of staff's, run in the primary checkout (${why}); executors never touch the lease`,
          };
        }
        const s = setup(input, ctx);
        const r = releaseLease(s.store, {
          ...who(input, ctx),
          kept: s.kept,
          reason: 'ended',
          holder: {
            session: String(input.holder),
            ...(typeof input['holder-host'] === 'string' ? { host: input['holder-host'] } : {}),
          },
          notes: 'the session ended without a hand-over',
        });
        const waiting = reportingHere(r.state, r.state.lease.host).map(
          (/** @type {any} */ d) => d.dispatch,
        );
        return {
          ok: true,
          retired: { session: r.state.lease.session, host: r.state.lease.host },
          released: r.released,
          appended: r.appended,
          // Background work the ended session started reported to it alone: the successor's
          // resume decides what is live, what has commits to continue, and what is abandoned.
          reported_to_it: waiting,
          next: 'start a successor orchestrator session; it runs hitld run resume (no --force needed)',
        };
      }),
  },
  {
    name: 'run rebuild',
    summary: 'Rebuild the run-state file from the ledger, claim branches and the tracker',
    built_by: 'b',
    args: [
      {
        name: 'branch-prefix',
        type: 'string',
        description: 'The claim-branch prefix to cross-check (default "hitld")',
      },
      STORE,
    ],
    run: (input, ctx) =>
      guarded(() => {
        const s = setup(input, ctx);
        const r = rebuildRun(s.store, {
          kept: s.kept,
          reality: gitReality({ cwd: s.cwd, mainBranch: s.mainBranch }),
          branchPrefix: /** @type {string | undefined} */ (input['branch-prefix']),
        });
        return {
          ok: true,
          checkpoint: r.state.checkpoint.number,
          ledger_events: r.ledger_events,
          ledger_problems: r.ledger_problems,
          previous: r.previous,
          branches: r.branches,
          handover: handOver(r.state, readLedger(s.store).events),
        };
      }),
  },
];
