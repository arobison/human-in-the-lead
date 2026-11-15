// What is due, and why (design part 13.3). Recurring work does not run on the calendar. It runs
// on evidence of change, on the owner's presence, or on an idle machine, with a calendar ceiling
// only on how long the owner may hear nothing:
//
//   digest, report   enough merges, decisions or merged value since the last one; or the owner
//                    writes, or the machine is idle, with something to say; or the silence ceiling
//   baseline, eval   the integration branch moved, and the machine is idle
//   review           enough new outcomes of a person's calls since their last review
//
// Everything here is a pure function of the ledger, the trust record, the marks left by `hitld
// cadence done`, the machine's state and the clock, so the same inputs always give the same answer.
// It starts nothing: the chief of staff runs what it lists (design part 13.1).

/**
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {import('./state.mjs').CadenceState} CadenceState
 * @typedef {import('./state.mjs').JobMark} JobMark
 * @typedef {import('./idle.mjs').Idle} Idle
 *
 * @typedef {object} Counts what accumulated since a job last ran
 * @property {number} merges
 * @property {number} decisions decisions asked or answered, and calls logged
 * @property {number} merged_estimate_tokens the estimate tokens of the items merged
 *
 * @typedef {object} Entry one job, due now, held or waiting
 * @property {string} job digest, report, baseline, eval or review
 * @property {string} [person] for a review
 * @property {'threshold' | 'owner' | 'idle' | 'silence' | 'evidence' | null} trigger what made it due
 * @property {string[]} why every reason, in words
 * @property {Record<string, number | string | null>} counts
 * @property {string[]} run the `hitld` commands that do the job
 * @property {string[]} then what to do after, in order, ending with the mark
 * @property {string} [note]
 * @property {string} [hold_until] when quiet hours end, for a held job
 * @property {string} [waiting_for] for a job not due: what it is waiting for
 * @property {string | null} [ceiling_at] when the silence ceiling is reached
 *
 * @typedef {object} Context
 * @property {Record<string, any>} policy the effective policy
 * @property {LedgerEntry[]} events the ledger, oldest first
 * @property {Record<string, any>[]} trust the trust record, oldest first
 * @property {CadenceState} state
 * @property {Idle} idle
 * @property {boolean} ownerPresent the owner has just written in the chief of staff's session
 * @property {number} now
 * @property {{ active: boolean, until: string | null } | null} [quiet] quiet hours, when they hold messages
 */

const HOUR = 3_600_000;

/** The trust events that record how a call turned out (design part 23.4). */
export const OUTCOME_KINDS = Object.freeze([
  'overrule',
  'reversal',
  'merge-reverted',
  'worth-asking',
]);

/** The person an outcome belongs to when its event names none: the owner. */
const OWNER = 'owner';

/**
 * The ledger events after a mark: after the event it names, or when that event is not in the
 * ledger any more, those written after the mark's time; with no mark, all of them.
 * @param {LedgerEntry[]} events @param {JobMark | undefined} mark
 */
export function eventsSince(events, mark) {
  if (!mark) return events;
  if (typeof mark.through === 'string') {
    const at = events.findIndex((e) => e.id === mark.through);
    if (at >= 0) return events.slice(at + 1);
  }
  // The ledger was empty at the mark: everything in it is newer.
  if (mark.through === null) return events;
  return events.filter((e) => e.at > mark.at);
}

/**
 * What accumulated in `since` (the events after a mark). A correction is not a new event.
 * @param {LedgerEntry[]} all the whole ledger, for the size an item was dispatched at
 * @param {LedgerEntry[]} since
 * @returns {Counts}
 */
export function countChanges(all, since) {
  /** @type {Map<string, number>} */
  const byDispatch = new Map();
  /** @type {Map<string, number>} */
  const byItem = new Map();
  for (const e of all) {
    if (e.event !== 'dispatched' || typeof e.estimate_tokens !== 'number') continue;
    if (e.dispatch !== undefined) byDispatch.set(e.dispatch, e.estimate_tokens);
    if (e.item !== undefined && (e.role ?? 'executor') === 'executor') {
      byItem.set(e.item, e.estimate_tokens);
    }
  }
  let merges = 0;
  let logged = 0;
  let tokens = 0;
  /** @type {Set<string>} */
  const decisions = new Set();
  for (const e of since) {
    if (e.corrects !== undefined) continue;
    if (e.event === 'merged') {
      merges++;
      tokens +=
        (e.dispatch !== undefined ? byDispatch.get(e.dispatch) : undefined) ??
        (e.item !== undefined ? byItem.get(e.item) : undefined) ??
        0;
    } else if (e.event === 'asked' || e.event === 'answered') {
      if (e.decision !== undefined) decisions.add(e.decision);
    } else if (e.event === 'logged') {
      logged++;
    }
  }
  return { merges, decisions: decisions.size + logged, merged_estimate_tokens: tokens };
}

