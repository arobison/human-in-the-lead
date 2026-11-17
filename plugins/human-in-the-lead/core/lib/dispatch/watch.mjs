// The watchdog (design part 5.2): which in-flight dispatches have stalled, and the next step of the
// ladder for each. Pure: the caller passes the in-flight list, the ledger, each dispatch's progress
// signals, the policy, the time and the quota pause. No model reads anything here.
//
// A dispatch is stalled when nothing has progressed for its stall time, or it is past its
// start-to-finish deadline. Both are policy dispatch.stall_after and dispatch.deadline, scaled by
// tier (dispatch.stall_tier_scale) and by the dispatch's estimate against its tier's default.
//
// The ladder, per item, counted from its last report (a report ends a stall, whatever it says):
//
//   poke       ask the same agent to report its status
//   follow-up  interrupt it and continue it as a follow-up: the same agent, its commits kept
//   abandon    end it and dispatch the item afresh
//   ask        after dispatch.redispatch_max abandonments, a question for the owner instead
//
// Each step waits for the one before it to fail: dispatch.poke_wait after a poke, the new
// dispatch's own stall time after a follow-up. Progress after a step clears the steps since the
// last abandonment, so a dispatch that recovers starts again from a poke; a dispatch past its
// deadline is not cleared by progress. Not every dispatch can take every step: a headless run
// cannot be messaged while it runs, and an interactive session is continued through the chief of
// staff, so their ladders are shorter.
//
// A quota pause changes the picture. While dispatch is paused and the window has not reset, a
// quiet executor may simply have hit the limit: nothing climbs the ladder. Once the window has
// reset, a background agent that went quiet during the pause, and never progressed after the
// reset, was cut off by the limit: it is continued as a follow-up (reason limit), which is not a
// failure and does not count on the ladder.

import { lastProcess, progressTimes } from './progress.mjs';
import { startEstimate } from '../ledger/ledger.mjs';

/**
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {import('../ledger/inflight.mjs').InFlight} InFlight
 * @typedef {import('./progress.mjs').Signal} Signal
 * @typedef {import('../quota/pause.mjs').Pause} Pause
 * @typedef {'poke' | 'follow-up' | 'abandon' | 'ask'} Step
 * @typedef {'no_progress' | 'deadline' | 'limit' | 'exited'} StallReason
 *
 * @typedef {object} Verdict
 * @property {string} dispatch
 * @property {string} item
 * @property {number} tier
 * @property {string | null} mode headless or interactive for tier 3
 * @property {string | null} harness_ref
 * @property {string | null} model
 * @property {'progressing' | 'stalled' | 'overdue' | 'cut_off' | 'waiting_for_reset' | 'finished' | 'foreign'} state
 * @property {StallReason | null} reason
 * @property {Step | null} step the step due now, or null
 * @property {string | null} last_progress_at
 * @property {number} quiet_seconds
 * @property {number} stall_after_seconds
 * @property {string} deadline_at
 * @property {Step[]} steps_taken the ladder so far, since the item's last report
 * @property {string} why
 */

export const LADDER = /** @type {const} */ (['poke', 'follow-up', 'abandon']);

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();

/**
 * How long a dispatch may be quiet, and how long it may run, in seconds.
 * @param {number} tier @param {number | undefined} estimate its token estimate
 * @param {Record<string, any>} policy
 */
export function stallLimits(tier, estimate, policy) {
  const d = policy.dispatch ?? {};
  const t = String(Math.min(3, Math.max(1, tier)));
  const byTier = d.stall_tier_scale?.[t] ?? 1;
  const base = d.default_estimates?.[t];
  const byEstimate =
    base && typeof estimate === 'number' && estimate > 0
      ? Math.min(Math.max(estimate / base, 1), d.stall_estimate_max ?? 3)
      : 1;
  const scale = byTier * byEstimate;
  return {
    stall_after: Math.round((d.stall_after ?? 1800) * scale),
    deadline: Math.round((d.deadline ?? 14400) * scale),
    poke_wait: d.poke_wait ?? 600,
    scale,
  };
}

/**
 * The steps a dispatch can take. A poke needs a way to message the running agent (not a headless
 * run); a follow-up needs the agent to continue (a background agent); every dispatch can be
 * abandoned.
 * @param {InFlight} entry @returns {Step[]}
 */
export function rungsFor(entry) {
  if (!entry.harness_ref) return ['abandon'];
  if (entry.mode === 'headless') return ['abandon'];
  if (entry.mode === 'interactive') return ['poke', 'abandon'];
  return [...LADDER];
}

/**
 * Judge every in-flight dispatch.
 * @param {{
 *   inFlight: InFlight[],
 *   events: LedgerEntry[],
 *   signals: (entry: InFlight) => Signal[],
 *   policy: Record<string, any>,
 *   now: number,
 *   host?: string,
 *   pause?: Pause | null,
 *   timedPause?: Pause | null,
 * }} r
 *   pause: the pause in force; timedPause: the latest pause that named its reset
 * @returns {Verdict[]}
 */
