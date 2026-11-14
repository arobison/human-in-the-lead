// The usage capture (design part 12.5): Claude Code runs the project's status-line command with a
// JSON description of the session on standard input, which includes the subscription's
// rate_limits (the five-hour and weekly windows). This records them as a usage snapshot in the
// project's private store, so the quota gate (piece (f)) has readings; the default quotas are
// those two windows, and a declared quota with no reading stops dispatch.
//
// It never fails the status line: a problem prints a short line and records nothing.

import { findRepoRoot, loadPolicy } from '../../lib/policy/policy.mjs';
import { openStore, privateStorePath } from '../../lib/store/store.mjs';
import { schemas } from '../../lib/schema/registry.mjs';
import { SNAPSHOTS_KEY, readSnapshots } from '../../lib/quota/usage.mjs';

/** Write at most one unchanged snapshot per this many milliseconds. */
const THROTTLE_MS = 60_000;

/** @param {unknown} w */
const windowOf = (w) => {
  if (!w || typeof w !== 'object') return undefined;
  const o = /** @type {Record<string, unknown>} */ (w);
  if (typeof o.used_percentage !== 'number') return undefined;
  return {
    used_percentage: Math.min(100, Math.max(0, o.used_percentage)),
    ...(typeof o.resets_at === 'number' || typeof o.resets_at === 'string'
      ? { resets_at: o.resets_at }
      : {}),
  };
};

/**
 * Record a snapshot from status-line input, and return the line to show.
 * @param {string} text the status-line JSON
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, now?: () => Date }} ctx
 * @returns {{ line: string, recorded: boolean, reason?: string }}
 */
export function recordStatusLine(text, ctx) {
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return { line: 'hitld: no status input', recorded: false, reason: 'not JSON' };
  }
  const dir =
    input?.workspace?.project_dir ?? input?.workspace?.current_dir ?? input?.cwd ?? ctx.cwd;
  const repoRoot = findRepoRoot(String(dir));
  const loaded = repoRoot ? loadPolicy({ cwd: repoRoot }) : null;
  if (!repoRoot || !loaded?.policy)
    return { line: 'hitld: no policy here', recorded: false, reason: 'no policy.json' };
  const five = windowOf(input?.rate_limits?.five_hour);
  const seven = windowOf(input?.rate_limits?.seven_day);
  const pct = (/** @type {{ used_percentage: number } | undefined} */ w) =>
    w ? `${Math.round(w.used_percentage)}%` : '?';
  const line = `hitld: 5h ${pct(five)} · 7d ${pct(seven)}`;
  if (!five && !seven)
    return {
      line,
      recorded: false,
      reason: 'no rate_limits in the input (an API-key session has none)',
    };

  const now = (ctx.now ?? (() => new Date()))();
  const snapshot = {
    schema_version: schemas().currentVersion('usage-snapshot'),
    at: now.toISOString(),
    source: 'claude-code-statusline',
    ...(typeof input.session_id === 'string' && input.session_id
      ? { session: input.session_id }
      : {}),
    rate_limits: { ...(five ? { five_hour: five } : {}), ...(seven ? { seven_day: seven } : {}) },
  };
  const errors = schemas().validateEntity('usage-snapshot', snapshot);
  if (errors.length)
    return {
      line,
      recorded: false,
      reason: errors.map((e) => `${e.path} ${e.message}`).join('; '),
    };
  const store = openStore(privateStorePath(loaded.policy.project.id, { env: ctx.env, repoRoot }));
  const last = readSnapshots(store)
    .snapshots.filter((s) => s.source === 'claude-code-statusline')
    .at(-1);
  if (
    last &&
    now.getTime() - Date.parse(last.at) < THROTTLE_MS &&
    JSON.stringify(last.rate_limits) === JSON.stringify(snapshot.rate_limits)
  ) {
    return { line, recorded: false, reason: 'unchanged within a minute' };
  }
  store.append(SNAPSHOTS_KEY, JSON.stringify(snapshot) + '\n');
  return { line, recorded: true };
}
