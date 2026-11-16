// The watchdog's commands (design parts 5.2 and 12.5). `hitld dispatch watch` is a script, not a
// model: the chief of staff runs it on its schedule, and it says which dispatches have stalled,
// the step of the ladder each needs, and whether a quota pause is due to lift. The session that
// holds the lease runs it with --act to record those steps and get what to do for each.
// `hitld dispatch progress` records a progress signal from a harness that reports one.
//
// The core decides; the harness acts. Each action says what to do (poke the agent, stop it and
// continue it, stop it and re-plan, ask the owner); the skills say which harness tool does it.

import { join } from 'node:path';
import { readLedger, lifecycleId } from '../../ledger/ledger.mjs';
import { absorb } from '../../run/state.mjs';
import { gitSnapshot, processSignal, worktreeSignal } from '../../run/reality.mjs';
import { isNews, readProgress, recordProgress } from '../../dispatch/progress.mjs';
import {
  continueMessage,
  dueSteps,
  pokeMessage,
  stallQuestion,
  watchDispatches,
} from '../../dispatch/watch.mjs';
import { areasTouched } from '../../dispatch/item.mjs';
import { activePause, lastTimedPause, pauseGate, resumeDue } from '../../quota/pause.mjs';
import { releaseExecutor } from '../../registry/machine.mjs';
import {
  Refusal,
  commands as orchestratorCommands,
  guarded,
  identityOf,
  nowOf,
  notePause,
  pidKey,
  plan,
  planWithPause,
  project,
  readyQueue,
  resultKey,
  runOf,
} from './orchestrator.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../../dispatch/watch.mjs').Verdict} Verdict
 * @typedef {import('../../ledger/inflight.mjs').InFlight} InFlight
 */

/** @type {import('../args.mjs').ArgSpec} */
const SESSION = {
  name: 'session',
  type: 'string',
  description:
    "This session's ID. Default: $HITLD_SESSION, else the harness's session ID, else the one run start recorded for this worktree",
};
/** @type {import('../args.mjs').ArgSpec} */
const HOST = {
  name: 'host',
  type: 'string',
  description:
    "The machine. Default: the host run start or run resume recorded for this session, else this machine's host name",
};

/** A verdict as the watch prints it. @param {Verdict} v */
const shown = (v) => ({
  dispatch: v.dispatch,
  item: v.item,
  tier: v.tier,
  state: v.state,
  reason: v.reason,
  step: v.step,
  last_progress_at: v.last_progress_at,
  quiet_seconds: v.quiet_seconds,
  stall_after_seconds: v.stall_after_seconds,
  deadline_at: v.deadline_at,
  steps_taken: v.steps_taken,
  why: v.why,
});

/**
 * Sample what can be seen of each executor on this machine without asking it, and record what is
 * new: its branch and worktree, and a headless run's process and output.
 * @param {ReturnType<typeof project>} p @param {InFlight[]} inFlight @param {string} host
 * @param {Ctx} ctx
 */
function sample(p, inFlight, host, ctx) {
  const mainBranch = p.policy.merge?.main_branch ?? 'main';
  // One look at git for every dispatch this tick, made only when one is sampled here.
  /** @type {import('../../run/reality.mjs').GitSnapshot | null} */
  let snap = null;
  const snapshot = () => (snap ??= gitSnapshot({ cwd: p.repoRoot, mainBranch }));
  for (const entry of inFlight) {
    if (entry.host && entry.host !== host) continue;
    const signals = [
      worktreeSignal(entry, { cwd: p.repoRoot, mainBranch, snapshot: snapshot() }),
      entry.mode === 'headless'
        ? processSignal({
            pidFile: join(p.store.root, pidKey(entry.dispatch)),
            outputFile: join(p.store.root, resultKey(entry.dispatch)),
          })
        : null,
    ];
    for (const s of signals) {
      if (!s) continue;
      const signal = { ...s, dispatch: entry.dispatch };
      if (isNews(readProgress(p.store, entry), signal)) {
        recordProgress(p.store, signal, { now: () => new Date(nowOf(ctx)) });
      }
    }
  }
}