export function watchDispatches(r) {
  const maxRedispatch = r.policy.dispatch?.redispatch_max ?? 1;
  return r.inFlight.map((entry) => {
    const dispatched = r.events.find(
      (e) => e.event === 'dispatched' && e.dispatch === entry.dispatch,
    );
    const tier = entry.tier ?? dispatched?.tier ?? 1;
    // A follow-up carries no estimate of its own: the item's last one stands. Read capped, and
    // corrected where a correction stands, so a poisoned figure cannot lengthen the limits.
    const estimate = startEstimate(r.events, entry.dispatch, entry.item, r.policy.dispatch);
    const limits = stallLimits(tier, estimate, r.policy);
    const started = Date.parse(entry.started_at);
    const signals = r.signals(entry);
    const times = progressTimes(signals);
    const lastSignal = times.length ? Math.max(...times) : null;
    // A session continued after a usage limit (a poke, for an interactive one) starts its clock
    // again from then.
    const continued = r.events.findLast(
      (e) => e.event === 'stalled' && e.dispatch === entry.dispatch && e.reason === 'limit',
    );
    const lastProgress = Math.max(
      started,
      lastSignal ?? started,
      continued ? Date.parse(continued.at) : started,
    );
    const quiet = Math.max(0, Math.round((r.now - lastProgress) / 1000));
    const deadlineAt = started + limits.deadline * 1000;
    const overdue = r.now >= deadlineAt;

    const itemEvents = r.events.filter((e) => e.item === entry.item);
    const sinceReport = itemEvents.slice(
      itemEvents.findLastIndex((e) => e.event === 'reported') + 1,
    );
    const steps = sinceReport.filter((e) => e.event === 'stalled' && e.reason !== 'limit');

    /** @param {Verdict['state']} state @param {Partial<Verdict>} [more] @returns {Verdict} */
    const verdict = (state, more = {}) => ({
      dispatch: entry.dispatch,
      item: entry.item,
      tier,
      mode: entry.mode ?? null,
      harness_ref: entry.harness_ref,
      model: dispatched?.model ?? null,
      state,
      reason: null,
      step: null,
      last_progress_at: lastSignal === null ? null : iso(lastSignal),
      quiet_seconds: quiet,
      stall_after_seconds: limits.stall_after,
      deadline_at: iso(deadlineAt),
      steps_taken: steps.map((s) => /** @type {Step} */ (s.step)),
      why: '',
      ...more,
    });

    if (r.host && entry.host && entry.host !== r.host) {
      return verdict('foreign', {
        why: `it runs on ${entry.host}: the watchdog there judges it`,
      });
    }
    const proc = entry.mode === 'headless' ? lastProcess(signals) : null;
    if (proc && proc.alive === false && (proc.output_bytes ?? 0) > 0) {
      return verdict('finished', {
        why: 'its process has ended and written its result: record its completion',
      });
    }
    const exited = Boolean(proc && proc.alive === false);
    const quietTooLong = quiet >= limits.stall_after || exited;

    // Paused at the quota gate, before the reset: a quiet executor may have hit the limit too.
    const pausedNow =
      r.pause && (r.pause.resets_at === null || r.now < Date.parse(r.pause.resets_at));
    if (pausedNow && (quietTooLong || overdue)) {
      return verdict('waiting_for_reset', {
        why: `dispatch is paused at ${r.pause?.limit}${r.pause?.resets_at ? ` until ${r.pause.resets_at}` : ''}; a quiet executor may have hit the limit, so the ladder waits for the reset`,
      });
    }

    // After a reset: a background or interactive agent that went quiet during the pause and has not
    // progressed since the reset was cut off by the limit. Continue it; this is not a failure.
    const timed = r.timedPause;
    if (timed?.resets_at && entry.harness_ref && entry.mode !== 'headless') {
      const reset = Date.parse(timed.resets_at);
      const pausedAt = Date.parse(timed.at);
      const handled = r.events.some(
        (e) =>
          e.event === 'stalled' &&
          e.dispatch === entry.dispatch &&
          e.reason === 'limit' &&
          Date.parse(e.at) >= pausedAt,
      );
      if (
        !handled &&
        r.now >= reset &&
        lastProgress < reset &&
        quiet >= limits.poke_wait &&
        pausedAt - lastProgress < limits.stall_after * 1000
      ) {
        return verdict('cut_off', {
          reason: 'limit',
          step: entry.mode === 'interactive' ? 'poke' : 'follow-up',
          why: `quiet since ${iso(lastProgress)}, across the pause at ${timed.limit}, which reset at ${timed.resets_at}: a usage limit cut it off; continue it`,
        });
      }
    }

    const abandons = steps.filter((s) => s.step === 'abandon').length;
    let segment = steps.slice(
      steps.findLastIndex((s) => s.step === 'abandon' || s.step === 'ask') + 1,
    );
    const lastStepAt = segment.length ? Date.parse(segment[segment.length - 1].at) : null;
    // Progress after the last step: it recovered, so the steps since the last abandonment are spent.
    if (lastStepAt !== null && !overdue && lastSignal !== null && lastSignal > lastStepAt) {
      segment = [];
    }
    /** @type {StallReason} */
    const reason = exited ? 'exited' : overdue ? 'deadline' : 'no_progress';
    let due;
    if (!segment.length) {
      due = overdue || quietTooLong;
    } else {
      const last = segment[segment.length - 1];
      const from = overdue
        ? /** @type {number} */ (lastStepAt)
        : Math.max(/** @type {number} */ (lastStepAt), lastProgress);
      const wait = last.step === 'poke' ? limits.poke_wait : limits.stall_after;
      due = exited || (r.now - from) / 1000 >= wait;
    }
    if (!due) {
      return verdict('progressing', {
        why: segment.length
          ? `${segment[segment.length - 1].step} sent; waiting to see whether it worked`
          : `quiet for ${quiet}s of ${limits.stall_after}s; deadline ${iso(deadlineAt)}`,
      });
    }
    const rungs = rungsFor(entry);
    /** @type {Step} */
    let step = rungs[Math.min(segment.length, rungs.length - 1)];
    // A step not open to this dispatch (it took one of a longer ladder before) moves to the next.
    if (segment.length >= rungs.length) step = 'abandon';
    if (step === 'abandon' && abandons >= maxRedispatch) step = 'ask';
    return verdict(overdue ? 'overdue' : 'stalled', {
      reason,
      step,
      why:
        reason === 'deadline'
          ? `past its deadline of ${iso(deadlineAt)}`
          : reason === 'exited'
            ? 'its process ended without a result'
            : `no progress for ${quiet}s (its stall time is ${limits.stall_after}s)${segment.length ? ` since the ${segment[segment.length - 1].step}` : ''}`,
    });
  });
}

