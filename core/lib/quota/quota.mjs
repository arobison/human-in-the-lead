// Headroom and forecast per quota (design part 12.5).
//
// Headroom is the share of the limit that remains above the owner's reserve: (limit - used -
// reserve x limit) / limit. It is 0 at the reserve and negative past it. The forecast is a burn
// rate per hour and the time that rate reaches the reserve; its band runs from the recent rate to
// the window-average rate, because two honest estimates of a rate disagree by about as much as
// the rate is uncertain.

import { HOUR, declaredReset, resetsAtMs, windowBounds } from './window.mjs';
import { ledgerUsage, readingFor } from './usage.mjs';

/** A snapshot older than this, in a window that has not reset, is a reading but a weak one. */
export const FRESH_MS = 30 * 60_000;
/**
 * The source of a usage figure the owner reads on their own account and declares with `hitld
 * quota declare` (HITLD-149, HITLD-164). Every other source is a measured reading.
 */
export const DECLARED_SOURCE = 'owner-declared';
/** How old a declared figure may grow before the owner is asked for a fresh one, by default. */
const REFRESH_HOURS = 12;
const STALE_MS = 3 * HOUR;
/** Two readings closer than this say nothing about a rate. */
const MIN_SPAN_MS = 5 * 60_000;

const RANK = { low: 0, medium: 1, high: 2 };

/** @param {number} ms @returns {string} */
const iso = (ms) => new Date(ms).toISOString();
/** @param {number} n */
const round = (n) => Math.round(n * 10) / 10;

/**
 * The five-hour window some Claude plans have. It is not a default limit: Ultra and usage-based
 * plans have no such window, and a limit with no reading stops dispatch. The gate adds it while
 * the account's status line reports one (see shownLimits); otherwise the person file declares it.
 */
export const FIVE_HOUR_LIMIT = Object.freeze({
  id: 'claude-five-hour',
  unit: 'plan-percent',
  window: 'rolling_5h',
  limit: 100,
  scope: Object.freeze({ harness: 'claude-code' }),
  source: 'measured',
  hard: false,
});

/**
 * The limits to evaluate: the declared ones, plus the five-hour limit while the default account
 * shows that window. It shows it when its latest status-line snapshot (one with rate_limits)
 * carries five_hour and that window has not reset; Claude Code drops a window once it resets, and
 * an account without one never sends it. A declared limit on the rolling_5h window wins: nothing
 * is added then.
 * @param {Record<string, any>[]} limits @param {Record<string, any>[]} snapshots @param {number} now
 * @returns {Record<string, any>[]}
 */
export function shownLimits(limits, snapshots, now) {
  if (limits.some((l) => l.window === FIVE_HOUR_LIMIT.window || l.id === FIVE_HOUR_LIMIT.id))
    return limits;
  let latest = null;
  let latestAt = -Infinity;
  for (const s of snapshots) {
    if (s.account !== undefined && s.account !== 'default') continue;
    if (!s.rate_limits || typeof s.rate_limits !== 'object') continue;
    const at = Date.parse(s.at);
    if (!(at <= now) || at < latestAt) continue;
    latest = s;
    latestAt = at;
  }
  const w = latest?.rate_limits?.five_hour;
  if (!w) return limits;
  const resets = resetsAtMs(w.resets_at);
  if (resets != null && resets <= now) return limits;
  return [...limits, FIVE_HOUR_LIMIT];
}