/** @param {string} pidFile @param {ReturnType<typeof project>} p */
function pidOf(pidFile, p) {
  const text = p.store.read(pidFile);
  const n = Number(text?.trim());
  return Number.isInteger(n) && n > 1 ? n : null;
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'dispatch watch',
    summary:
      'The watchdog: which dispatches have stalled and the next step of the ladder for each, and whether a quota pause is due to lift. A script, no model; with --act, the session holding the lease records the steps',
    built_by: 'h',
    args: [
      {
        name: 'act',
        type: 'boolean',
        description:
          'Record the steps that are due and print what to do for each (poke, continue as a follow-up, abandon and re-plan, ask the owner). Only the session holding the lease; without it the command reads and samples only',
      },
      SESSION,
      HOST,
    ],
    run: (input, ctx) =>
      guarded(async () => {
        const p = project(ctx);
        if (!p.state) {
          return {
            ok: false,
            error: 'no-run',
            message: 'no run has started: nothing to watch',
          };
        }
        const { host } = identityOf(p, input, ctx);
        const now = nowOf(ctx);
        // The ledger may hold events the run state has not absorbed yet: read them, change nothing.
        const before = readLedger(p.store).events;
        const state = absorb(structuredClone(p.state), before).state;
        sample(p, state.in_flight, host, ctx);

        const judge = () => {
          const events = readLedger(p.store).events;
          const active = activePause(events);
          return {
            events,
            active,
            verdicts: watchDispatches({
              inFlight: state.in_flight,
              events,
              signals: (e) => readProgress(p.store, e),
              policy: p.policy,
              now,
              host,
              pause: active,
              timedPause: lastTimedPause(events),
            }),
          };
        };
        const { active, verdicts } = judge();
        const gate = pauseGate({
          policy: p.policy,
          store: p.store,
          machineRoot: p.machineRoot,
          person: p.person,
          state,
          now,
        });
        const resume = resumeDue(active, gate, now);
        const due = dueSteps(verdicts);
        const paused = active
          ? { limit: active.limit, resets_at: active.resets_at, since: active.at }
          : null;

        if (input.act !== true) {
          const parts = [
            ...due.map(
              (v) => `${v.dispatch} ${v.state === 'cut_off' ? 'cut off' : 'stalled'} (${v.step})`,
            ),
            ...(resume.due ? ['dispatch may resume'] : []),
          ];
          return {
            ok: true,
            at: new Date(now).toISOString(),
            dispatches: verdicts.map(shown),
            due: due.map((v) => ({
              dispatch: v.dispatch,
              item: v.item,
              step: v.step,
              reason: v.reason,
            })),
            paused,
            resume,
            wake: parts.length > 0,
            wake_message: parts.length ? `watch: ${parts.join('; ')}` : null,
            next: parts.length
              ? `wake the session holding the lease (hitld run status names wake_to) with wake_message; it runs hitld dispatch watch --act`
              : 'nothing is due: no wake needed',
          };
        }

        const run = runOf(p, input, ctx);
        const q = readyQueue(p, ctx);
        /** @type {Record<string, unknown>[]} */
        const actions = [];
        for (const v of due) {
          const entry = /** @type {InFlight} */ (
            state.in_flight.find((/** @type {InFlight} */ d) => d.dispatch === v.dispatch)
          );
          const item = q.byId.get(v.item);
          const areas = item ? areasTouched(item, p.policy) : [];
          run.record({
            event: 'stalled',
            dispatch: v.dispatch,
            item: v.item,
            reason: /** @type {string} */ (v.reason),
            step: /** @type {string} */ (v.step),
            tier: v.tier,
            ...(v.model ? { model: v.model } : {}),
            ...(areas[0] ? { area: areas[0] } : {}),
            notes: v.why.length > 300 ? `${v.why.slice(0, 299)}…` : v.why,
          });
          const pid = entry.mode === 'headless' ? pidOf(pidKey(entry.dispatch), p) : null;
          const stop = {
            harness_ref: entry.harness_ref,
            mode: entry.mode ?? null,
            ...(pid ? { pid } : {}),
          };
          if (v.step === 'poke') {
            run.record({ event: 'poked', dispatch: v.dispatch, item: v.item });
            actions.push({
              step: 'poke',
              dispatch: v.dispatch,
              item: v.item,
              reason: v.reason,
              to: stop,
              via: entry.mode === 'interactive' ? 'chief_of_staff' : 'agent',
              message: v.reason === 'limit' ? continueMessage('limit') : pokeMessage(v.dispatch),
              then: 'send the message to the agent; nothing to record. Its progress, or its report, ends the stall',
            });
            continue;
          }
          // The other steps end this dispatch: it no longer counts against the machine's maximum.
          releaseExecutor(p.machineRoot, p.policy.project.id, v.dispatch);
          if (v.step === 'follow-up') {
            run.record({
              id: lifecycleId('interrupted', v.dispatch),
              event: 'interrupted',
              dispatch: v.dispatch,
              item: v.item,
              notes:
                v.reason === 'limit'
                  ? 'cut off by a usage limit; continued as a follow-up after the reset'
                  : 'stalled after a poke; continued as a follow-up with its commits kept',
            });
            const followUp = /** @type {import('../table.mjs').Command} */ (
              orchestratorCommands.find((c) => c.name === 'dispatch follow-up')
            );
            const continued = /** @type {Record<string, any>} */ (
              await /** @type {NonNullable<typeof followUp.run>} */ (followUp.run)(
                {
                  dispatch: v.dispatch,
                  message: continueMessage(/** @type {string} */ (v.reason)),
                  ...(input.session ? { session: input.session } : {}),
                  ...(input.host ? { host: input.host } : {}),
                },
                ctx,
              )
            );
            actions.push({
              step: 'follow-up',
              dispatch: v.dispatch,
              item: v.item,
              reason: v.reason,
              stop,
              ...(continued.ok
                ? {
                    continues_as: continued.dispatch,
                    instruction: continued.instruction,
                    then: `stop the agent first (its current turn), then make the instruction call; its completion goes to hitld dispatch complete --dispatch ${continued.dispatch}`,
                  }
                : {
                    error: continued.error,
                    message: continued.message,
                    then: `it could not be continued: hitld dispatch plan re-plans ${v.item}`,
                  }),
            });
            continue;
          }
          run.record({
            id: lifecycleId('abandoned', v.dispatch),
            event: 'abandoned',
            dispatch: v.dispatch,
            item: v.item,
            notes: `the watchdog abandoned it: ${v.why}`.slice(0, 300),
          });
          run.record({
            id: lifecycleId('unclaimed', v.dispatch),
            event: 'unclaimed',
            item: v.item,
            notes: `after abandoning ${v.dispatch}`,
          });
          if (v.step === 'abandon') {
            actions.push({
              step: 'abandon',
              dispatch: v.dispatch,
              item: v.item,
              reason: v.reason,
              stop,
              then: `stop the agent if it still runs; ${v.item} is ready again and the refill below dispatches it afresh`,
            });
          } else {
            const question = stallQuestion(v, p.policy, now, {
              areas,
              touches: /** @type {string[]} */ (item?.touches ?? []),
              parent: /** @type {string | undefined} */ (item?.parent) ?? null,
            });
            actions.push({
              step: 'ask',
              dispatch: v.dispatch,
              item: v.item,
              reason: v.reason,
              stop,
              question,
              then: `stop the agent if it still runs; hitld rights ask --question '<question as JSON>' and add the decision to ${v.item}'s needs, so it is not dispatched again until the owner answers. hitld rights pending says when it goes to the owner`,
            });
          }
        }
        // The pause, from the gate now: recorded as it starts and as it lifts.
        const fresh = project(ctx);
        const pause = notePause(fresh, ctx, run);
        const refill = planWithPause(plan(fresh, ctx), pause);
        return {
          ok: true,
          at: new Date(now).toISOString(),
          actions,
          paused: pause.paused,
          ...(pause.resumed ? { resumed: pause.resumed } : {}),
          refill,
          next: actions.length
            ? 'for each action: do what its then says, with the harness tools the orchestrate skill names; then start the refill'
            : refill.next,
        };
      }),
  },
  {
    name: 'dispatch progress',
    summary:
      'Record a progress signal for a running dispatch, from a harness that reports one (tool calls, tokens so far): the watchdog reads it',
    built_by: 'h',
    args: [
      { name: 'dispatch', type: 'string', description: 'The dispatch ID, such as D-12' },
      {
        name: 'harness-ref',
        type: 'string',
        description: "The agent's harness reference, when the dispatch is not known",
      },
      { name: 'tool-calls', type: 'integer', description: 'Tool calls this signal stands for' },
      { name: 'tokens', type: 'integer', description: 'Tokens used so far' },
      { name: 'tool', type: 'string', description: 'The tool called, as the harness names it' },
    ],
    run: (input, ctx) =>
      guarded(() => {
        const dispatch = /** @type {string | undefined} */ (input.dispatch);
        const ref = /** @type {string | undefined} */ (input['harness-ref']);
        if (!dispatch && !ref) throw new Refusal('usage', 'give --dispatch or --harness-ref');
        const p = project(ctx);
        const signal = recordProgress(
          p.store,
          {
            source: 'harness',
            ...(dispatch ? { dispatch } : { harness_ref: ref }),
            tool_calls: /** @type {number | undefined} */ (input['tool-calls']) ?? 1,
            ...(typeof input.tokens === 'number' ? { tokens: input.tokens } : {}),
            ...(typeof input.tool === 'string' ? { tool: input.tool } : {}),
          },
          { now: () => new Date(nowOf(ctx)) },
        );
        return { ok: true, recorded: signal };
      }),
  },
];
