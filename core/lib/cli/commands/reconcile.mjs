// `hitld dispatch reconcile` (HITLD-779, HITLD-780): the stateless pass any orchestrator turn runs
// to record the completions it observes. It reads the in-flight dispatches, each one's branch head
// and what its harness shows, and records each that is complete through `dispatch complete`: the
// report from the executor's closing commit, the tokens from the harness's record. Everything else
// is shown with its evidence. The judgment is core/lib/dispatch/reconcile.mjs.
//
// The one stop is the budget backstop (HITLD-782): an executor with no closing report whose harness
// record shows it past its dispatch's cap, by more than the closing allowance, is one its budget
// hook missed, and the pass stops it with `hitld dispatch stop`. No wall-clock time stops anything.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { lifecycleId, readLedger } from '../../ledger/ledger.mjs';
import { releaseExecutor } from '../../registry/machine.mjs';
import { budgetOf } from '../../dispatch/budget.mjs';
import { completionOf } from '../../../harness/claude-code/adapter.mjs';
import { headlessEvents } from '../../../harness/claude-code/completion.mjs';
import { credentialFailure } from '../../../harness/claude-code/credential.mjs';
import { absorb } from '../../run/state.mjs';
import { assertHolds } from '../../run/lease.mjs';
import { processSignal } from '../../run/reality.mjs';
import { progressTimes, readProgress } from '../../dispatch/progress.mjs';
import { exitedParents } from '../../dispatch/parent.mjs';
import { reportRequest } from '../../dispatch/watch.mjs';
import { branchHeads, judgeDispatch, withCommit } from '../../dispatch/reconcile.mjs';
import { git } from '../../tracker/files/tree.mjs';
import {
  Refusal,
  completeDispatch,
  guarded,
  identityOf,
  nowOf,
  pidKey,
  project,
  resultKey,
  runOf,
  stderrKey,
} from './orchestrator.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../../ledger/inflight.mjs').InFlight} InFlight
 * @typedef {import('../../dispatch/reconcile.mjs').Harness} Harness
 * @typedef {import('../../../harness/claude-code/adapter.mjs').Notification} Notification
 */

/** @param {string} path @param {Ctx} ctx */
const readInput = (path, ctx) =>
  readFileSync(isAbsolute(path) ? path : resolve(ctx.cwd, path), 'utf8');

/**
 * The records given with --session-record, by dispatch ID: `D-<n>=<file>`.
 * @param {unknown} given @returns {Map<string, string>}
 */
