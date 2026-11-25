// Whether an open question goes to its decider now, in the next digest, waits, or takes its
// default (design part 2, "The owner's attention as a budget"; part 5.5; part 23.5). It decides the
// way the quota gate decides for tokens (core/lib/quota/gate.mjs): from the settings and the
// readings, in order, and every answer carries its reason.
//
// Per question, in order of cost of delay (most costly first), so the budget goes to what waiting
// costs most:
//
//   1. its default is due           -> default: no answer by its deadline; it takes the default.
//   2. it is urgent: it blocks the critical path, or leaves executor slots idle
//        quiet hours                -> hold until they end (only a sev-1 breaks them)
//        no interrupt left today    -> digest
//        otherwise                  -> now, using one interrupt
//   3. it is not urgent
//        the person answers quickly, allows non-urgent at once, and no quiet hours, and an
//        interrupt is left          -> now
//        a place in the digest is left -> digest
//        the digest is full, it is easy to undo (a two-way door) -> default: it takes its
//                                      default, else the recommendation, logged and listed in
//                                      the next digest
//        otherwise                  -> hold: a call that is hard to undo always waits for the owner
//
// A question already shown to its decider and not yet answered is in front of them: it uses a place
// in the digest, and it is listed apart. Only its default can still act on it.

/**
 * @typedef {import('../settings/attention.mjs').AttentionSettings} AttentionSettings
 *
 * @typedef {object} Candidate an open decision, with what the gate needs
 * @property {string} id
 * @property {string} title
 * @property {string | null} asked_at
 * @property {string | null} sent_at when it was first shown to its decider
 * @property {'two-way' | 'one-way' | null} reversibility
 * @property {{ option: string, deadline: string } | null} default_if_unanswered
 * @property {string | null} recommended the recommended option, as the question names it
 * @property {string[]} blocks
 * @property {string[]} unblocks_ready
 * @property {boolean} critical_path
 * @property {number} cost_of_delay
 *
 * @typedef {object} Readings what the settings are measured against
 * @property {number} now ms since the epoch
 * @property {AttentionSettings} attention the effective settings
 * @property {{ cap: number, in_flight: number, ready: number }} slots executor slots and the
 *   ready work waiting for one
 * @property {number} interruptsUsed questions sent at once in the last 24 hours
 * @property {number} nonUrgentSent questions sent at once and still unanswered
 * @property {string | null} lastAnsweredAt when the person last answered a question themselves
 *
 * @typedef {'now' | 'digest' | 'hold' | 'default'} Delivery
 *
 * @typedef {object} Delivered one open question and where it goes
 * @property {string} decision
 * @property {string} title
 * @property {number} cost_of_delay
 * @property {boolean} critical_path
 * @property {string[]} blocks
 * @property {'two-way' | 'one-way' | null} reversibility
 * @property {Delivery} deliver
 * @property {string} reason
 * @property {string | null} [hold_until] for a hold through quiet hours: when they end
 * @property {{ option: string, deadline: string | null, source: 'default_if_unanswered' | 'recommendation' }} [default]
 *   for a default: the option it takes, and why it may
 *
 * @typedef {object} Waiting a question already shown to its decider and not yet answered
 * @property {string} decision
 * @property {string} title
 * @property {string} sent_at
 * @property {number} waiting_minutes
 * @property {number} cost_of_delay
 * @property {boolean} critical_path
 * @property {string} [default_deadline]
 * @property {string} [note]
 *
 * @typedef {object} Budget the attention budget, and what is left of it
 * @property {{ limit: number, in_front: number, left: number }} decisions_per_digest
 * @property {{ limit: number, used: number, left: number }} interrupts_per_day
 * @property {{ limit: number, in_front: number, left: number }} non_urgent_at_once
 * @property {boolean} answering_quickly
 * @property {string | null} last_answered_at
 * @property {{ active: boolean, until: string | null, windows: { from: string, to: string }[], timezone: string }} quiet_hours
 * @property {{ cap: number, in_flight: number, ready: number, idle: number }} slots
 *
 * @typedef {{ budget: Budget, decisions: Delivered[], waiting: Waiting[] }} GateResult
 */

export const DELIVERIES = /** @type {const} */ (['now', 'digest', 'hold', 'default']);

/** @param {string} hhmm @returns {number} minutes after midnight */
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The time of day in a zone: minutes after midnight, and how far into the minute.
 * @param {number} ms @param {string} timezone
 */
