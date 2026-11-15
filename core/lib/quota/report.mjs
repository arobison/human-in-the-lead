// `hitld report` (design parts 12.2 and 12.4): the data, a text digest that fits a phone screen,
// and one static HTML page. The page is self-contained: inline styles and inline SVG, no script,
// no external asset, no network request. It follows the reader's light or dark setting.
//
// Facts, not adjectives: every line states a figure from the ledger or a quota.

import { effectiveEntries, tokensOf } from './usage.mjs';
import { waitingForOwner, waited } from '../merge/owner.mjs';
import { dispatchGate, forecastLine, show } from './gate.mjs';

export const METRICS_SCHEMA_VERSION = 1;

/** @param {Record<string, any>[]} entries @returns {Record<string, any>} */
function ledgerSummary(entries) {
  const live = effectiveEntries(entries);
  /** @type {Record<string, number>} */
  const events = {};
  /** @type {Record<string, number>} */
  const byModel = {};
  /** @type {Record<string, number>} */
  const byTier = {};
  let tokens = 0;
  for (const e of live) {
    events[e.event] = (events[e.event] ?? 0) + 1;
    const t = tokensOf(e.tokens);
    if (t) {
      tokens += t;
      const m = e.model ?? 'unknown';
      byModel[m] = (byModel[m] ?? 0) + t;
      const tier = e.tier == null ? 'unknown' : String(e.tier);
      byTier[tier] = (byTier[tier] ?? 0) + t;
    }
  }
  const merged = new Set(live.filter((e) => e.event === 'merged').map((e) => e.item));
  return {
    entries: live.length,
    events,
    tokens,
    tokens_by_model: byModel,
    tokens_by_tier: byTier,
    items_merged: merged.size,
    tokens_per_merged_item: merged.size ? Math.round(tokens / merged.size) : null,
  };
}

/**
 * Threshold lines for the digest: the highest `notify_used` share each quota has passed.
 * @param {import('./quota.mjs').QuotaState[]} quotas @param {number[]} levels
 */
function thresholds(quotas, levels) {
  /** @type {string[]} */
  const out = [];
  for (const s of quotas) {
    if (s.used == null || !s.limit) continue;
    const share = s.used / s.limit;
    const passed = levels.filter((l) => share >= l).sort((a, b) => b - a)[0];
    if (passed != null) out.push(`${s.id} is past ${Math.round(passed * 100)}% used`);
  }
  return out;
}

/**
 * Branches whose verification passed and that nothing has merged or reverted since, derived from
 * the ledger. Only owner mode reports them: the queue merges them without waiting.
 * @param {Record<string, any>} policy @param {Record<string, any>[]} ledger @param {number} now
 */
function ownerWaiting(policy, ledger, now) {
  if (policy.merge?.mode !== 'owner') return [];
  /** @type {Map<string, { item: string, branch: string | null }>} */
  const waiting = new Map();
  for (const e of ledger) {
    if (e.event === 'verified') {
      waiting.delete(e.item);
      if (e.result === 'pass') waiting.set(e.item, { item: e.item, branch: e.branch ?? null });
    } else if (e.event === 'merged' || e.event === 'reverted') waiting.delete(e.item);
  }
  return waitingForOwner([...waiting.values()], ledger, now);
}

/**
 * @param {object} input
 * @param {Record<string, any>} input.policy
 * @param {Record<string, any>[]} [input.snapshots]
 * @param {Record<string, any>[]} [input.ledger]
 * @param {number} [input.now]
 * @param {number | null} [input.runStartedAt]
 */
export function buildReport({
  policy,
  snapshots = [],
  ledger = [],
  now = Date.now(),
  runStartedAt = null,
}) {
  // The gate for a non-critical item, and for a critical one, so the report shows both outcomes.
  const gate = dispatchGate(
    policy,
    snapshots,
    { id: 'an ordinary item' },
    { now, ledger, runStartedAt },
  );
  const critical = dispatchGate(
    policy,
    snapshots,
    { id: 'a critical-path item', critical_path: true },
    { now, ledger, runStartedAt },
  );
  return {
    metrics_schema_version: METRICS_SCHEMA_VERSION,
    generated_at: new Date(now).toISOString(),
    project: policy.project.id,
    gate: {
      mode: gate.mode,
      allow_ordinary: gate.allow,
      allow_critical_path: critical.allow,
      reason: gate.reason,
      binding: gate.binding,
      forecast: gate.forecast,
      ask_owner: gate.ask_owner,
      unread: gate.unread,
    },
    quotas: gate.quotas,
    thresholds: thresholds(gate.quotas, policy.quota.notify_used),
    ledger: ledgerSummary(ledger),
    waiting_for_owner: ownerWaiting(policy, ledger, now),
  };
}

