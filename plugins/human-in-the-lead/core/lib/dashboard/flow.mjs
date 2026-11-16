// Flow (HITLD-152, design part 11.1): how many items stood in each stage at the end of each day,
// from the committed state history, as stacked bands; then the measures, each beside its pair, the
// one that must not get worse (design part 11.3). Facts only: a measure the data cannot give says
// so.

import { FLOW_STAGES } from './work.mjs';
import { STAGE_NAMES } from './plan.mjs';
import { count, esc } from './html.mjs';

/** A share as a percentage, or a dash. @param {number} part @param {number} whole */
const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/**
 * @param {import('./work.mjs').WorkModel['flow']} f
 * @param {{ shallow?: boolean }} [source] whether the clone's history is cut (a shallow clone)
 */
export function renderFlow(f, { shallow = false } = {}) {
  const days = f.days;
  const W = 720;
  const H = 220;
  const LEFT = 34;
  const BOTTOM = 22;
  const most = Math.max(1, ...days.map((d) => FLOW_STAGES.reduce((s, k) => s + d[k], 0)));
  const slot = (W - LEFT) / Math.max(1, days.length);
  const gap = days.length > 30 ? 0 : Math.min(6, slot * 0.15);
  const TOP = 12;
  const y = (/** @type {number} */ v) => (TOP + (H - BOTTOM - TOP) * (1 - v / most)).toFixed(1);
  const bars = days
    .map((d, i) => {
      let base = 0;
      const x = (LEFT + i * slot + gap / 2).toFixed(1);
      const w = Math.max(1, slot - gap).toFixed(1);
      const rects = FLOW_STAGES.map((k) => {
        const v = d[k];
        if (!v) return '';
        const top = y(base + v);
        const h = (Number(y(base)) - Number(top)).toFixed(1);
        base += v;
        return `<rect class="fl st-${k}" x="${x}" y="${top}" width="${w}" height="${h}"><title>${esc(`${d.day}: ${v} ${STAGE_NAMES[k].toLowerCase()}`)}</title></rect>`;
      }).join('');
      return `<g>${rects}</g>`;
    })
    .join('');
  // Day labels: the first, the last, and about five between.
  const every = Math.max(1, Math.ceil(days.length / 6));
  const labels = days
    .map((d, i) =>
      i % every === 0 || i === days.length - 1
        ? `<text class="mg-step" x="${(LEFT + i * slot + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(d.day.slice(5))}</text>`
        : '',
    )
    .join('');
  const ticks = [0, Math.round(most / 2), most]
    .map(
      (v) =>
        `<line class="mg-tick" x1="${LEFT}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="mg-step" x="${LEFT - 6}" y="${Number(y(v)) + 4}" text-anchor="end">${v}</text>`,
    )
    .join('');
  const last = days.at(-1);
  const svg = days.length
    ? `<svg class="mg flow" viewBox="0 0 ${W} ${H}" role="img" aria-label="Items by stage at the end of each day, ${esc(days[0].day)} to ${esc(last?.day ?? '')}">${ticks}${bars}${labels}</svg>`
    : '';
  const legend = `<div class="mg-legend">${[...FLOW_STAGES]
    .reverse()
    .map((k) => `<span><i class="sw st-${k}"></i>${STAGE_NAMES[k]}</span>`)
    .join('')}</div>`;
  const table = `<details class="plan-list"><summary>The same ${count(days.length, 'day')} as a table</summary><div class="wrap"><table style="min-width:0"><thead><tr><th>Day</th>${FLOW_STAGES.map((k) => `<th>${STAGE_NAMES[k]}</th>`).join('')}</tr></thead><tbody>${[
    ...days,
  ]
    .reverse()
    .map(
      (d) =>
        `<tr><td>${esc(d.day)}</td>${FLOW_STAGES.map((k) => `<td>${d[k]}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></div></details>`;
  const m = f.measures;
  const cfr =
    m.merged > 0
      ? `${share(m.reverted, m.merged)} (${m.reverted} of ${count(m.merged, 'merged item')} reverted, from the ledger)`
      : 'No merges in the ledger yet';
  const fpy =
    m.verified > 0
      ? `${share(m.first_pass, m.verified)} (${m.first_pass} of ${count(m.verified, 'verified item')} passed their first verification, from the ledger)`
      : 'No verifications in the ledger yet';
  const rows = [
    [
      'Throughput',
      `${count(m.done_last_7_days, 'item')} done in the last 7 days; ${m.done_previous_7_days} in the 7 before`,
      'Change failure rate',
      cfr,
    ],
    [
      'Lead time, planned to done',
      m.lead_time_median_days == null
        ? 'No item done in the last 30 days'
        : `Median ${m.lead_time_median_days.toFixed(1)} days, over ${count(m.lead_time_items, 'item')} done in the last 30 days`,
      'First-pass yield',
      fpy,
    ],
    [
      'Work in progress',
      `${count(m.in_progress, 'item')} in progress now`,
      'Blocked',
      `${count(m.blocked, 'planned item')} blocked now`,
    ],
  ]
    .map(
      ([a, b, c, d]) =>
        `<tr><th scope="row" data-label="Measure">${esc(a)}</th><td data-label="Now">${esc(b)}</td><td data-label="Its pair">${esc(c)}</td><td data-label="Pair now">${esc(d)}</td></tr>`,
    )
    .join('');
  return `<h2>Flow</h2>
<p class="muted">Items by stage at the end of each day, from the tracker's committed history${days.length ? `, ${esc(days[0].day)} to ${esc(last?.day ?? '')}` : ''}. Ready and blocked on a past day come from each item's needs as they are now. Milestones are not counted.${shallow ? ' This clone holds only part of the history (a shallow clone): items already done when it starts count as done on its first day, and so in the throughput.' : ''}</p>
${legend}
${svg}
${table}
<h3 class="mg-h">Measures, each beside the one that must not get worse</h3>
<div class="wrap"><table class="stack"><thead><tr><th>Measure</th><th>Now</th><th>Its pair, which must not get worse</th><th>Pair now</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
