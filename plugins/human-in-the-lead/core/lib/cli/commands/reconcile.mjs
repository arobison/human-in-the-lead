// `hitld dispatch reconcile` (HITLD-779, HITLD-780): the stateless pass any orchestrator turn runs
// to record the completions it observes. It reads the in-flight dispatches, each one's branch head
// and what its harness shows, and records each that is complete through `dispatch complete`: the
// report from the executor's closing commit, the tokens from the harness's record. Everything else
// is shown with its evidence; nothing here stops an executor. The judgment is
// core/lib/dispatch/reconcile.mjs.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { readLedger } from '../../ledger/ledger.mjs';
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

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'dispatch reconcile',
    summary:
      "Record the completions that can be observed: each in-flight dispatch whose branch head is its closing commit with a report, and whose executor the harness shows ended, is completed once, with the harness record's tokens. The rest are shown with their evidence (unreported, dead, closing, running); nothing stops an executor. Idempotent: run it at every turn",
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
          "An ended executor's harness record, as D-<n>=<file>: an interactive session's result events (list_events of kind result) saved to a file, or a background agent's completion notice. The recorded tokens are read from it",
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
            // that was stopped: gone.
            return {
              ended: Boolean(proc && !proc.alive && proc.result),
              gone: Boolean(proc && !proc.alive && !proc.result),
              evidence: {
                ...progress,
                process: proc
                  ? { alive: proc.alive, output_bytes: proc.output_bytes, result: proc.result }
                  : 'no process ID on file',
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
          dispatches.push(shown);
        }

        const of = (/** @type {string} */ s) => dispatches.filter((x) => x.state === s);
        const recorded = dispatches.filter((x) => x.recorded);
        const unreported = of('unreported');
        const dead = of('dead');
        const awaiting = of('awaiting_record');
        return {
          ok: true,
          at: new Date(now).toISOString(),
          holds_lease: holds,
          ...(fetched ? { fetched_from: remote } : {}),
          dispatches,
          recorded: recorded.map((x) => x.dispatch),
          ...(lastCompletion?.refill ? { refill: lastCompletion.refill } : {}),
          ...(lastCompletion?.handover ? { handover: lastCompletion.handover } : {}),
          next:
            [
              ...recorded.map((x) => `${x.dispatch}: recorded; do what its completion's next says`),
              ...awaiting.map((x) => `${x.dispatch}: ${x.next}`),
              ...unreported.map(
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