/** @typedef {ReturnType<typeof buildReport>} Report */

export const MODE_LABEL = {
  normal: 'Normal dispatch',
  economize: 'Economize',
  critical_path_only: 'Critical path only',
  stop: 'Stopped at the reserve',
};

/** The text digest: one phone screen, facts only. @param {Report} r @returns {string} */
export function renderDigest(r) {
  const lines = [`${r.project}: quotas and spend, ${r.generated_at}`, ''];
  lines.push(`Dispatch: ${MODE_LABEL[r.gate.mode]}.`);
  lines.push(r.gate.reason);
  if (r.gate.ask_owner) lines.push('The owner is asked before this hard limit is passed.');
  if (r.waiting_for_owner.length) {
    lines.push('', `Waiting for your merge (${r.waiting_for_owner.length}):`);
    for (const w of r.waiting_for_owner) {
      lines.push(`- ${w.item} on ${w.branch ?? 'no branch'}, waiting ${waited(w.waited_ms)}`);
    }
  }
  lines.push('');
  lines.push('Quotas:');
  for (const s of r.quotas) {
    const used =
      s.used == null
        ? 'no reading'
        : `${show(s.unit, s.used)} of ${s.limit == null ? 'unknown' : show(s.unit, s.limit)}`;
    const head =
      s.headroom == null
        ? ''
        : `, ${Math.round(s.headroom * 100)}% above the ${Math.round(s.reserve_share * 100)}% reserve`;
    lines.push(
      `- ${s.id} (${s.window}${s.hard ? ', hard' : ', soft'}): ${used}${head}; confidence ${s.confidence}`,
    );
    lines.push(`  ${forecastLine(s)}`);
  }
  if (r.thresholds.length) lines.push('', ...r.thresholds.map((t) => `Threshold: ${t}.`));
  const l = r.ledger;
  lines.push(
    '',
    `Ledger: ${l.entries} events, ${l.tokens} tokens, ${l.items_merged} items merged` +
      (l.tokens_per_merged_item == null
        ? '.'
        : `, ${l.tokens_per_merged_item} tokens per merged item.`),
  );
  return `${lines.join('\n')}\n`;
}

/** @param {unknown} v @returns {string} */
const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/** A bar: used, the reserve zone, and the economize and critical marks. @param {import('./quota.mjs').QuotaState} s @param {Record<string, any>} q */
function bar(s, q) {
  if (s.used == null || !s.limit) return '<span class="muted">no reading</span>';
  const W = 320;
  const x = (/** @type {number} */ share) => Math.max(0, Math.min(1, share)) * W;
  const usedW = x(s.used / s.limit);
  const reserveX = x(1 - s.reserve_share);
  const mark = (/** @type {number} */ headroom, /** @type {string} */ label) => {
    const at = x(1 - s.reserve_share - headroom);
    return `<line x1="${at}" x2="${at}" y1="0" y2="16" class="mark"><title>${esc(label)}</title></line>`;
  };
  const text = `${s.id}: ${Math.round((s.used / s.limit) * 100)}% used, reserve from ${Math.round((1 - s.reserve_share) * 100)}%`;
  return `<svg viewBox="0 0 ${W} 16" role="img" aria-label="${esc(text)}" class="bar"><rect width="${W}" height="16" class="track"/><rect x="${reserveX}" width="${W - reserveX}" height="16" class="reserve"/><rect width="${usedW}" height="16" class="used"/>${mark(q.economize_below, 'economize')}${mark(q.critical_below, 'critical path only')}<line x1="${reserveX}" x2="${reserveX}" y1="0" y2="16" class="stop"><title>reserve: stop</title></line></svg>`;
}

/**
 * The static report page. @param {Report} r @param {Record<string, any>} policy
 * @returns {string}
 */