function clockIn(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const n = (/** @type {string} */ type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some runtimes write midnight as 24.
  return { minutes: (n('hour') % 24) * 60 + n('minute'), seconds: n('second') };
}

/**
 * @param {number} m minutes after midnight
 * @param {{ from: string, to: string }} w
 */
function inWindow(m, w) {
  const from = minutesOf(w.from);
  const to = minutesOf(w.to);
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/**
 * Whether quiet hours hold questions at `ms`, and when they next end.
 * @param {number} ms
 * @param {{ from: string, to: string }[]} windows @param {string} timezone
 * @returns {{ active: boolean, until: string | null, until_local: string | null }}
 */
export function quietState(ms, windows, timezone) {
  let t = ms;
  let active = false;
  // Windows may touch or overlap: follow them until none holds.
  for (let step = 0; step <= windows.length; step++) {
    const { minutes, seconds } = clockIn(t, timezone);
    const hit = windows.find((w) => inWindow(minutes, w));
    if (!hit) break;
    active = true;
    const to = minutesOf(hit.to);
    const ahead = (to - minutes + 1440) % 1440 || 1440;
    t = t + ahead * 60_000 - seconds * 1000;
  }
  if (!active) return { active: false, until: null, until_local: null };
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t));
  return { active: true, until: new Date(t).toISOString(), until_local: local };
}

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Settle every open question's delivery.
 * @param {Candidate[]} candidates the open decisions
 * @param {Readings} r
 * @returns {GateResult}
 */