/** The ladder steps due now. @param {Verdict[]} verdicts */
export const dueSteps = (verdicts) => verdicts.filter((v) => v.step !== null);

/** The message that pokes an agent. @param {string} dispatch */
export const pokeMessage = (dispatch) =>
  `Status check for ${dispatch}: the watchdog has seen no progress from you for a while. If you are working, say in one line what you are doing, then carry on. If you are stuck or waiting on something, stop and end with your report in the fixed shape (result: partial or blocked), naming what stopped you.`;

/** The message that continues an interrupted agent. @param {string} reason */
export const continueMessage = (reason) =>
  reason === 'limit'
    ? 'You were cut off by a usage limit, which has now reset. Continue the item from where you stopped: your commits are kept. End with your report in the fixed shape.'
    : 'You were stopped because no progress was seen for a long time. Continue the item from your last commit, which is kept. If something blocks you, end now with your report in the fixed shape (result: partial or blocked), naming it.';

/**
 * The question for the owner when an item keeps stalling (schemas/question.schema.json, less the
 * fields hitld rights ask fills in).
 * Holding the item is easy to undo, so it is also the default if no one answers in a day.
 * @param {Verdict} v @param {Record<string, any>} policy @param {number} now ms
 * @param {{ areas?: string[], parent?: string | null, touches?: string[] }} [about]
 */
export function stallQuestion(v, policy, now, about = {}) {
  const abandoned = policy.dispatch?.redispatch_max ?? 1;
  return {
    title: `${v.item} keeps stalling`,
    question: `${v.item} stalled again after being dispatched afresh ${abandoned} ${abandoned === 1 ? 'time' : 'times'}: hold it, raise its tier, or split it?`,
    context: `The watchdog poked it, continued it as a follow-up and dispatched it afresh, and each time it went quiet without reporting. The last dispatch, ${v.dispatch} (tier ${v.tier}), stalled too: ${v.why}. Its dispatches are ended; its branch is kept.`,
    options: [
      {
        label: 'hold',
        what_happens: `${v.item} waits until someone looks at why it stalls; nothing more is spent on it.`,
        reversible: true,
      },
      {
        label: 'raise the tier',
        what_happens: `${v.item} is dispatched once more, a tier higher (tier_override on the item).`,
        reversible: true,
      },
      {
        label: 'split it',
        what_happens: `${v.item} is split into smaller items, each dispatched on its own.`,
        reversible: true,
      },
    ],
    recommendation: {
      option: 'hold',
      why: 'An item that stalls at every step usually lacks something the brief cannot give; spending more before someone looks is likely waste.',
    },
    reversibility: 'two-way',
    default_if_unanswered: { option: 'hold', deadline: iso(now + 24 * 3_600_000) },
    blocks: [v.item],
    ...(about.touches?.length ? { paths: about.touches } : {}),
    ...(about.areas?.length ? { areas: about.areas } : {}),
    ...(about.parent ? { parent: about.parent } : {}),
  };
}
