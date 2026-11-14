// Windows of a quota (design part 12.5): rolling_5h, weekly, monthly_utc, run, or a custom
// ISO 8601 period such as P14D. Times are milliseconds since the epoch.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * A reset time as milliseconds: Unix seconds (as the Claude Code status line gives it) or a
 * timestamp string. Null when absent or unreadable.
 * @param {unknown} value @returns {number | null}
 */
export function resetsAtMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * The length of a fixed-length window, or null for one that is not (monthly_utc, run).
 * Supports P<n>W, P<n>D and PT<n>H as custom periods.
 * @param {string} window @returns {number | null}
 */
export function windowLengthMs(window) {
  if (window === 'rolling_5h') return 5 * HOUR;
  if (window === 'weekly') return 7 * DAY;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(\d+)H)?$/.exec(window);
  if (m && (m[1] || m[2] || m[3])) {
    return (Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0)) * DAY + Number(m[3] ?? 0) * HOUR;
  }
  return null;
}

/**
 * The current window's start and, where it has a fixed reset, its end. A known reset time (from a
 * snapshot) places a fixed-length window exactly; otherwise it is the last length up to now.
 * @param {string} window
 * @param {number} now
 * @param {{ resetsAt?: number | null, runStartedAt?: number | null }} [known]
 * @returns {{ start: number, end: number | null }}
 */
export function windowBounds(window, now, known = {}) {
  if (window === 'monthly_utc') {
    const d = new Date(now);
    return {
      start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
      end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
    };
  }
  if (window === 'run') return { start: known.runStartedAt ?? 0, end: null };
  const length = windowLengthMs(window) ?? 7 * DAY;
  if (known.resetsAt != null && known.resetsAt > now) {
    return { start: known.resetsAt - length, end: known.resetsAt };
  }
  return { start: now - length, end: null };
}

export { HOUR };
