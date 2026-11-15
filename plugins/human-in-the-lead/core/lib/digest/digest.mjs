// The digest (design parts 12.2 and 23.5): what is new for the owner since the last one, built
// from the records, never from the orchestrator's memory, and short enough for one phone screen.
// `hitld rights digest` builds it and `hitld dashboard` writes the same text to digest.txt, so
// there is one digest.
//
// It is built when the orchestrator calls for it at one of two triggers:
//
//   merge-batch   a batch of merges has landed. Quiet hours hold it back: the result says when it
//                 may go (`hold_until`).
//   owner-writes  the owner has just written. The owner is here, so quiet hours do not apply:
//                 nothing is sent at them that they did not ask for.
//
// The result says whether to send (`delivery`) and how loudly (`urgency`), so a channel can act
// on it without reading the text. The read cursor is a time in the private store. Marking a sent
// digest moves it, and records each question in it as shown, which ends its queue time.

import { quietState } from '../rights/budget.mjs';
import { showQuestion } from '../rights/flow.mjs';
import { pendingDecisions } from '../rights/pending.mjs';
import { PARTS } from './parts.mjs';
import { DIGEST_BUDGET, clip, layOut } from './render.mjs';

/**
 * @typedef {import('../rights/flow.mjs').Deps} Deps
 * @typedef {import('./parts.mjs').Part} Part
 * @typedef {import('./render.mjs').Section} Section
 *
 * @typedef {object} DigestFields what to send and what is in it. Beside these fields it carries the data
 *   of each part, under the names the parts give it (questions, merged, logged_calls, ...)
 * @property {true} ok
 * @property {string} project
 * @property {typeof TRIGGERS[number]} trigger
 * @property {string} at ISO 8601
 * @property {string | null} since the read cursor it was built from
 * @property {boolean} news whether anything in it is new
 * @property {'send' | 'hold' | 'skip'} delivery send it; hold it until `hold_until` (quiet hours);
 *   or skip it, because nothing is new
 * @property {'interrupt' | 'routine' | 'none'} urgency interrupt: a question is needed now, so the
 *   channel may notify; routine: an ordinary digest; none: nothing to send
 * @property {string | null} [hold_until] for a held digest, when quiet hours end
 * @property {{ active: boolean, until: string | null, applies: boolean }} quiet_hours
 * @property {string} text the message, at most `size.budget` lines and characters
 * @property {{ lines: number, chars: number, budget: { lines: number, width: number }, omitted: Record<string, number> }} size
 *   omitted: per section, how many entries the text leaves out for want of room
 * @property {any} [questions] the questions in it, in order, with their recommendations
 *
 * @typedef {DigestFields & Record<string, any>} Digest
 */

export const TRIGGERS = /** @type {const} */ (['merge-batch', 'owner-writes']);

/** The private store key of the read cursor. */
export const DIGEST_KEY = 'rights/digest.json';

/**
 * What the last marked digest recorded: the time it went through, and the quota state it showed,
 * so a quota that stays as it was is not news again.
 * @param {Deps} deps
 * @returns {{ through: string | null, quota: { mode: string, thresholds: string[] } | null }}
 */
export function readCursorRecord(deps) {
  const none = { through: null, quota: null };
  const text = deps.store.read(DIGEST_KEY);
  if (!text) return none;
  try {
    const r = JSON.parse(text);
    return {
      through: typeof r.through === 'string' ? r.through : null,
      quota: r.quota && typeof r.quota.mode === 'string' ? r.quota : null,
    };
  } catch {
    return none;
  }
}

/** @param {Deps} deps @returns {string | null} the time through which the last digest was marked */
export const readCursor = (deps) => readCursorRecord(deps).through;

/** @param {string} iso */
const shortTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;

/**
 * Build the digest.
 * @param {Deps} deps
 * @param {object} options
 * @param {{ attention: import('../settings/attention.mjs').AttentionSettings, cap: number }} options.settings
 *   the person's effective attention budget and the executor cap
 * @param {typeof TRIGGERS[number]} [options.trigger] default owner-writes
 * @param {string | null} [options.since] only news after this. Default: the read cursor
 * @param {string} [options.now] ISO 8601. Default: the clock of `deps`
 * @param {Record<string, any> | null} [options.report] the quota report, for the quota and merge lines
 * @param {string | null} [options.root] the owner's checkout, for the quarantine file
 * @param {boolean} [options.full] the whole text, without the size budget
 * @param {readonly Part[]} [options.parts] the parts to assemble. Default: PARTS
 * @returns {Digest}
 */
