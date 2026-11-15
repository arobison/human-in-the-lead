// The dispatch gate (design part 12.5, "Control"): normal, economize, critical path only, stop at
// the reserve. The owner's reserve is never spent by autonomous work, and each answer carries the
// reason, including the forecast, so the owner can see why dispatch slowed.
//
// Headroom is the share of a limit above the reserve (see quota.mjs). Per limit:
//   headroom <= 0                  stop (at or past the reserve)
//   headroom <  quota.critical_below  critical_path_only
//   headroom <  quota.economize_below economize
// The gate takes the worst mode over every limit. A limit with no reading cannot restrict
// anything, and says so in `unread`. A hard limit that stops dispatch also sets ask_owner: going
// past it needs the owner's yes.

import { evaluateQuotas } from './quota.mjs';

export const MODES = /** @type {const} */ (['normal', 'economize', 'critical_path_only', 'stop']);

/** @param {string} unit @param {number} v */
export function show(unit, v) {
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return unit === 'plan-percent' ? `${n}%` : unit === 'usd' ? `$${n}` : `${n} ${unit}`;
}

/** @param {number} share */
const pct = (share) => `${Math.round(share * 1000) / 10}%`;

/**
 * One quota's mode, and why.
 * @param {import('./quota.mjs').QuotaState} s
 * @param {Record<string, any>} q policy.quota
 * @param {{ estimate_tokens?: number }} item
 * @param {number} [share] this project's fraction of the headroom near the reserve, in (0, 1]
 * @returns {{ mode: typeof MODES[number], why: string } | null} null when there is no reading
 */
function modeOf(s, q, item, share = 1) {
  // Fail closed: a quota whose headroom, use or limit is missing or not a finite number cannot
  // be shown to have room, so it stops dispatch and says why.
  const num = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);
  if (!num(s.headroom) || !num(s.used) || !num(s.limit)) {
    return {
      mode: 'stop',
      why: `${s.id}: its use, limit or headroom is unknown or not a number (${s.notes.at(-1) ?? 'no reading'}), so dispatch stops until it can be read`,
    };
  }
  // Near the reserve (below the economize threshold) several projects compete for what is left, so
  // each judges its own share of it (design 13.4, "Shares near the reserve"). Past the reserve the
  // sign is unchanged, so a stop stays a stop. Above the threshold nobody is competing yet.
  const whole = /** @type {number} */ (s.headroom);
  const shared = share < 1 && whole < q.economize_below;
  const headroom = shared ? whole * share : whole;
  const used = /** @type {number} */ (s.used);
  const limit = /** @type {number} */ (s.limit);
  const mine = shared ? ` (this project's ${pct(share)} share of ${pct(whole)} left)` : '';
  const left = `${s.id}: ${pct(headroom)}${mine} of its limit above the ${pct(s.reserve_share)} reserve (used ${show(s.unit, used)} of ${show(s.unit, limit)})`;
  const cost = Number.isFinite(item.estimate_tokens) ? item.estimate_tokens : 0;
  if (
    s.unit === 'tokens' &&
    cost &&
    s.reserve != null &&
    headroom > 0 &&
    used + cost > limit - s.reserve
  ) {
    return {
      mode: 'stop',
      why: `${left}; this item's estimate of ${cost} tokens would cross the reserve`,
    };
  }
  if (headroom <= 0)
    return { mode: 'stop', why: `${left}: ${headroom < 0 ? 'past' : 'at'} the reserve` };
  if (headroom < q.critical_below) {
    return {
      mode: 'critical_path_only',
      why: `${left}, below the critical threshold of ${pct(q.critical_below)}`,
    };
  }
  if (headroom < q.economize_below) {
    return {
      mode: 'economize',
      why: `${left}, below the economize threshold of ${pct(q.economize_below)}`,
    };
  }
  return { mode: 'normal', why: `${left}, ample` };
}

/**
 * @param {import('./quota.mjs').QuotaState} s
 * @returns {string}
 */