/**
 * New outcomes per person since each one's last review.
 * @param {Record<string, any>[]} trust the trust record, oldest first
 * @param {CadenceState} state
 * @returns {Map<string, number>} person to new outcomes, for every person with any or with a review
 */
export function outcomesByPerson(trust, state) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const key of Object.keys(state.jobs)) {
    if (key.startsWith('review:')) out.set(key.slice('review:'.length), 0);
  }
  trust.forEach((e, i) => {
    if (!OUTCOME_KINDS.includes(e.kind)) return;
    const person = typeof e.decider === 'string' && e.decider !== '' ? e.decider : OWNER;
    const seen = state.jobs[`review:${person}`]?.trust_through ?? 0;
    out.set(person, (out.get(person) ?? 0) + (i >= seen ? 1 : 0));
  });
  return out;
}

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Whether a run is active: the ledger's last lease event is not a release.
 * @param {LedgerEntry[]} events
 */
export function runActive(events) {
  const last = events.findLast((e) =>
    ['run-started', 'lease-taken', 'lease-released'].includes(e.event),
  );
  return last !== undefined && last.event !== 'lease-released';
}

/** The `then` list of a job: its marks, ending with `hitld cadence done`. @param {string} job @param {string} through @param {number} trustThrough @param {string[]} [before] */
const thenOf = (job, through, trustThrough, before = []) => [
  ...before,
  `hitld cadence done ${job} --through ${through} --trust-through ${trustThrough}`,
];

/**
 * Digests and reports: due on thresholds, on the owner's presence, on an idle machine, or on the
 * ceiling on silence.
 * @param {'digest' | 'report'} job
 * @param {Record<string, any>} cfg policy digests or reports
 * @param {Counts} c
 * @param {Context} ctx
 * @param {string | undefined} lastAt when the job last ran, or the ledger's first event
 */
function messaging(job, cfg, c, ctx, lastAt) {
  /** @type {string[]} */
  const why = [];
  /** @type {Entry['trigger']} */
  let trigger = null;
  /** @param {NonNullable<Entry['trigger']>} t @param {string} text */
  const add = (t, text) => {
    trigger ??= t;
    why.push(text);
  };
  const changes = c.merges + c.decisions;
  if (cfg.every_merges > 0 && c.merges >= cfg.every_merges) {
    add(
      'threshold',
      `${count(c.merges, 'merge')} since the last ${job} (threshold ${cfg.every_merges})`,
    );
  }
  if (cfg.every_decisions > 0 && c.decisions >= cfg.every_decisions) {
    add(
      'threshold',
      `${count(c.decisions, 'decision')} and logged calls since the last ${job} (threshold ${cfg.every_decisions})`,
    );
  }
  const valueMax = cfg.every_merged_estimate_tokens;
  if (valueMax > 0 && c.merged_estimate_tokens >= valueMax) {
    add(
      'threshold',
      `${c.merged_estimate_tokens} estimate tokens merged since the last ${job} (threshold ${valueMax})`,
    );
  }
  if (ctx.ownerPresent && cfg.when_owner_writes && changes >= cfg.min_changes) {
    add('owner', `the owner wrote, and ${count(changes, 'change')} wait to be reported`);
  }
  if (ctx.idle.idle && cfg.when_idle && changes >= cfg.min_changes) {
    add('idle', `the machine is idle, and ${count(changes, 'change')} wait to be reported`);
  }
  const ceilingAt = lastAt
    ? new Date(Date.parse(lastAt) + cfg.silence_max_hours * HOUR).toISOString()
    : null;
  if (
    ceilingAt !== null &&
    ctx.now >= Date.parse(ceilingAt) &&
    (changes > 0 || runActive(ctx.events))
  ) {
    add(
      'silence',
      `no ${job} for ${cfg.silence_max_hours} hours while a run is active or work changed (the ceiling)`,
    );
  }
  return { why, trigger, ceilingAt, changes };
}

/**
 * Baselines and evals: due when the branch has moved, on an idle machine.
 * @param {string} job
 * @param {number} threshold merges that count as something new to measure
 * @param {Counts} c
 * @param {Context} ctx
 */
function onIdleMachine(job, threshold, c, ctx) {
  if (c.merges < threshold) {
    return {
      due: false,
      waiting_for: `${count(threshold - c.merges, 'more merge')} (nothing new to measure)`,
    };
  }
  if (!ctx.idle.idle)
    return { due: false, waiting_for: `an idle machine: ${ctx.idle.reasons.join('; ')}` };
  return {
    due: true,
    why: [
      `${count(c.merges, 'merge')} since the last ${job} (threshold ${threshold}), and the machine is idle`,
    ],
  };
}