function recordsOf(given) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const x of /** @type {string[]} */ (given ?? [])) {
    const m = /^(D-[^=\s]+)=(.+)$/.exec(String(x));
    if (!m) throw new Refusal('usage', `--session-record takes D-<n>=<file>, not ${x}`);
    out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Fetch each in-flight branch from the remote, when there is one, so a branch the executor pushed
 * is seen; a branch the remote does not have is skipped.
 * @param {string} repoRoot @param {string} remote @param {string[]} branches
 */
function fetchBranches(repoRoot, remote, branches) {
  if (!git(repoRoot, ['remote', 'get-url', remote], { allowFail: true }).trim()) return false;
  for (const b of branches) {
    git(repoRoot, ['fetch', '--quiet', remote, `+refs/heads/${b}:refs/remotes/${remote}/${b}`], {
      allowFail: true,
    });
  }
  return true;
}

/**
 * What an executor may spend past its cap before the backstop stops it: the closing steps the
 * budget hook leaves it (a commit, a push, the close and the report), a tenth of the cap. Past
 * that, the hook missed it.
 * @param {number} cap
 */
export const closingAllowance = (cap) => Math.round(cap / 10);

/**
 * An in-flight dispatch's tokens as its harness record gives them, or null when there is no record
 * or it holds no usage: an interactive session's result events, a headless run's result file, a
 * background agent's completion notice. Read only, never recorded here.
 * @param {InFlight} entry @param {string | null} record the record given with --session-record
 * @param {string | null} stored a headless run's result file @param {string | undefined} since
 * @returns {number | null}
 */
function recordedTokens(entry, record, stored, since) {
  /** @type {Notification | null} */
  const n =
    entry.mode === 'interactive' && record !== null
      ? { kind: 'session', record, since: since ?? null, report: '' }
      : entry.mode === 'headless' && stored
        ? { kind: 'headless', json: stored, report: '' }
        : record !== null
          ? { kind: 'subagent', text: record, report: '' }
          : null;
  if (!n) return null;
  try {
    const t = completionOf(entry.dispatch, n).usage?.tokens;
    return typeof t === 'number' ? t : null;
  } catch {
    return null;
  }
}

/**
 * Stop an in-flight dispatch past its token cap (HITLD-782): record it `interrupted` (which ends
 * the dispatch, with its commits kept on its branch and its item still claimed) and free its
 * executor slot, and say how the harness stops the executor itself. The guard refuses this command
 * to executors.
 * @param {ReturnType<typeof project>} p @param {Record<string, unknown>} input @param {Ctx} ctx
 * @param {{ dispatch: string, tokens: number | null }} o
 */
function stopDispatch(p, input, ctx, o) {
  const run = runOf(p, input, ctx);
  const events = readLedger(p.store).events;
  const entry = /** @type {InFlight | undefined} */ (
    absorb(structuredClone(run.state), events).state.in_flight.find(
      (/** @type {InFlight} */ d) => d.dispatch === o.dispatch,
    )
  );
  if (!entry) {
    throw new Refusal('not-in-flight', `${o.dispatch} is not in flight: nothing to stop`);
  }
  const budget = budgetOf(events, entry.dispatch, p.policy.dispatch);
  const figures =
    o.tokens !== null && budget
      ? `${o.tokens} of its ${budget.cap} tokens`
      : o.tokens !== null
        ? `${o.tokens} tokens`
        : budget
          ? `its cap of ${budget.cap} tokens`
          : 'its token cap';
  const recorded = run.record({
    id: lifecycleId('interrupted', entry.dispatch),
    event: 'interrupted',
    dispatch: entry.dispatch,
    item: entry.item,
    notes: `stopped past its token cap (${figures}); its commits stay on its branch`,
  });
  releaseExecutor(p.machineRoot, p.policy.project.id, entry.dispatch);
  const n = Number(entry.mode === 'headless' ? p.store.read(pidKey(entry.dispatch))?.trim() : NaN);
  const stop = {
    harness_ref: entry.harness_ref,
    mode: entry.mode ?? null,
    ...(Number.isInteger(n) && n > 1 ? { pid: n } : {}),
  };
  return {
    ok: true,
    dispatch: entry.dispatch,
    item: entry.item,
    stopped: true,
    tokens: o.tokens,
    cap: budget?.cap ?? null,
    stop,
    already: !recorded.appended,
    next: `stop the executor's current turn through its harness (a session: interrupt it; a background agent: stop its task; a headless run: end process ${stop.pid ?? '(no process ID on file)'}); its commits stay on ${entry.branch ?? 'its branch'} and ${entry.item} stays claimed: hitld dispatch follow-up --dispatch ${entry.dispatch} continues it, or hitld dispatch plan re-plans it`,
  };
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'dispatch stop',
    summary:
      'Stop an in-flight dispatch past its token cap (HITLD-782): record it interrupted, free its executor slot, and say how to stop the executor through its harness. Its commits stay on its branch and its item stays claimed. The reconcile pass runs it on an overrun the budget hook missed',
    built_by: 'h',
    args: [
      { name: 'dispatch', type: 'string', required: true, description: 'The dispatch ID' },
      {
        name: 'tokens',
        type: 'integer',
        description: "The tokens the harness's record shows it has used, for the ledger's note",
      },
      {
        name: 'session',
        type: 'string',
        description:
          "This session's ID. Default: $HITLD_SESSION, else the harness's session ID, else the one run start recorded for this worktree",
      },
      {
        name: 'host',
        type: 'string',
        description:
          "The machine. Default: the host run start or run resume recorded for this session, else this machine's host name",
      },
    ],
    run: (input, ctx) =>
      guarded(() => {
        const p = project(ctx);
        const t = input.tokens === undefined ? null : Number(input.tokens);
        if (t !== null && t < 0) throw new Refusal('usage', '--tokens cannot be negative');
        return stopDispatch(p, input, ctx, { dispatch: String(input.dispatch), tokens: t });
      }),
  },
  {
    name: 'dispatch reconcile',
    summary:
      "Record the completions that can be observed: each in-flight dispatch whose branch head is its closing commit with a report, and whose executor the harness shows ended, is completed once, with the harness record's tokens. The rest are shown with their evidence (unreported, dead, closing, running); the only stop is the budget backstop, for one with no report whose harness record shows it past its token cap (hitld dispatch stop). Idempotent: run it at every turn",
    built_by: 'h',
    args: [
      {
        name: 'ended',
        type: 'string',
        description:
          "The executors the harness shows as ended or idle, comma-separated, by harness reference or dispatch ID: on the web, the sessions whose get_session status_bucket is not working, and the background agents whose completion notice arrived. A headless run's process is read on this machine",
      },
      {
        name: 'session-record',
        type: 'string',
        repeatable: true,
        description:
          "An executor's harness record, as D-<n>=<file>: an interactive session's result events (list_events of kind result) saved to a file, or a background agent's completion notice. The recorded tokens are read from it; for one still running, they are checked against its cap, and one past it with no report is stopped (hitld dispatch stop)",
      },
      {
        name: 'session',
        type: 'string',
        description:
          "This session's ID. Default: $HITLD_SESSION, else the harness's session ID, else the one run start recorded for this worktree",
      },
      {
        name: 'host',
        type: 'string',
        description:
          "The machine. Default: the host run start or run resume recorded for this session, else this machine's host name",
      },
    ],
    run: (input, ctx) =>
      guarded(() => {
        const p = project(ctx);
        if (!p.state) {
          return {
            ok: false,
            error: 'no-run',
            message: 'no run has started: nothing to reconcile',
          };
        }
        const records = recordsOf(input['session-record']);
        const ended = new Set(
          String(input.ended ?? '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        );
        const { session, host } = identityOf(p, input, ctx);
        const now = nowOf(ctx);
        // The ledger may hold events the run state has not absorbed: what another orchestrator
        // recorded is seen, so nothing is recorded twice.
        const events = readLedger(p.store).events;
        const state = absorb(structuredClone(p.state), events).state;
        /** @type {InFlight[]} */
        const inFlight = state.in_flight;
        let holds = false;
        try {
          if (session) {
            assertHolds(state, session, host);
            holds = true;
          }
        } catch {
          holds = false;
        }
        const remote = p.policy.merge?.pull_request?.remote ?? 'origin';
        const fetched = fetchBranches(
          p.repoRoot,
          remote,
          inFlight.map((e) => e.branch).filter((b) => typeof b === 'string'),
        );
        const parentExited = exitedParents(
          p.store,
          inFlight.filter((e) => !e.mode && (!e.host || e.host === host)),
          host,
        );

        /** @param {InFlight} entry @returns {Harness | null} */
        const harnessOf = (entry) => {
          const named =
            ended.has(entry.dispatch) || Boolean(entry.harness_ref && ended.has(entry.harness_ref));
          const signals = readProgress(p.store, entry);
          const times = progressTimes(signals);
          const last = times.length ? Math.max(...times) : null;
          const progress = {
            last_progress_at: last === null ? null : new Date(last).toISOString(),
            quiet_seconds: Math.max(
              0,
              Math.round((now - (last ?? Date.parse(entry.started_at))) / 1000),
            ),
          };
          if (entry.mode === 'headless') {
            if (entry.host && entry.host !== host) return null;
            const proc = processSignal({
              pidFile: join(p.store.root, pidKey(entry.dispatch)),
              outputFile: join(p.store.root, resultKey(entry.dispatch)),
            });
            // Ended: its process has exited and its output ends with its result event. A durable
            // run writes events while it runs (HITLD-746), so output without a result is a run
            // that was stopped: gone. One that stopped for its credential says so in its output
            // or its errors (HITLD-880).
            const lost =
              proc && !proc.alive
                ? credentialFailure(
                    headlessEvents(p.store.read(resultKey(entry.dispatch)) ?? '') ?? [],
                    p.store.read(stderrKey(entry.dispatch)) ?? '',
                  )
                : null;
            return {
              ended: Boolean(proc && !proc.alive && proc.result),
              gone: Boolean(proc && !proc.alive && !proc.result),
              credentialFailure: lost,
              evidence: {
                ...progress,
                process: proc
                  ? { alive: proc.alive, output_bytes: proc.output_bytes, result: proc.result }
                  : 'no process ID on file',
                ...(lost ? { credential_failure: lost } : {}),
              },
            };
          }
          const exited = parentExited.has(entry.dispatch);
          return {
            ended: named,
            gone: exited && !named,
            evidence: {
              ...progress,
              harness: named ? 'ended or idle' : 'not shown ended',
              ...(exited ? { parent: 'exited' } : {}),
            },
          };
        };

        /** @type {Record<string, any>[]} */
        const dispatches = [];
        /** @type {Record<string, any> | null} */
        let lastCompletion = null;
        for (const entry of inFlight) {
          const heads = entry.branch ? branchHeads(p.repoRoot, entry.branch, remote) : [];
          const harness = harnessOf(entry);
          const v = judgeDispatch({
            entry,
            heads,
            harness,
            hasRecord: records.has(entry.dispatch),
          });
          /** @type {Record<string, any>} */
          const shown = {
            dispatch: entry.dispatch,
            item: entry.item,
            mode: entry.mode ?? 'background',
            harness_ref: entry.harness_ref,
            state: v.state,
            why: v.why,
            evidence: {
              branch: entry.branch,
              heads: heads.map((h) => ({
                ref: h.ref,
                sha: h.sha,
                subject: h.subject,
                ...(h.dispatch ? { dispatch: h.dispatch } : {}),
                report: Boolean(h.report),
              })),
              ...(harness?.evidence ?? {}),
            },
          };
          if (v.state === 'unreported') shown.report_request = reportRequest(entry.dispatch);
          if (v.state === 'awaiting_record') {
            shown.next = `save session ${entry.harness_ref ?? `of ${entry.dispatch}`}'s result events (the event list of kind result) to a file; hitld dispatch reconcile --ended ${entry.harness_ref ?? entry.dispatch} --session-record ${entry.dispatch}=<file>`;
          }
          if (v.state === 'blocked') {
            // Recorded as blocked through dispatch complete, from the run's own output: the
            // executor cannot report, having no credential to run on (HITLD-880).
            if (!holds) {
              shown.recorded = false;
              shown.next = 'the session holding the lease records it with hitld dispatch reconcile';
              dispatches.push(shown);
              continue;
            }
            const stored = p.store.read(resultKey(entry.dispatch));
            const stderr = p.store.read(stderrKey(entry.dispatch)) ?? '';
            /** @type {Record<string, any>} */
            let done;
            try {
              done = completeDispatch(
                { dispatch: entry.dispatch, ...(session ? { session } : {}), host },
                ctx,
                // Output with no JSON in it (the run stopped before its first event) is no events.
                {
                  kind: 'headless',
                  json: stored && headlessEvents(stored) ? stored : '[]',
                  stderr,
                },
              );
            } catch (e) {
              if (!(e instanceof Refusal)) throw e;
              done = { ok: false, error: e.code, message: e.message, ...e.more };
            }
            const { refill: _r, handover: _h, ...completion } = done;
            if (done.ok && !done.already) lastCompletion = done;
            shown.recorded = Boolean(done.ok && !done.already);
            shown.completion = completion;
            dispatches.push(shown);
            continue;
          }
          if (v.state === 'complete' && v.closing) {
            if (!holds) {
              shown.recorded = false;
              shown.next = 'the session holding the lease records it with hitld dispatch reconcile';
              dispatches.push(shown);
              continue;
            }
            const report = withCommit(
              /** @type {string} */ (v.closing.report),
              v.closing.sha,
              /** @type {string} */ (entry.branch),
            );
            const file = records.get(entry.dispatch);
            const record = file ? readInput(file, ctx) : null;
            const stored =
              entry.mode === 'headless' ? p.store.read(resultKey(entry.dispatch)) : null;
            const since = events.find(
              (e) => e.event === 'dispatched' && e.dispatch === entry.dispatch,
            )?.at;
            /** @type {Notification} */
            const n =
              entry.mode === 'interactive' && record !== null
                ? { kind: 'session', record, since: since ?? null, report }
                : entry.mode === 'headless' && stored
                  ? { kind: 'headless', json: stored, report }
                  : { kind: 'subagent', text: record ?? report, report };
            /** @type {Record<string, any>} */
            let done;
            try {
              done = completeDispatch(
                { dispatch: entry.dispatch, ...(session ? { session } : {}), host },
                ctx,
                n,
              );
            } catch (e) {
              if (!(e instanceof Refusal)) throw e;
              done = { ok: false, error: e.code, message: e.message, ...e.more };
            }
            const { refill: _r, handover: _h, ...completion } = done;
            if (done.ok && !done.already) lastCompletion = done;
            shown.recorded = Boolean(done.ok && !done.already);
            shown.completion = completion;
          }
          // The budget backstop: no closing report, and the harness's record shows it past its cap
          // by more than the closing allowance. Read only from the harness's record, never the
          // executor's own word.
          const budget =
            v.state === 'running' || v.state === 'unreported'
              ? budgetOf(events, entry.dispatch, p.policy.dispatch)
              : null;
          const file = budget ? records.get(entry.dispatch) : undefined;
          const used = budget
            ? recordedTokens(
                entry,
                file ? readInput(file, ctx) : null,
                entry.mode === 'headless' ? p.store.read(resultKey(entry.dispatch)) : null,
                budget.since,
              )
            : null;
          if (budget && used !== null && used > budget.cap + closingAllowance(budget.cap)) {
            shown.overrun = { tokens: used, cap: budget.cap };
            if (holds) {
              /** @type {Record<string, any>} */
              let stopped;
              try {
                stopped = stopDispatch(p, input, ctx, { dispatch: entry.dispatch, tokens: used });
              } catch (e) {
                if (!(e instanceof Refusal)) throw e;
                stopped = { ok: false, error: e.code, message: e.message };
              }
              shown.stopped = stopped;
            } else {
              shown.next = `the session holding the lease stops it: hitld dispatch stop --dispatch ${entry.dispatch} --tokens ${used}`;
            }
          }
          dispatches.push(shown);
        }

        const of = (/** @type {string} */ s) => dispatches.filter((x) => x.state === s);
        const recorded = dispatches.filter((x) => x.recorded);
        const unreported = of('unreported');
        const dead = of('dead').filter((x) => !x.stopped?.ok);
        const blocked = of('blocked');
        const awaiting = of('awaiting_record');
        const stopped = dispatches.filter((x) => x.stopped?.ok);
        const overrun = dispatches.filter((x) => x.overrun && !x.stopped?.ok);
        return {
          ok: true,
          at: new Date(now).toISOString(),
          holds_lease: holds,
          ...(fetched ? { fetched_from: remote } : {}),
          dispatches,
          recorded: recorded.map((x) => x.dispatch),
          ...(stopped.length ? { stopped: stopped.map((x) => x.dispatch) } : {}),
          ...(lastCompletion?.refill ? { refill: lastCompletion.refill } : {}),
          ...(lastCompletion?.handover ? { handover: lastCompletion.handover } : {}),
          next:
            [
              ...recorded.map((x) => `${x.dispatch}: recorded; do what its completion's next says`),
              ...blocked
                .filter((x) => !x.recorded)
                .map((x) => `${x.dispatch}: ${x.why}; ${x.next ?? 'not recorded'}`),
              ...awaiting.map((x) => `${x.dispatch}: ${x.next}`),
              ...stopped.map(
                (x) =>
                  `${x.dispatch}: stopped past its token cap (${x.overrun.tokens} of ${x.overrun.cap}); ${x.stopped.next}`,
              ),
              ...overrun.map((x) => `${x.dispatch}: past its token cap; ${x.next}`),
              ...unreported
                .filter((x) => !x.stopped?.ok)
                .map(
                  (x) =>
                    `${x.dispatch}: ended with no report on its branch; send it the report request (report_request)`,
                ),
              ...dead.map(
                (x) =>
                  `${x.dispatch}: its process is gone with no report; hitld dispatch watch --act takes the next step for it`,
              ),
              ...(recorded.length && lastCompletion?.refill?.next
                ? [`then the refill: ${lastCompletion.refill.next}`]
                : []),
            ].join('; ') || 'nothing has completed: nothing to record',
        };
      }),
  },
];