/**
 * @typedef {object} Forecast
 * @property {number | null} burn_per_hour in the limit's unit
 * @property {'recent' | 'window average' | null} burn_basis
 * @property {[number, number] | null} burn_band lowest and highest rate the two estimates give
 * @property {string | null} reserve_at when the rate reaches the reserve (null: not burning, or no data)
 * @property {[string, string | null] | null} reserve_band earliest and latest (null: never at the lower rate)
 * @property {string | null} limit_at when the rate reaches the limit itself
 * @property {boolean | null} before_reset whether the reserve is reached before the window resets
 *
 * @typedef {object} QuotaState
 * @property {string} id
 * @property {string} unit
 * @property {string} window
 * @property {string} source declared in policy: measured, estimated or declared
 * @property {boolean} hard
 * @property {number | null} limit
 * @property {number} reserve_share
 * @property {number | null} reserve in the limit's unit
 * @property {number | null} used
 * @property {'snapshot' | 'declared' | 'ledger' | null} used_from declared: an estimate from the
 *   owner's figure and the burn since, used only when no fresh measured reading exists (HITLD-170)
 * @property {{ used: number, at: string, burn_per_hour: number | null } | null} declared the
 *   owner's figure the estimate starts from, when used_from is declared
 * @property {string | null} refresh why the owner is asked for a fresh figure, or null
 * @property {string | null} as_of
 * @property {string | null} resets_at
 * @property {'high' | 'medium' | 'low'} confidence
 * @property {number | null} headroom
 * @property {Forecast} forecast
 * @property {string[]} notes
 */

/**
 * Burn rates (per hour) from a series of cumulative readings: the recent rate over the smoothing
 * span and the average since the window began.
 * @param {{ at: number, used: number }[]} points ascending in time, one window
 * @param {{ now: number, start: number | null, used: number, smoothMs: number }} o
 */
function rates(points, { now, start, used, smoothMs }) {
  /** @type {number | null} */
  let recent = null;
  const inSpan = points.filter((p) => p.at >= now - smoothMs);
  // Readings reset to a lower value across a window change; only the last monotone run counts.
  let from = 0;
  for (let i = 1; i < inSpan.length; i++) if (inSpan[i].used < inSpan[i - 1].used) from = i;
  const run = inSpan.slice(from);
  if (run.length >= 2) {
    const a = run[0];
    const b = run[run.length - 1];
    if (b.at - a.at >= MIN_SPAN_MS) recent = (b.used - a.used) / ((b.at - a.at) / HOUR);
  }
  /** @type {number | null} */
  let average = null;
  if (start != null && now - start >= MIN_SPAN_MS * 3) average = used / ((now - start) / HOUR);
  return { recent, average };
}

/**
 * Evaluate every declared quota.
 * @param {object} input
 * @param {Record<string, any>} input.policy
 * @param {Record<string, any>[]} [input.snapshots] parsed usage snapshots
 * @param {Record<string, any>[]} [input.ledger] ledger entries (piece (b); a stand-in until it merges)
 * @param {number} [input.now] ms
 * @param {number | null} [input.runStartedAt] ms, for `run` windows
 * @returns {QuotaState[]}
 */