/**
 * Work out what is due.
 * @param {Context} ctx
 * @returns {{ due: Entry[], held: Entry[], waiting: Entry[], ceiling_at: string | null }}
 *   due: run now. held: due, but quiet hours hold it until they end. waiting: not due, with what it waits for.
 *   ceiling_at: the earliest time a silence ceiling is reached, for scheduling one wake.
 */
export function dueJobs(ctx) {
  const { policy, events, state } = ctx;
  const trustThrough = ctx.trust.length;
  /** @type {Entry[]} */
  const due = [];
  /** @type {Entry[]} */
  const held = [];
  /** @type {Entry[]} */
  const waiting = [];
  /** @type {string[]} */
  const ceilings = [];
  const quietNow = ctx.quiet?.active === true;

  /** @param {Entry} entry @param {boolean} reads whether it sends the owner something to read */
  const place = (entry, reads) => {
    if (reads && quietNow && !ctx.ownerPresent) {
      entry.hold_until = ctx.quiet?.until ?? undefined;
      held.push(entry);
    } else due.push(entry);
  };
  // The mark names the last event read, so a job that runs while the ledger grows misses nothing.
  const markArg = events.at(-1)?.id ?? 'none';

  for (const job of /** @type {const} */ (['digest', 'report'])) {
    const mark = state.jobs[job];
    const c = countChanges(events, eventsSince(events, mark));
    const cfg = policy[job === 'digest' ? 'digests' : 'reports'];
    const lastAt = mark?.at ?? events[0]?.at;
    const r = messaging(job, cfg, c, ctx, lastAt);
    if (r.ceilingAt) ceilings.push(r.ceilingAt);
    /** @type {Entry} */
    const entry = {
      job,
      trigger: r.trigger,
      why: r.why,
      counts: { ...c, since: mark?.at ?? null },
      run: job === 'digest' ? ['hitld rights digest', 'hitld ledger summary'] : ['hitld dashboard'],
      then: thenOf(job, markArg, trustThrough, [
        job === 'digest'
          ? 'send it to the owner, then hitld rights digest --mark'
          : 'send the report through the notification channel',
      ]),
      ceiling_at: r.ceilingAt,
    };
    if (r.why.length) place(entry, true);
    else {
      entry.waiting_for =
        'a threshold, the owner writing or an idle machine, with something to report';
      waiting.push(entry);
    }
  }

  for (const [job, section, cmd, note] of /** @type {const} */ ([
    [
      'baseline',
      'baselines',
      [],
      "run the project's benchmarks on the integration branch through the evidence source, holding the benchmark resource's lock and a quiet-machine hold",
    ],
    ['eval', 'eval', ['hitld eval --offline'], undefined],
  ])) {
    const mark = state.jobs[job];
    const c = countChanges(events, eventsSince(events, mark));
    const r = onIdleMachine(job, policy[section].every_merges, c, ctx);
    /** @type {Entry} */
    const entry = {
      job,
      trigger: r.due ? 'idle' : null,
      why: r.why ?? [],
      counts: { merges: c.merges, since: mark?.at ?? null },
      run: [...cmd],
      then: thenOf(job, markArg, trustThrough),
      ...(note ? { note } : {}),
    };
    if (r.due) due.push(entry);
    else {
      entry.waiting_for = r.waiting_for;
      waiting.push(entry);
    }
  }

  const review = policy.review;
  for (const [person, n] of [...outcomesByPerson(ctx.trust, state)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const first = state.jobs[`review:${person}`] === undefined;
    const need = first ? review.first_after_outcomes : review.every_outcomes;
    const mark = state.jobs[`review:${person}`];
    /** @type {Entry} */
    const entry = {
      job: 'review',
      person,
      trigger: n >= need ? 'evidence' : null,
      why:
        n >= need
          ? [
              `${count(n, 'new outcome')} of ${person}'s calls${first ? ', and no review yet' : ' since the last review'} (threshold ${need})`,
            ]
          : [],
      counts: { outcomes: n, since: mark?.at ?? null },
      run: [],
      then: [`hitld cadence done review --person ${person} --trust-through ${trustThrough}`],
      note: 'build the calibration review for this person alone (design part 23.4), shown only to them; it counts as a read against their attention budget',
    };
    if (n >= need) place(entry, true);
    else if (n > 0) {
      entry.waiting_for = `${count(need - n, 'more outcome')}`;
      waiting.push(entry);
    }
  }

  return { due, held, waiting, ceiling_at: ceilings.sort()[0] ?? null };
}