export function renderHtml(r, policy) {
  const rows = r.quotas
    .map((s) => {
      const f = s.forecast;
      const used =
        s.used == null
          ? '—'
          : `${esc(show(s.unit, s.used))} of ${s.limit == null ? '?' : esc(show(s.unit, s.limit))}`;
      return `<tr${s.id === r.gate.binding ? ' class="binding"' : ''}>
<th scope="row">${esc(s.id)}<small>${esc(s.window)}, ${s.hard ? 'hard' : 'soft'}, ${esc(s.source)}</small></th>
<td>${bar(s, policy.quota)}<small>${used}${s.headroom == null ? '' : `; ${Math.round(s.headroom * 100)}% above the ${Math.round(s.reserve_share * 100)}% reserve`}</small></td>
<td>${esc(s.confidence)}<small>${esc(s.used_from ?? 'none')}${s.as_of ? `, as of ${esc(s.as_of)}` : ''}</small></td>
<td>${f.burn_per_hour == null ? '—' : `${esc(show(s.unit, f.burn_per_hour))}/h`}<small>${esc(f.burn_basis ?? '')}</small></td>
<td>${f.reserve_at ? esc(f.reserve_at) : '—'}<small>${f.before_reset == null ? '' : f.before_reset ? 'before the window resets' : 'after the window resets'}${f.reserve_band ? `<br>band ${esc(f.reserve_band[0])} to ${esc(f.reserve_band[1] ?? 'never')}` : ''}</small></td>
</tr>`;
    })
    .join('\n');
  const l = r.ledger;
  const kv = (/** @type {Record<string, number>} */ o) =>
    Object.entries(o)
      .map(([k, v]) => `<li>${esc(k)}: ${v}</li>`)
      .join('') || '<li>none</li>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(r.project)}: quotas and spend</title>
<style>
:root{--bg:#fbfbfa;--fg:#1c1d20;--muted:#60646c;--line:#d9dbe0;--card:#fff;--used:#2f6fb3;--reserve:#e5b64a55;--track:#e9eaee;--mark:#8a8f98;--stop:#b3261e;--stop-bg:#fbe9e7;--warn-bg:#fff4dc}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--fg:#e8e9ec;--muted:#9a9fa8;--line:#34373d;--card:#1b1c1f;--used:#6aa5e6;--reserve:#d9a53a44;--track:#2a2c31;--mark:#8a8f98;--stop:#ff8a80;--stop-bg:#3a1f1c;--warn-bg:#3a3018}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:64rem;margin:0 auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:2rem 0 .5rem}
.muted,small{color:var(--muted)}small{display:block;font-size:.8rem}
.status{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--mark);border-radius:6px;padding:.75rem 1rem;margin:1rem 0}
.status.economize,.status.critical_path_only{border-left-color:#d9a53a;background:var(--warn-bg)}
.status.stop{border-left-color:var(--stop);background:var(--stop-bg)}
.status strong{display:block;font-size:1.1rem}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:46rem}
th,td{text-align:left;vertical-align:top;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
thead th{font-size:.8rem;color:var(--muted);font-weight:600}tr.binding{background:var(--warn-bg)}
.bar{width:100%;max-width:20rem;height:1rem;display:block;border-radius:3px;overflow:hidden}
.track{fill:var(--track)}.reserve{fill:var(--reserve)}.used{fill:var(--used)}.mark{stroke:var(--mark);stroke-width:1}.stop{stroke:var(--stop);stroke-width:2}
ul{margin:.25rem 0;padding-left:1.2rem}
</style>
</head>
<body>
<main>
<h1>${esc(r.project)}: quotas and spend</h1>
<div class="muted">Generated ${esc(r.generated_at)}. Metrics schema ${r.metrics_schema_version}. Local data only.</div>
<div class="status ${esc(r.gate.mode)}"><strong>${esc(MODE_LABEL[r.gate.mode])}</strong>${esc(r.gate.reason)}${r.gate.forecast ? `<small>Forecast that triggered it: ${esc(r.gate.forecast)}</small>` : ''}<small>Ordinary items: ${r.gate.allow_ordinary ? 'dispatch' : 'wait'}. Critical-path items: ${r.gate.allow_critical_path ? 'dispatch' : 'wait'}.${r.gate.ask_owner ? ' The owner is asked before this hard limit is passed.' : ''}</small></div>
<h2>Quotas</h2>
<div class="wrap"><table>
<thead><tr><th>Limit</th><th>Used (bar: reserve shaded, marks at economize and critical path)</th><th>Confidence</th><th>Burn</th><th>Reserve reached</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
${r.waiting_for_owner.length ? `<h2>Waiting for your merge</h2><ul>${r.waiting_for_owner.map((w) => `<li>${esc(w.item)} on ${esc(w.branch ?? 'no branch')}, waiting ${esc(waited(w.waited_ms))}</li>`).join('')}</ul>` : ''}
${r.thresholds.length ? `<h2>Thresholds</h2><ul>${r.thresholds.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
<h2>Ledger</h2>
<p>${l.entries} events, ${l.tokens} tokens, ${l.items_merged} items merged${l.tokens_per_merged_item == null ? '' : `, ${l.tokens_per_merged_item} tokens per merged item`}.</p>
<div class="wrap"><table style="min-width:0"><thead><tr><th>Events</th><th>Tokens by model</th><th>Tokens by tier</th></tr></thead><tbody><tr><td><ul>${kv(l.events)}</ul></td><td><ul>${kv(l.tokens_by_model)}</ul></td><td><ul>${kv(l.tokens_by_tier)}</ul></td></tr></tbody></table></div>
</main>
</body>
</html>
`;
}