export function deliveryGate(candidates, r) {
  const a = r.attention;
  const quiet = quietState(r.now, a.quiet_hours, a.timezone);
  const answeredAgo = r.lastAnsweredAt === null ? null : r.now - Date.parse(r.lastAnsweredAt);
  const answeringQuickly =
    answeredAgo !== null && answeredAgo >= 0 && answeredAgo <= a.answering_window_minutes * 60_000;
  const idle = Math.max(0, r.slots.cap - r.slots.in_flight - r.slots.ready);

  const inFront = candidates.filter((c) => c.sent_at !== null);
  const ordered = [...candidates].sort(
    (x, y) =>
      y.cost_of_delay - x.cost_of_delay ||
      String(x.asked_at ?? '').localeCompare(String(y.asked_at ?? '')) ||
      x.id.localeCompare(y.id),
  );

  let interruptsLeft = Math.max(0, a.interrupts_per_day - r.interruptsUsed);
  let digestRoom = Math.max(0, a.decisions_per_digest - inFront.length);
  let atOnceLeft = Math.max(0, a.non_urgent_at_once - r.nonUrgentSent);
  let idleLeft = idle;

  /** @type {Delivered[]} */
  const decisions = [];
  /** @type {Waiting[]} */
  const waiting = [];
  for (const c of ordered) {
    const base = {
      decision: c.id,
      title: c.title,
      cost_of_delay: c.cost_of_delay,
      critical_path: c.critical_path,
      blocks: c.blocks,
      reversibility: c.reversibility,
    };
    const easyToUndo = c.reversibility === 'two-way';
    // 1. A default whose deadline has passed is applied, whether or not the question was shown.
    const due =
      c.default_if_unanswered && Date.parse(c.default_if_unanswered.deadline) <= r.now
        ? c.default_if_unanswered
        : null;
    if (due && easyToUndo) {
      decisions.push({
        ...base,
        deliver: 'default',
        reason: `its default is due: no answer by ${due.deadline}, so it takes ${due.option}, logged and listed in the next digest`,
        default: { option: due.option, deadline: due.deadline, source: 'default_if_unanswered' },
      });
      continue;
    }
    const ignored =
      due && !easyToUndo
        ? '; its default is not applied, because a call that is hard to undo always waits for the owner'
        : '';
    if (c.sent_at !== null) {
      waiting.push({
        decision: c.id,
        title: c.title,
        sent_at: c.sent_at,
        waiting_minutes: Math.max(0, Math.round((r.now - Date.parse(c.sent_at)) / 60_000)),
        cost_of_delay: c.cost_of_delay,
        critical_path: c.critical_path,
        ...(c.default_if_unanswered && easyToUndo
          ? { default_deadline: c.default_if_unanswered.deadline }
          : {}),
        ...(ignored ? { note: ignored.slice(2) } : {}),
      });
      continue;
    }
    // 2. Urgent: it blocks the critical path, or answering it fills slots that would idle.
    const fills = Math.min(idleLeft, c.unblocks_ready.length);
    idleLeft -= fills;
    const why = c.critical_path
      ? `it blocks the critical path (${count(c.blocks.length, 'item', 'items')}, cost of delay ${Number(c.cost_of_delay).toLocaleString('en-US')} estimated tokens)`
      : fills > 0
        ? `no ready work is left for ${count(idle, 'idle slot', 'idle slots')}, and answering it makes ${count(c.unblocks_ready.length, 'item', 'items')} ready`
        : null;
    if (why !== null) {
      if (quiet.active) {
        decisions.push({
          ...base,
          deliver: 'hold',
          hold_until: quiet.until,
          reason: `held: ${why}, but quiet hours run until ${quiet.until_local} (${a.timezone}); only a sev-1 breaks them${ignored}`,
        });
      } else if (interruptsLeft <= 0) {
        digestRoom = Math.max(0, digestRoom - 1);
        decisions.push({
          ...base,
          deliver: 'digest',
          reason: `${why}, but the ${a.interrupts_per_day} interrupts allowed in 24 hours are spent, so it goes in the next digest${ignored}`,
        });
      } else {
        interruptsLeft -= 1;
        decisions.push({
          ...base,
          deliver: 'now',
          reason: `${why}; interrupt ${a.interrupts_per_day - interruptsLeft} of ${a.interrupts_per_day} in 24 hours${ignored}`,
        });
      }
      continue;
    }
    // 3. Not urgent.
    const quickly =
      answeringQuickly && a.non_urgent_at_once > 0 && !quiet.active && interruptsLeft > 0;
    if (quickly && atOnceLeft > 0) {
      atOnceLeft -= 1;
      interruptsLeft -= 1;
      decisions.push({
        ...base,
        deliver: 'now',
        reason: `not urgent, but the person answered ${Math.round((answeredAgo ?? 0) / 60_000)} minutes ago and allows ${count(a.non_urgent_at_once, 'question', 'questions')} at once; interrupt ${a.interrupts_per_day - interruptsLeft} of ${a.interrupts_per_day} in 24 hours${ignored}`,
      });
      continue;
    }
    const held = quiet.active ? '; quiet hours keep it from going at once' : '';
    if (digestRoom > 0) {
      digestRoom -= 1;
      decisions.push({
        ...base,
        deliver: 'digest',
        reason: `not urgent: it goes in the next digest, place ${a.decisions_per_digest - digestRoom} of ${a.decisions_per_digest}${held}${ignored}`,
      });
      continue;
    }
    if (easyToUndo && (c.default_if_unanswered?.option || c.recommended)) {
      const fromDefault = Boolean(c.default_if_unanswered?.option);
      const option = /** @type {string} */ (c.default_if_unanswered?.option ?? c.recommended);
      decisions.push({
        ...base,
        deliver: 'default',
        reason: `the digest is full (${a.decisions_per_digest} decisions in front of the person) and this one is easy to undo, so it takes ${fromDefault ? 'its default' : 'the recommendation'} ${option}, logged and listed in the next digest`,
        default: {
          option,
          deadline: c.default_if_unanswered?.deadline ?? null,
          source: fromDefault ? 'default_if_unanswered' : 'recommendation',
        },
      });
      continue;
    }
    decisions.push({
      ...base,
      deliver: 'hold',
      reason: easyToUndo
        ? `the digest is full (${a.decisions_per_digest} decisions in front of the person), and it has no recommendation to take; it waits for room${held}`
        : `the digest is full (${a.decisions_per_digest} decisions in front of the person); a call that is hard to undo always waits for the owner, so it waits for room${held}${ignored}`,
    });
  }

  return {
    budget: {
      decisions_per_digest: {
        limit: a.decisions_per_digest,
        in_front: inFront.length,
        left: Math.max(0, a.decisions_per_digest - inFront.length),
      },
      interrupts_per_day: {
        limit: a.interrupts_per_day,
        used: r.interruptsUsed,
        left: Math.max(0, a.interrupts_per_day - r.interruptsUsed),
      },
      non_urgent_at_once: {
        limit: a.non_urgent_at_once,
        in_front: r.nonUrgentSent,
        left: Math.max(0, a.non_urgent_at_once - r.nonUrgentSent),
      },
      answering_quickly: answeringQuickly,
      last_answered_at: r.lastAnsweredAt,
      quiet_hours: {
        active: quiet.active,
        until: quiet.until,
        windows: a.quiet_hours,
        timezone: a.timezone,
      },
      slots: { ...r.slots, idle },
    },
    decisions,
    waiting,
  };
}