export function evaluateQuotas({
  policy,
  snapshots = [],
  ledger = [],
  now = Date.now(),
  runStartedAt = null,
}) {
  const q = policy.quota;
  const smoothMs = (q.forecast_hours ?? 2) * HOUR;
  return shownLimits(q.limits, snapshots, now).map((/** @type {any} */ limit) => {
    /** @type {string[]} */
    const notes = [];
    if (limit === FIVE_HOUR_LIMIT)
      notes.push("added: the account's status line reports a five-hour window");
    const reserveShare = limit.reserve ?? q.reserve;
    const reserve = limit.limit == null ? null : reserveShare * limit.limit;

    // The reading for this limit, from a window not yet reset (HITLD-170). A measured reading
    // younger than FRESH_MS wins. Without one, the latest reading of either kind is used: a figure
    // the owner declared after a stale measured reading, or a stale measured reading after the
    // owner's figure. A figure declared after a fresh measured reading does not replace it.
    // A snapshot from the machine registry carries its account and counts only for limits on that
    // account (a limit with no account is on the default one); a project's own snapshot has none
    // and counts for every limit, as before.
    const account = limit.scope?.account ?? 'default';
    /** @typedef {{ at: number, used: number, resetsAt: number | null, declared: boolean }} Reading */
    const readings = /** @type {Reading[]} */ (
      snapshots
        .filter((s) => s.account === undefined || s.account === account)
        .map((s) => {
          const r = readingFor(s, limit);
          return r ? { ...r, declared: s.source === DECLARED_SOURCE } : null;
        })
        .filter((r) => r && r.at <= now)
    ).sort((a, b) => a.at - b.at);
    const isLive = (/** @type {Reading} */ r) => r.resetsAt == null || r.resetsAt > now;
    const lastOf = (/** @type {boolean} */ declared) =>
      readings.filter((r) => r.declared === declared).at(-1);
    const measured = lastOf(false);
    const owners = lastOf(true);
    const measuredLive = measured && isLive(measured) ? measured : null;
    const ownersLive = owners && isLive(owners) ? owners : null;
    /** @type {Reading | null} */
    let live = measuredLive;
    if (
      ownersLive &&
      !(measuredLive && now - measuredLive.at <= FRESH_MS) &&
      !(measuredLive && measuredLive.at > ownersLive.at)
    ) {
      live = ownersLive;
    }
    if (!live && readings.length)
      notes.push('the latest snapshot is from a window that has since reset');

    // A reading's reset time wins; the person's declared reset stands in where there is none.
    const declared = live?.resetsAt == null ? declaredReset(limit, now) : null;
    const bounds = windowBounds(limit.window, now, {
      resetsAt: live?.resetsAt ?? declared,
      runStartedAt,
    });
    const hasFixedStart =
      live?.resetsAt != null || declared != null || ['monthly_utc', 'run'].includes(limit.window);

    /** @type {{ at: number, used: number }[]} */
    let points = [];
    let used = /** @type {number | null} */ (null);
    /** @type {'snapshot' | 'declared' | 'ledger' | null} */
    let usedFrom = null;
    let asOf = /** @type {number | null} */ (null);
    /** @type {{ used: number, at: string, burn_per_hour: number | null } | null} */
    let declaredFigure = null;
    /** @type {{ recent: number | null, average: number | null } | null} */
    let declaredRates = null;
    if (live?.declared) {
      // The owner's figure, aged: the burn the readings recorded up to it (the recent rate, else
      // the window's average), carried on from its time to now, so the figure does not hold still
      // as work runs. It never passes the limit itself.
      points = readings
        .filter((r) => isLive(r) && r.at >= bounds.start && r.at <= live.at)
        .map((r) => ({ at: r.at, used: r.used }));
      declaredRates = rates(points, {
        now: live.at,
        start: bounds.start,
        used: live.used,
        smoothMs,
      });
      const burn = declaredRates.recent ?? declaredRates.average;
      const since = burn != null && burn > 0 ? burn * ((now - live.at) / HOUR) : 0;
      used = limit.limit == null ? live.used + since : Math.min(limit.limit, live.used + since);
      usedFrom = 'declared';
      asOf = live.at;
      declaredFigure = { used: live.used, at: iso(live.at), burn_per_hour: burn };
      notes.push(
        `estimated from the owner's figure of ${round(live.used)} at ${iso(live.at)}${burn == null ? ', with no burn recorded to carry it on' : ` and a burn of ${round(burn)}/h since`}`,
      );
    } else if (live) {
      used = live.used;
      usedFrom = 'snapshot';
      asOf = live.at;
      points = readings
        .filter(
          (r) =>
            r && r.at >= bounds.start && (live.resetsAt == null || r.resetsAt === live.resetsAt),
        )
        .map((r) => ({ at: /** @type {any} */ (r).at, used: /** @type {any} */ (r).used }));
    } else {
      const est = ledgerUsage(ledger, limit, { start: bounds.start, now });
      if (est) {
        used = est.used;
        usedFrom = 'ledger';
        asOf = now;
        points = est.points;
        if (est.events === 0) notes.push('no ledger usage in the window');
      } else {
        notes.push(
          limit.source === 'measured'
            ? 'no snapshot yet, and the ledger cannot estimate this unit'
            : 'the ledger cannot estimate this unit',
        );
      }
    }

    // Confidence from the source and the age of the reading, capped by what the owner declared.
    /** @type {'high' | 'medium' | 'low'} */
    let confidence = 'low';
    if (usedFrom === 'snapshot' && asOf != null) {
      const age = now - asOf;
      confidence = age <= FRESH_MS ? 'high' : age <= STALE_MS ? 'medium' : 'low';
    } else if (usedFrom === 'ledger') {
      confidence = limit.source === 'estimated' ? 'medium' : 'low';
    }
    // A declared figure is a reading of low confidence that ages (HITLD-164): it stays low.
    if (
      limit.confidence &&
      RANK[/** @type {'high'|'medium'|'low'} */ (limit.confidence)] < RANK[confidence]
    ) {
      confidence = limit.confidence;
    }

    const lim = limit.limit;
    const available = lim != null && used != null && reserve != null ? lim - used - reserve : null;
    const headroom = available != null && lim ? available / lim : null;

    /** @type {Forecast} */
    const forecast = {
      burn_per_hour: null,
      burn_basis: null,
      burn_band: null,
      reserve_at: null,
      reserve_band: null,
      limit_at: null,
      before_reset: null,
    };
    if (used != null) {
      const r =
        declaredRates ??
        rates(points, {
          now,
          start: hasFixedStart || usedFrom === 'ledger' ? bounds.start : null,
          used,
          smoothMs,
        });
      const burn = r.recent ?? r.average;
      if (burn != null) {
        forecast.burn_per_hour = burn;
        forecast.burn_basis = r.recent != null ? 'recent' : 'window average';
        const both = [r.recent, r.average].filter((x) => x != null);
        forecast.burn_band = [Math.min(...both), Math.max(...both)];
        if (available != null && lim != null && burn > 0) {
          forecast.reserve_at = iso(now + Math.max(0, available / burn) * HOUR);
          forecast.limit_at = iso(now + Math.max(0, (lim - used) / burn) * HOUR);
          const [lo, hi] = forecast.burn_band;
          forecast.reserve_band = [
            iso(now + Math.max(0, available / hi) * HOUR),
            lo > 0 ? iso(now + Math.max(0, available / lo) * HOUR) : null,
          ];
          if (bounds.end != null)
            forecast.before_reset = now + Math.max(0, available / burn) * HOUR < bounds.end;
        }
      } else {
        notes.push('not enough readings to forecast a burn rate');
      }
    }

    // The owner is asked for a fresh figure when the estimate nears the reserve (inside the
    // economize band) or the figure is older than quota.declared_refresh_hours. Dispatch waits for
    // it only at the reserve, where the gate stops anyway.
    /** @type {string | null} */
    let refresh = null;
    if (usedFrom === 'declared' && asOf != null) {
      const hours = (now - asOf) / HOUR;
      const maxHours = q.declared_refresh_hours ?? REFRESH_HOURS;
      if (headroom != null && headroom < q.economize_below) {
        refresh = `the estimate from the owner's figure is ${round(headroom * 100)}% above the reserve, near it`;
      } else if (hours > maxHours) {
        refresh = `the owner's figure is ${round(hours)} hours old, older than quota.declared_refresh_hours (${maxHours})`;
      }
    }

    return {
      id: limit.id,
      unit: limit.unit,
      window: limit.window,
      source: limit.source,
      hard: limit.hard,
      limit: lim,
      reserve_share: reserveShare,
      reserve,
      used,
      used_from: usedFrom,
      declared: declaredFigure,
      refresh,
      as_of: asOf == null ? null : iso(asOf),
      resets_at: bounds.end == null ? null : iso(bounds.end),
      confidence,
      headroom,
      forecast,
      notes,
    };
  });
}

export { resetsAtMs };