function forecastLine(s) {
  const f = s.forecast;
  if (f.burn_per_hour == null) return `${s.id}: no forecast (${s.notes.at(-1) ?? 'no readings'})`;
  const rate = `${show(s.unit, f.burn_per_hour)}/h (${f.burn_basis})`;
  if (!f.reserve_at) return `${s.id}: burning ${rate}, not heading for the reserve`;
  const band = f.reserve_band
    ? `, between ${f.reserve_band[0]} and ${f.reserve_band[1] ?? 'never'}`
    : '';
  const reset =
    f.before_reset == null
      ? ''
      : f.before_reset
        ? ', before the window resets'
        : ', after the window resets';
  return `${s.id}: burning ${rate}; reserve reached about ${f.reserve_at}${band}${reset}`;
}

/**
 * Whether autonomous dispatch of an item may go ahead.
 * @param {Record<string, any>} policy
 * @param {Record<string, any>[]} snapshots parsed usage snapshots
 * @param {{ id?: string, critical_path?: boolean, estimate_tokens?: number }} [item]
 * @param {{ now?: number, ledger?: Record<string, any>[], runStartedAt?: number | null, share?: number }} [options]
 * @returns {{
 *   mode: typeof MODES[number],
 *   allow: boolean,
 *   reason: string,
 *   binding: string | null,
 *   forecast: string | null,
 *   economize: { prefer_cheaper_models: boolean, reduce_concurrency: boolean },
 *   ask_owner: boolean,
 *   notify_owner: boolean,
 *   resets_at: string | null,
 *   unread: string[],
 *   quotas: import('./quota.mjs').QuotaState[],
 * }}
 */
export function dispatchGate(policy, snapshots, item = {}, options = {}) {
  const quotas = evaluateQuotas({
    policy,
    snapshots,
    ledger: options.ledger,
    now: options.now,
    runStartedAt: options.runStartedAt,
  });
  /** @type {{ s: import('./quota.mjs').QuotaState, mode: typeof MODES[number], why: string }[]} */
  const judged = [];
  /** @type {string[]} */
  const unread = [];
  for (const s of quotas) {
    const m = modeOf(s, policy.quota, item, options.share);
    if (m) judged.push({ s, ...m });
    else unread.push(s.id);
  }
  // The worst mode wins; of equals, the one with the least headroom.
  const worst = judged.reduce(
    (a, b) =>
      !a ||
      MODES.indexOf(b.mode) > MODES.indexOf(a.mode) ||
      (b.mode === a.mode && (b.s.headroom ?? 0) < (a.s.headroom ?? 0))
        ? b
        : a,
    /** @type {(typeof judged)[number] | undefined} */ (undefined),
  );
  const mode = worst?.mode ?? 'normal';
  const critical = item.critical_path === true;
  const allow = mode === 'stop' ? false : mode === 'critical_path_only' ? critical : true;

  let reason;
  if (!worst) reason = 'no quota has a reading yet, so nothing limits dispatch';
  else if (mode === 'normal') reason = `normal dispatch: ${worst.why}`;
  else if (mode === 'economize')
    reason = `economize: ${worst.why}; prefer cheaper models and tiers where sizing allows and lower concurrency`;
  else if (mode === 'critical_path_only') {
    reason = `critical path only: ${worst.why}; ${critical ? `${item.id ?? 'this item'} is on the critical path, so it may go` : `${item.id ?? 'this item'} is not on the critical path, so it waits`}`;
  } else {
    reason = `stop at the reserve: ${worst.why}; autonomous dispatch has stopped, in-flight executors finish or checkpoint, and the owner is told`;
  }
  const ask = mode === 'stop' && worst?.s.hard === true;
  if (ask) reason += "; this limit is hard, so going past it needs the owner's yes first";
  if (unread.length) reason += ` (no reading for ${unread.join(', ')})`;

  return {
    mode,
    allow,
    reason,
    binding: worst && mode !== 'normal' ? worst.s.id : null,
    forecast: worst && mode !== 'normal' ? forecastLine(worst.s) : null,
    economize: {
      prefer_cheaper_models: mode !== 'normal',
      reduce_concurrency: mode !== 'normal',
    },
    ask_owner: ask,
    notify_owner: mode === 'stop',
    // When the binding limit's window resets (its reading's reset, or the declared one): a stop
    // at it is a pause the chief of staff wakes the run from then (design part 12.5).
    resets_at: worst && mode !== 'normal' ? worst.s.resets_at : null,
    unread,
    quotas,
  };
}

export { forecastLine };