export function buildDigest(deps, options) {
  const trigger = options.trigger ?? 'owner-writes';
  const now = options.now ?? (deps.now ?? (() => new Date().toISOString()))();
  const clocked = { ...deps, now: () => now };
  const last = readCursorRecord(deps);
  const since = options.since === undefined ? last.through : options.since;
  const a = options.settings.attention;

  // What the digest says is what the gate says without quiet hours: they decide whether it goes,
  // not what is in it. An urgent question that quiet hours hold is in the digest that waits.
  const pending = pendingDecisions(clocked, {
    ...options.settings,
    attention: { ...a, quiet_hours: [] },
  });
  const quiet = quietState(Date.parse(now), a.quiet_hours, a.timezone);
  /** @type {import('./parts.mjs').PartContext} */
  const context = {
    deps: clocked,
    since,
    now,
    trigger,
    pending,
    report: options.report ?? null,
    last,
    root: options.root ?? null,
  };

  /** @type {Section[]} */
  const sections = [];
  /** @type {Record<string, unknown>} */
  const json = {};
  for (const part of options.parts ?? PARTS) {
    const made = part.collect(context);
    Object.assign(json, made.json);
    if (made.section) sections.push(made.section);
  }

  const news = sections.some((s) => s.news);
  const urgent = pending.decisions.some((d) => d.deliver === 'now');
  const held = trigger === 'merge-batch' && quiet.active;
  /** @type {Digest['delivery']} */
  const delivery = !news ? 'skip' : held ? 'hold' : 'send';

  const head = [
    clip(`${deps.policy.project.id} digest ${shortTime(now)}`),
    clip(since ? `New since ${shortTime(since)}.` : 'Everything so far: no earlier digest.'),
  ];
  const room = options.full ? Infinity : DIGEST_BUDGET.lines;
  let body = layOut(sections, room - head.length);
  let footer = /** @type {string[]} */ ([]);
  if (Object.keys(body.omitted).length > 0) {
    // Say it was shortened, and where the rest is, within the same budget.
    footer = [clip('Shortened to fit. All of it: hitld rights digest --full')];
    body = layOut(sections, room - head.length - footer.length);
  }
  const lines = news
    ? [...head, ...body.lines, ...footer]
    : [head[0], clip(`Nothing new${since ? ` since ${shortTime(since)}` : ''}.`)];
  const text = `${lines.join('\n')}\n`;

  return {
    ok: true,
    project: deps.policy.project.id,
    trigger,
    at: now,
    since,
    news,
    delivery,
    urgency: delivery === 'skip' ? 'none' : urgent ? 'interrupt' : 'routine',
    ...(delivery === 'hold' ? { hold_until: quiet.until } : {}),
    quiet_hours: { active: quiet.active, until: quiet.until, applies: trigger === 'merge-batch' },
    text,
    size: {
      lines: lines.length,
      chars: text.length,
      budget: { ...DIGEST_BUDGET },
      omitted: body.omitted,
    },
    ...json,
  };
}

/** The times that news in a digest carries. @param {Record<string, any>} digest @returns {string[]} */
function newsTimes(digest) {
  const lists = ['merged', 'reverted', 'logged_calls', 'defaults', 'applications'];
  return lists.flatMap((k) =>
    /** @type {Record<string, any>[]} */ (digest[k] ?? []).map((x) => String(x.at)),
  );
}

/**
 * Record that the digest was sent: each question in it is shown (ledger `sent`, as part of a
 * digest, so the time it waited is told apart from the time the owner takes), and the read cursor
 * moves through the digest's time. Nothing is recorded for a digest that is not to be sent.
 * @param {Deps} deps
 * @param {Digest} digest
 * @returns {{ marked: boolean, through?: string, shown?: string[], reason?: string }}
 */
export function markDigest(deps, digest) {
  if (digest.delivery !== 'send') {
    return {
      marked: false,
      reason:
        digest.delivery === 'hold'
          ? `quiet hours hold it until ${digest.hold_until}; it is not sent, so nothing is marked`
          : 'nothing new, so there is nothing to mark',
    };
  }
  const now = digest.at;
  const clocked = { ...deps, now: () => now };
  /** @type {string[]} */
  const shown = [];
  for (const q of /** @type {Record<string, any>[]} */ (digest.questions ?? [])) {
    const r = showQuestion(clocked, { decision: String(q.decision) });
    if (r.ok) shown.push(String(q.decision));
  }
  const through = [now, ...newsTimes(digest)].sort().at(-1) ?? now;
  const quota = digest.quota
    ? { mode: digest.quota.mode, thresholds: digest.quota.thresholds }
    : undefined;
  deps.store.write(DIGEST_KEY, JSON.stringify({ through, marked_at: now, quota }) + '\n');
  return { marked: true, through, shown };
}
