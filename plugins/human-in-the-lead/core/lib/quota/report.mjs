// `hitld dashboard` (design parts 12.2 and 12.4): the data, a text digest that fits a phone
// screen, and one static HTML page. The page is self-contained: inline styles and inline SVG, no
// script, no external asset, no network request. It follows the reader's light or dark setting.
// It includes the milestone graph (design part 12.1.2) when the project has a tracker.
//
// Facts, not adjectives: every line states a figure from the ledger or a quota.

import { effectiveEntries, tokensOf } from './usage.mjs';
import { waitingForOwner, waited } from '../merge/owner.mjs';
import { dispatchGate, forecastLine, show } from './gate.mjs';
import { fileHref, milestoneFacts, oneSentence } from '../tracker/files/views.mjs';
import { renderYourMove } from '../dashboard/move.mjs';
import { renderPlan } from '../dashboard/plan.mjs';
import { renderProposals } from '../dashboard/proposals.mjs';
import { fewestCrossings } from '../dashboard/layout.mjs';
import { tokensByItem } from '../tracker/files/milestones.mjs';
import { STATE_LABELS } from '../tracker/files/format.mjs';

/** @typedef {import('../tracker/files/views.mjs').MilestoneGraph} MilestoneGraph */

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
 * Tokens spent per item, from the ledger as the report counts it (corrections applied).
 * @param {Record<string, any>[]} ledger @returns {Map<string, number>}
 */
export const tokensPerItem = (ledger) =>
  tokensByItem(effectiveEntries(ledger).map((e) => ({ item: e.item, tokens: tokensOf(e.tokens) })));

/**
 * @param {object} input
 * @param {Record<string, any>} input.policy
 * @param {Record<string, any>[]} [input.snapshots]
 * @param {Record<string, any>[]} [input.ledger]
 * @param {number} [input.now]
 * @param {number | null} [input.runStartedAt]
 * @param {MilestoneGraph | null} [input.milestones] the milestone graph, or null without a tracker
 * @param {import('../dashboard/work.mjs').WorkModel | null} [input.work] the work model, or null
 *   without a tracker
 */
export function buildReport({
  policy,
  snapshots = [],
  ledger = [],
  now = Date.now(),
  runStartedAt = null,
  milestones = null,
  work = null,
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
    milestones,
    work,
  };
}

/** @typedef {ReturnType<typeof buildReport>} Report */

export const MODE_LABEL = {
  normal: 'Normal dispatch',
  economize: 'Economize',
  critical_path_only: 'Critical path only',
  stop: 'Stopped at the reserve',
};

/**
 * The quota and spend lines on their own: one phone screen, facts only. `hitld dashboard` writes
 * the digest of core/lib/digest, which has the same quota lines beside the owner's questions and
 * news; this is what it falls back to when a project's decisions cannot be read.
 * @param {Report} r @returns {string}
 */
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
 * The roadmap's second layout (HITLD-307): no lanes; linked milestones grouped, each group in
 * columns by longest path with its crossings reduced by barycenter sweeps, the critical path's
 * group first; unlinked milestones in a grid under them. Computed when the page is generated.
 * @param {import('../tracker/files/views.mjs').MilestoneGraphNode[]} board the committed milestones
 * @param {MilestoneGraph} mg
 * @param {(at: Map<string, { x: number, y: number }>) => { edges: string, nodes: string }} draw
 * @param {{ W: number, H: number, GX: number, GY: number }} size
 */
function fewest(board, mg, draw, { W, H, GX, GY }) {
  const ids = board.map((n) => n.id);
  const shown = new Set(ids);
  const { groups, grid } = fewestCrossings(
    ids,
    mg.edges
      .filter((e) => shown.has(e.from) && shown.has(e.to))
      .map((e) => /** @type {[string, string]} */ ([e.from, e.to])),
    { first: mg.critical_path },
  );
  const PAD = 16;
  /** @type {Map<string, { x: number, y: number }>} */
  const at = new Map();
  let top = PAD;
  let cols = 1;
  let crossings = 0;
  for (const g of groups) {
    const rows = Math.max(...g.layers.map((c) => c.length));
    for (const [l, col] of g.layers.entries()) {
      // A column shorter than its group's tallest is centered against it.
      const shift = Math.floor((rows - col.length) / 2);
      for (const [r, id] of col.entries()) {
        at.set(id, { x: PAD + l * (W + GX), y: top + (r + shift) * (H + GY) });
      }
    }
    cols = Math.max(cols, g.layers.length);
    crossings += g.crossings;
    top += rows * (H + GY) + GY * 2;
  }
  const across = Math.max(cols, 3);
  for (const [k, id] of grid.entries()) {
    at.set(id, { x: PAD + (k % across) * (W + GX), y: top + Math.floor(k / across) * (H + GY) });
  }
  if (grid.length) top += Math.ceil(grid.length / across) * (H + GY);
  const width =
    PAD * 2 + (grid.length ? Math.max(cols, Math.min(across, grid.length)) : cols) * (W + GX) - GX;
  const height = top + PAD - GY;
  const { edges, nodes } = draw(at);
  return `<svg class="mg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Milestone map, fewest crossings: ${board.length} milestones in ${groups.length} linked group${groups.length === 1 ? '' : 's'} and ${grid.length} unlinked, ${crossings} crossings">${edges}\n${nodes}</svg>`;
}

/** A milestone's anchor on the page. @param {string} id */
const milestoneAnchor = (id) => `milestone-${id.replace(/[^A-Za-z0-9-]/g, '')}`;
/** A release's anchor on the page. @param {string} id */
const releaseAnchor = (id) => `release-${id.replace(/[^A-Za-z0-9-]/g, '')}`;

/**
 * The CSS that marks the open milestone's box, or the open release's flag, on the board: one rule
 * per milestone and release, since CSS alone cannot match a link to the drawer it opens. A browser
 * without `:has()` shows no mark; the drawer still opens.
 * @param {MilestoneGraph} mg
 */
export function milestoneSectionCss(mg) {
  return [
    ...mg.nodes.map((n) => {
      const a = milestoneAnchor(n.id);
      return `body:has(#${a}:target) a[href="#${a}"] .mg-box{stroke:var(--used);stroke-width:3;fill:var(--sel)}`;
    }),
    ...mg.releases.map((r) => {
      const a = releaseAnchor(r.id);
      return `body:has(#${a}:target) a[href="#${a}"] .mg-flag text{fill:var(--used);font-weight:700}`;
    }),
  ].join('\n');
}

/**
 * A drawer: a panel on the right that opens when it is the page's target (CSS `:target`), with a
 * head (title, a note and a Close link back to the board) and a scrolling body.
 * @param {string} anchor @param {string} title HTML @param {string} note HTML @param {string} body HTML
 */
const drawer = (anchor, title, note, body) =>
  `<section class="drill" id="${anchor}" aria-labelledby="${anchor}-title"><div class="drawer-head"><h3 id="${anchor}-title">${title}</h3><a class="drawer-close" href="#milestones">Close</a><small>${note}</small></div><div class="drawer-body">${body}</div></section>`;

/** Text cut to `max` characters, ending with an ellipsis when cut. @param {string} t @param {number} max */
const cut = (t, max) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`);

/**
 * Words wrapped into at most `lines` lines of at most `width` characters; the last line ends with
 * an ellipsis when the text is longer.
 * @param {string} text @param {number} width @param {number} lines @returns {string[]}
 */
function clamp(text, width, lines) {
  /** @type {string[]} */
  const out = [];
  let line = '';
  const words = text.split(/\s+/).filter(Boolean);
  for (const [k, word] of words.entries()) {
    if (line && line.length + 1 + word.length > width) {
      if (out.length + 1 === lines)
        return [...out, cut(`${line} ${words.slice(k).join(' ')}`, width)];
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(cut(line, width));
  return out;
}

/** The stages a milestone shows in, as the legend names them. */
const STAGES = /** @type {const} */ ([
  ['proposed', 'Proposed'],
  ['waiting', 'Waiting or blocked'],
  ['ready', 'Ready'],
  ['in-flight', 'In flight'],
  ['done', 'Done'],
]);

/**
 * The milestone board as inline SVG, then one panel per milestone with its items (design part
 * 12.1.2). Lanes are projects (long outcomes first), under a lane of release gates at the top; across
 * are steps, a milestone starting once everything it waits on is done. A started milestone is
 * solid with a strip in its stage color on the leading edge; one not started is hollow. Edges are
 * the waits between milestones, thicker for more items behind the wait, dashed with none. Only
 * committed milestones are on the board: proposed and dropped ones are listed under it. Each node
 * is a link to its panel; a panel shows when it is the page's target (CSS `:target`), so a node
 * opens to its items with no script. Every item, milestone and release ID in a panel or on a flag
 * links to its file: on the forge when `fileBase` is known, else by its repository-relative path.
 * A link is a plain anchor; nothing is fetched until it is followed.
 * @param {MilestoneGraph} mg
 * @param {{ fileBase?: string | null }} [where] the forge's address for the repository's files
 */
export function renderMilestoneSection(mg, where = {}) {
  const { board, drawers } = milestoneParts(mg, where);
  return drawers ? `${board}\n${drawers}` : board;
}

/**
 * The milestone board and its drawers apart, so the page can keep the drawers outside its views.
 * @param {MilestoneGraph} mg
 * @param {{ fileBase?: string | null }} [where]
 * @returns {{ board: string, drawers: string }}
 */
export function milestoneParts(mg, { fileBase = null } = {}) {
  /** An ID linked to its file, or the ID alone without one. @param {string} id @param {string | null} path */
  const fileLink = (id, path) =>
    path
      ? `<a class="file" href="${esc(fileHref(path, { base: fileBase }))}">${esc(id)}</a>`
      : esc(id);
  if (!mg.nodes.length) {
    return {
      board:
        '<h2 id="milestones">Milestones</h2>\n<p class="muted">No milestones in the tracker.</p>',
      drawers: '',
    };
  }
  const LABEL = 150; // the lane names
  const W = 230;
  const H = 122;
  const GX = 64;
  const GY = 14;
  const PAD = 12; // inside a lane, above and below its nodes
  const HEAD = 26; // the step labels
  const FLAG = 22; // one release flag's height
  const board = mg.nodes.filter((n) => n.state === 'planned' || n.state === 'done');
  const steps = Math.max(
    1,
    ...board.map((n) => n.layer + 1),
    ...mg.releases.map((r) => r.layer + 1),
  );
  const colX = (/** @type {number} */ step) => LABEL + GX / 2 + step * (W + GX);
  // Release flags, in the model's order (by step, then version). A done release stands at the
  // left edge, before the first step; an open one just after its step's milestones. Releases at
  // the same place stand a little apart, earlier versions to the left; each has its own row, so
  // no label covers another.
  /** @type {Map<number, number>} */
  const atStep = new Map();
  /** @type {Map<string, number>} */
  const flagX = new Map();
  for (const r of mg.releases) {
    const k = atStep.get(r.layer) ?? 0;
    atStep.set(r.layer, k + 1);
    flagX.set(r.id, (r.layer < 0 ? LABEL + 8 : colX(r.layer) + W + 10) + k * 14);
  }
  const label = (/** @type {string} */ v) => Math.ceil(v.length * 7) + 24;
  // Room for every release's label, which runs right of its flag.
  const width = Math.max(
    colX(steps) - GX / 2,
    ...mg.releases.map((r) => /** @type {number} */ (flagX.get(r.id)) + label(r.release)),
  );

  // Each lane's height: its fullest step.
  /** @type {{ title: string, top: number, height: number, release?: boolean }[]} */
  const lanes = [];
  let top = HEAD;
  // The release gates first, at the top (the owner's choice), aligned to the steps below.
  /** @type {Map<string, { x: number, y: number }>} */
  const flagAt = new Map();
  if (mg.releases.length) {
    for (const [row, r] of mg.releases.entries()) {
      flagAt.set(r.id, { x: /** @type {number} */ (flagX.get(r.id)), y: top + PAD + row * FLAG });
    }
    const height = PAD * 2 + mg.releases.length * FLAG;
    lanes.push({ title: 'Releases', top, height, release: true });
    top += height;
  }
  /** @type {Map<string, { x: number, y: number }>} */
  const at = new Map();
  for (const lane of mg.lanes) {
    const own = board.filter((n) => n.project === lane.id);
    if (!own.length) continue;
    /** @type {number[]} */
    const filled = [];
    for (const n of own) {
      const k = filled[n.layer] ?? 0;
      filled[n.layer] = k + 1;
      at.set(n.id, { x: colX(n.layer), y: top + PAD + k * (H + GY) });
    }
    const most = Math.max(...filled.filter((x) => x !== undefined));
    const height = PAD * 2 + most * H + (most - 1) * GY;
    lanes.push({ title: lane.title, top, height });
    top += height;
  }
  const height = top;

  const laneRects = lanes
    .map(
      (l, k) =>
        `<rect class="mg-lane${k % 2 ? ' zebra' : ''}" x="0" y="${l.top}" width="${width}" height="${l.height}"/>${clamp(
          l.title,
          22,
          3,
        )
          .map(
            (t, line) =>
              `<text class="mg-lane-name" x="8" y="${l.top + PAD + 12 + line * 15}">${esc(t)}</text>`,
          )
          .join('')}`,
    )
    .join('');
  const ticks = Array.from({ length: steps }, (_, k) => {
    const x = colX(k) - GX / 2;
    return `<text class="mg-step" x="${colX(k) + W / 2}" y="17" text-anchor="middle">Step ${k + 1}</text>${k ? `<line class="mg-tick" x1="${x}" x2="${x}" y1="${HEAD - 4}" y2="${height}"/>` : ''}`;
  }).join('');

  /**
   * The waits and the milestone boxes, at the given places: the same drawing for both layouts.
   * @param {Map<string, { x: number, y: number }>} at
   */
  const draw = (at) => {
    const edges = mg.edges
      .map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return '';
        const [x1, y1, x2, y2] = [a.x + W, a.y + H / 2, b.x, b.y + H / 2];
        const cls = `${e.critical ? ' critical' : ''}${e.items ? '' : ' direct'}`;
        const stroke = (1.25 + Math.min(e.items, 10) * 0.35).toFixed(2);
        const label = `${e.to} waits on ${e.from}: ${e.items ? `${e.items} item(s) behind the wait` : 'directly, no items behind it'}${e.critical ? ', on the critical path' : ''}`;
        // The curve ends level, so its arrowhead is drawn pointing right: no marker, no url().
        return `<g><title>${esc(label)}</title><path class="mg-edge${cls}" style="stroke-width:${stroke}" d="M${x1} ${y1}C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2 - 7} ${y2}"/><path class="mg-head${e.critical ? ' critical' : ''}" d="M${x2 - 8} ${y2 - 4}L${x2} ${y2}L${x2 - 8} ${y2 + 4}z"/></g>`;
      })
      .join('');

    const nodes = board
      .map((n) => {
        const { x, y } = /** @type {{ x: number, y: number }} */ (at.get(n.id));
        const f = milestoneFacts(n);
        const started = n.stage === 'in-flight' || n.stage === 'done';
        const badges = [
          ...(n.holds.decisions.length
            ? [
                [
                  'decision',
                  `${n.holds.decisions.length} decision${n.holds.decisions.length > 1 ? 's' : ''}`,
                  n.holds.decisions,
                ],
              ]
            : []),
          ...(n.holds.external.length
            ? [
                [
                  'external',
                  `${n.holds.external.length} outside wait${n.holds.external.length > 1 ? 's' : ''}`,
                  n.holds.external,
                ],
              ]
            : []),
        ];
        // The releases it lands before, as pills on the progress bar's row, which they shorten.
        let rx = x + W - 8;
        const releasePills = mg.releases
          .filter((r) => r.milestones.includes(n.id))
          .map((r) => {
            const w = Math.round(r.release.length * 5.6 + 10);
            rx -= w;
            const pill = `<g class="mg-badge release"><title>${esc(`Lands before release ${r.release} (${r.id})`)}</title><rect x="${rx}" y="${y + 57}" width="${w}" height="14" rx="7"/><text x="${rx + w / 2}" y="${y + 67.5}" text-anchor="middle">${esc(r.release)}</text></g>`;
            rx -= 4;
            return pill;
          })
          .join('');
        let right = x + W - 8;
        const pills = badges
          .map(([cls, text, ids]) => {
            const w = Math.round(String(text).length * 5.6 + 10);
            right -= w;
            const pill = `<g class="mg-badge ${cls}"><title>${esc(`Held up by ${Array.isArray(ids) ? ids.join(', ') : ''}`)}</title><rect x="${right}" y="${y + 7}" width="${w}" height="15" rx="7.5"/><text x="${right + w / 2}" y="${y + 18}" text-anchor="middle">${esc(text)}</text></g>`;
            right -= 4;
            return pill;
          })
          .join('');
        const nameRoom = Math.max(8, Math.floor((right - (x + (started ? 12 : 22))) / 7.2));
        const outcome = clamp(oneSentence(n.outcome, 200) || 'No outcome yet', 34, 2);
        const share = n.constraints.total ? n.constraints.done / n.constraints.total : 0;
        const bar = rx < x + W - 8 ? rx - (x + 12) - 6 : W - 24;
        const label = `${n.id} ${n.title}, ${STAGES.find(([k]) => k === n.stage)?.[1] ?? n.stage}${n.critical ? ', on the critical path' : ''}${n.in_cycle ? ', in a loop of needs' : ''}: ${oneSentence(n.outcome) || 'no outcome yet'}; ${n.in_progress} in progress, ${f.constraints}; ${f.tokens}; ${f.check}`;
        const cls = `mg-node ${n.stage} ${started ? 'started' : 'hollow'}${n.critical ? ' critical' : ''}${n.in_cycle ? ' loop' : ''}`;
        return `<a href="#${milestoneAnchor(n.id)}" aria-label="${esc(label)}"><g class="${cls}"><title>${esc(label)}</title><rect class="mg-box" x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>${started ? `<rect class="mg-strip" x="${x + 1}" y="${y + 1}" width="4" height="${H - 2}" rx="2"/>` : `<circle class="mg-dot" cx="${x + 13}" cy="${y + 15}" r="4"/>`}
  <text x="${x + (started ? 12 : 22)}" y="${y + 19}" class="mg-title">${esc(cut(`${n.id} ${n.title}`, nameRoom))}</text>${pills}${outcome
    .map((t, k) => `<text x="${x + 12}" y="${y + 37 + k * 14}" class="mg-outcome">${esc(t)}</text>`)
    .join(
      '',
    )}<rect class="mg-bar" x="${x + 12}" y="${y + 62}" width="${bar}" height="4" rx="2"/><rect class="mg-bar-done" x="${x + 12}" y="${y + 62}" width="${(bar * share).toFixed(1)}" height="4" rx="2"/>
  <text x="${x + 12}" y="${y + 81}">${esc(`${n.in_progress} in progress, ${f.constraints}`)}</text><text x="${x + 12}" y="${y + 97}" class="mg-outcome">${esc(cut(f.tokens, 40))}</text><text x="${x + 12}" y="${y + 113}" class="mg-outcome">${esc(f.check)}</text>${releasePills}</g></a>`;
      })
      .join('\n');
    return { edges, nodes };
  };
  const { edges, nodes } = draw(at);

  const releaseLane = lanes.find((l) => l.release);
  const releaseBottom = releaseLane ? releaseLane.top + releaseLane.height : 0;
  // Each open release's rule runs down through the milestone lanes, behind the boxes: in the
  // flag's color within the Releases lane, then dashed and muted, so what lands before it is to its
  // left. A done release's rule stays in the Releases lane: nothing on the board lands before it.
  const rules = mg.releases
    .map((r) => {
      const { x, y } = /** @type {{ x: number, y: number }} */ (flagAt.get(r.id));
      const done = r.state === 'done';
      return `<g class="mg-rule ${done ? 'done' : 'open'}"><line class="mg-rule-top" x1="${x}" x2="${x}" y1="${y + 12}" y2="${releaseBottom}"/>${done ? '' : `<line class="mg-rule-down" x1="${x}" x2="${x}" y1="${releaseBottom}" y2="${height}"/>`}</g>`;
    })
    .join('');
  const flags = mg.releases
    .map((r) => {
      const { x, y } = /** @type {{ x: number, y: number }} */ (flagAt.get(r.id));
      const before = r.milestones.length ? `; after ${r.milestones.join(', ')}` : '';
      return `<a href="#${releaseAnchor(r.id)}" aria-label="${esc(`Release ${r.release}: ${r.id} ${r.title}`)}"><g class="mg-flag ${r.state === 'done' ? 'done' : 'open'}"><title>${esc(`Release gate ${r.release}: ${r.id} ${r.title} (${STATE_LABELS[r.state] ?? r.state})${before}`)}</title><line x1="${x}" x2="${x}" y1="${y + 2}" y2="${y + 14}"/><path d="M${x + 1} ${y + 2}L${x + 11} ${y + 6}L${x + 1} ${y + 10}z"/><text x="${x + 16}" y="${y + 11}">${esc(r.release)}</text></g></a>`;
    })
    .join('');

  const svg = `<svg class="mg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Milestone board: ${board.length} milestones in ${lanes.length} lanes over ${steps} steps, ${mg.edges.length} waits between them">${laneRects}${ticks}${rules}${edges}\n${nodes}${flags}</svg>`;
  const path = mg.critical_path.length
    ? `Critical path: ${mg.critical_path.map(esc).join(' → ')}.`
    : 'No critical path: no open milestone has estimate tokens remaining.';
  const legend = `<div class="mg-legend">${STAGES.map(([k, name]) => `<span><i class="sw ${k}"></i>${name}</span>`).join('')}<span><i class="sw critical"></i>Critical path</span><span>Thicker wait: more items behind it; dashed: none</span><span>Dashed border: in a loop of needs</span><span>Release rule: what lands before a release is to its left; the release's version marks the milestones it needs</span></div>`;
  /** A milestone's name, linked to its panel. @param {import('../tracker/files/views.mjs').MilestoneGraphNode} n */
  const idea = (n) => `<a href="#${milestoneAnchor(n.id)}">${esc(n.id)} ${esc(n.title)}</a>`;
  /** What stands between a proposed milestone and committing it. @param {import('../tracker/files/views.mjs').MilestoneGraphNode} n */
  const between = (n) => {
    if (n.holds.owner_decisions.length) {
      return `Waits on your answer: ${n.holds.owner_decisions.map(esc).join(', ')}`;
    }
    const others = [
      ...n.holds.decisions.filter((id) => !n.holds.owner_decisions.includes(id)),
      ...n.waits,
      ...n.holds.external,
    ];
    return others.length
      ? `Waits on other items: ${[...new Set(others)].map(esc).join(', ')}`
      : 'Ready to commit';
  };
  const proposed = mg.nodes.filter((n) => n.state === 'proposed');
  // Whole projects of proposals first, then the lone proposed milestones.
  const proposedLanes = mg.lanes.filter(
    (l) => l.state === 'proposed' && proposed.some((n) => n.project === l.id),
  );
  const lone = proposed.filter((n) => !proposedLanes.some((l) => l.id === n.project));
  const propRow = (/** @type {import('../tracker/files/views.mjs').MilestoneGraphNode} */ n) =>
    `<tr><td data-label="Idea">${idea(n)}</td><td data-label="Before committing">${between(n)}</td><td data-label="Waiting on it">${n.waiting_on_it}</td></tr>`;
  const groups = [
    ...proposedLanes.map(
      (l) =>
        `<tr class="mg-group"><th colspan="3">${esc(l.id ?? '')} ${esc(l.title)}, a proposed project</th></tr>${proposed
          .filter((n) => n.project === l.id)
          .map(propRow)
          .join('')}`,
    ),
    ...(lone.length
      ? [
          `${proposedLanes.length ? '<tr class="mg-group"><th colspan="3">Lone milestones</th></tr>' : ''}${lone.map(propRow).join('')}`,
        ]
      : []),
  ];
  const proposals = proposed.length
    ? `<h3 class="mg-h">Proposed milestones, not on the board</h3><div class="wrap"><table class="mg-props"><thead><tr><th>Idea</th><th>What stands between it and committing</th><th>Open items and milestones waiting on it</th></tr></thead><tbody>${groups.join('')}</tbody></table></div>`
    : '';
  const dropped = mg.nodes.filter((n) => n.state === 'dropped');
  const droppedTable = dropped.length
    ? `<h3 class="mg-h">Dropped milestones</h3><div class="wrap"><table class="mg-props small"><thead><tr><th>Idea</th><th>Constraints</th></tr></thead><tbody>${dropped
        .map(
          (n) =>
            `<tr><td data-label="Idea">${idea(n)}</td><td data-label="Constraints">${esc(milestoneFacts(n).constraints)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';
  const panels = mg.nodes
    .map((n) => {
      const f = milestoneFacts(n);
      const items = n.items.length
        ? `<div class="wrap"><table style="min-width:0"><thead><tr><th>Item</th><th>As</th><th>State</th><th>Critical path</th></tr></thead><tbody>${n.items
            .map(
              (i) =>
                `<tr><td>${fileLink(i.id, i.path)} ${esc(i.title)}</td><td>${i.role}</td><td>${esc(STATE_LABELS[i.state] ?? i.state)}</td><td>${i.critical ? 'yes' : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="muted">No constraints or contributions yet.</p>';
      const holds = [...n.holds.decisions, ...n.holds.external];
      return drawer(
        milestoneAnchor(n.id),
        `${fileLink(n.id, n.path)} ${esc(n.title)}`,
        `${esc(STATE_LABELS[n.state] ?? n.state)}${n.critical ? ', on the critical path' : ''}`,
        `<p>${esc(n.outcome ?? 'No outcome yet.')}</p><p class="muted">${n.in_progress} in progress; constraints ${esc(f.constraints)}; ${esc(f.tokens)}; ${esc(f.check)}.${holds.length ? ` Held up by ${holds.map(esc).join(', ')}.` : ''}</p>${items}<p class="muted">The items' own needs are in the item graph, work/views/items-graph.md in the repository.</p>`,
      );
    })
    .join('\n');
  const stateOf = (/** @type {string} */ st) => esc(STATE_LABELS[st] ?? st);
  const releaseDrawers = mg.releases
    .map((r) => {
      const before = r.milestones
        .map((id) => mg.nodes.find((n) => n.id === id))
        .filter((n) => n !== undefined);
      const landed = before.filter((n) => n.state === 'done').length;
      const milestones = before.length
        ? `<h4>Milestones that land before it (${landed} of ${before.length} done)</h4><div class="wrap"><table style="min-width:0"><thead><tr><th>Milestone</th><th>State</th></tr></thead><tbody>${before
            .map(
              (n) =>
                `<tr><td><a href="#${milestoneAnchor(n.id)}">${esc(n.id)}</a> ${esc(n.title)}</td><td>${stateOf(n.state)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="muted">No milestone lands before it.</p>';
      const needs = r.needs.length
        ? `<h4>What it needs (${r.needs.filter((x) => x.state === 'done').length} of ${r.needs.length} done)</h4><div class="wrap"><table style="min-width:0"><thead><tr><th>Item</th><th>State</th></tr></thead><tbody>${r.needs
            .map(
              (x) =>
                `<tr><td>${fileLink(x.id, x.path)} ${esc(x.title)}</td><td>${stateOf(x.state)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="muted">It needs nothing.</p>';
      return drawer(
        releaseAnchor(r.id),
        `Release ${esc(r.release)}: ${fileLink(r.id, r.path)} ${esc(r.title)}`,
        `${stateOf(r.state)}${r.state === 'done' ? ', released' : ''}`,
        `${milestones}${needs}`,
      );
    })
    .join('\n');
  return {
    board: `<h2 id="milestones">Milestones</h2>
<p class="muted">${path} Open a milestone to see its items.</p>
${legend}
<div class="layouts" role="radiogroup" aria-label="Layout"><input class="tab-input" type="radio" name="roadmap-layout" id="rm-lanes" checked><label for="rm-lanes">By project</label><input class="tab-input" type="radio" name="roadmap-layout" id="rm-fewest"><label for="rm-fewest">Fewest crossings</label>
<div class="wrap rm-lanes">${svg}</div>
<div class="wrap rm-fewest">${fewest(board, mg, draw, { W, H, GX, GY })}</div></div>
${proposals}${droppedTable}`,
    drawers: `<a class="drawer-backdrop" href="#milestones" aria-label="Close" tabindex="-1"></a>
${panels}
${releaseDrawers}`,
  };
}

/**
 * When and where the page's data was read: the tracker (at a commit, on a branch) and the private
 * store on this machine. A page generated in one container shows that container's store.
 * @param {Report} r
 */
function readNote(r) {
  const at = r.work?.source;
  const tracker = r.work
    ? ` from the tracker in this repository${at?.commit ? ` at commit ${at.commit}` : ''}${at?.branch ? ` on ${at.branch}` : ''},`
    : '';
  return `Read ${r.generated_at}${tracker} and from the ledger and quotas in the private store on the machine that generated it. Metrics schema ${r.metrics_schema_version}. Local data only.`;
}

/**
 * The views as tabs that need no script: one radio input per view, before the header, and a label
 * for each in the header's nav; CSS shows the checked view's section. The first view is checked.
 * Without CSS every view shows, one after another.
 * @param {{ id: string, label: string, html: string }[]} views
 */
export function viewTabs(views) {
  return {
    inputs: views
      .map(
        (v, k) =>
          `<input class="tab-input" type="radio" name="view" id="tab-${v.id}" aria-controls="${v.id}"${k ? '' : ' checked'}>`,
      )
      .join('\n'),
    nav: `<nav class="tabs" aria-label="Views">${views.map((v) => `<label for="tab-${v.id}">${esc(v.label)}</label>`).join('')}</nav>`,
    sections: views
      .map(
        (v) =>
          `<section class="view" id="${v.id}" aria-label="${esc(v.label)}">\n${v.html}\n</section>`,
      )
      .join('\n'),
    css: views
      .map(
        (v) =>
          `#tab-${v.id}:checked~main #${v.id}{display:block}#tab-${v.id}:checked~header label[for="tab-${v.id}"]{color:var(--fg);border-bottom-color:var(--used)}#tab-${v.id}:focus-visible~header label[for="tab-${v.id}"]{outline:2px solid var(--used);outline-offset:2px}`,
      )
      .join('\n'),
  };
}

/**
 * The static report page. @param {Report} r @param {Record<string, any>} policy
 * @param {{ fileBase?: string | null }} [where] the forge's address for the repository's files, for
 *   the links to tracker files
 * @returns {string}
 */
export function renderHtml(r, policy, { fileBase = null } = {}) {
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
  const merges = r.waiting_for_owner.length
    ? `<h2>Waiting for your merge</h2><ul>${r.waiting_for_owner.map((w) => `<li>${esc(w.item)} on ${esc(w.branch ?? 'no branch')}, waiting ${esc(waited(w.waited_ms))}</li>`).join('')}</ul>`
    : '';
  const spend = `<h2>Quotas</h2>
<div class="wrap"><table>
<thead><tr><th>Limit</th><th>Used (bar: reserve shaded, marks at economize and critical path)</th><th>Confidence</th><th>Burn</th><th>Reserve reached</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
${r.work ? '' : merges}
${r.thresholds.length ? `<h2>Thresholds</h2><ul>${r.thresholds.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
<h2>Ledger</h2>
<p>${l.entries} events, ${l.tokens} tokens, ${l.items_merged} items merged${l.tokens_per_merged_item == null ? '' : `, ${l.tokens_per_merged_item} tokens per merged item`}.</p>
<div class="wrap"><table style="min-width:0"><thead><tr><th>Events</th><th>Tokens by model</th><th>Tokens by tier</th></tr></thead><tbody><tr><td><ul>${kv(l.events)}</ul></td><td><ul>${kv(l.tokens_by_model)}</ul></td><td><ul>${kv(l.tokens_by_tier)}</ul></td></tr></tbody></table></div>`;
  const roadmap = r.milestones
    ? milestoneParts(r.milestones, { fileBase })
    : { board: '', drawers: '' };
  const tabs = viewTabs([
    ...(r.work
      ? [
          {
            id: 'move',
            label: 'Your move',
            html: renderYourMove(r.work.move, r.waiting_for_owner, { fileBase }),
          },
        ]
      : []),
    ...(r.milestones ? [{ id: 'roadmap', label: 'Roadmap', html: roadmap.board }] : []),
    ...(r.work
      ? [
          {
            id: 'plan',
            label: 'Plan',
            html: renderPlan(r.work, policy.reports ?? {}, { fileBase }),
          },
          { id: 'proposals', label: 'Proposals', html: renderProposals(r.work, { fileBase }) },
        ]
      : []),
    { id: 'spend', label: 'Quota and spend', html: spend },
  ]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(r.project)}: quotas and spend</title>
<style>
:root{--sel:#eaf1fb;--st-proposed:#c4c8ce;--st-waiting:#d14348;--st-ready:#2457c2;--st-flight:#b08cf6;--st-done:#45c486;--zebra:#f1f2f4;--bg:#fbfbfa;--fg:#1c1d20;--muted:#60646c;--line:#d9dbe0;--card:#fff;--used:#2f6fb3;--reserve:#e5b64a55;--track:#e9eaee;--mark:#8a8f98;--stop:#b3261e;--stop-bg:#fbe9e7;--warn-bg:#fff4dc}
@media (prefers-color-scheme:dark){:root{--sel:#1d2a3a;--st-proposed:#62676f;--st-waiting:#b8363d;--st-ready:#2f68d2;--st-flight:#9b7fe6;--st-done:#2fac6a;--zebra:#1a1b1e;--bg:#141517;--fg:#e8e9ec;--muted:#9a9fa8;--line:#34373d;--card:#1b1c1f;--used:#6aa5e6;--reserve:#d9a53a44;--track:#2a2c31;--mark:#8a8f98;--stop:#ff8a80;--stop-bg:#3a1f1c;--warn-bg:#3a3018}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main,header.top{max-width:64rem;margin:0 auto;padding:0 1rem}main{padding-bottom:3rem}header.top{padding-top:1.5rem}
.tab-input{position:absolute;opacity:0;pointer-events:none}.view{display:none}
.tabs{display:flex;flex-wrap:wrap;gap:.25rem 1rem;border-bottom:1px solid var(--line);margin-top:.75rem}.tabs label{cursor:pointer;padding:.4rem .1rem;color:var(--muted);border-bottom:3px solid transparent;font-weight:600}.tabs label:hover{color:var(--fg)}
.tiles{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0 1rem}.tile{flex:1 1 7rem;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;color:var(--muted);text-decoration:none;font-size:.85rem}.tile b{display:block;font-size:1.5rem;color:var(--fg)}
.move h3{font-size:1rem;margin:1.25rem 0 .25rem}.num{display:inline-block;min-width:1.6rem;padding:0 .35rem;border-radius:4px;background:var(--track);text-align:center}
ol.rows{list-style:none;margin:0;padding:0}ol.rows li{padding:.35rem 0;border-bottom:1px solid var(--line)}.meta{color:var(--muted);font-size:.85rem}
.pill{display:inline-block;font-size:.75rem;padding:0 .45rem;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-left:.25rem}.pill.crit{border-color:var(--used);color:var(--used)}.pill.warn{border-color:#d9a53a;background:var(--warn-bg)}
code{font-size:.85em;overflow-wrap:anywhere}
.pg-box{fill:var(--card);stroke:var(--line)}.pg-strip,.sw.st-blocked,.sw.st-ready,.sw.st-in-progress,.sw.st-done,.sw.st-proposed{fill:var(--st);background:var(--st)}.st-proposed{--st:var(--st-proposed)}.st-blocked{--st:var(--st-waiting)}.st-ready{--st:var(--st-ready)}.st-in-progress{--st:var(--st-flight)}.st-done{--st:var(--st-done)}
.pg-node.critical .pg-box{stroke:var(--used);stroke-width:2}.pg-node.st-ready .pg-box{stroke:var(--st-ready)}.pg-node.st-done text{fill:var(--muted)}.pg .pg-id{font-weight:600}.pg .pg-stage{font-size:10px;fill:var(--st)}.pg a:hover .pg-box,.pg a:focus-visible .pg-box{stroke:var(--used);stroke-width:2.5}
.layouts{display:flex;flex-wrap:wrap;gap:.25rem .5rem;align-items:center}.layouts>label{cursor:pointer;font-size:.85rem;padding:.15rem .6rem;border:1px solid var(--line);border-radius:999px;color:var(--muted)}#rm-lanes:checked+label,#rm-fewest:checked+label{border-color:var(--used);color:var(--fg)}#rm-lanes:focus-visible+label,#rm-fewest:focus-visible+label{outline:2px solid var(--used)}.layouts>.wrap{flex-basis:100%}.rm-fewest{display:none}#rm-fewest:checked~.rm-fewest{display:block}#rm-fewest:checked~.rm-lanes{display:none}
.pg-sep{stroke:var(--line);stroke-dasharray:2 3}.plan-list{margin:.75rem 0}.plan-list summary{cursor:pointer;color:var(--muted)}.plan-list h4{font-size:.9rem;margin:.75rem 0 .25rem}.plan-list li{margin:.15rem 0}table.stack{min-width:0}
@media (max-width:600px){table.stack thead{display:none}table.stack tr{display:block;border-bottom:1px solid var(--line);padding:.4rem 0}table.stack td{display:block;border:0;padding:.1rem .2rem}table.stack td[data-label]::before{content:attr(data-label) ": ";color:var(--muted);font-size:.8rem}}
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
.mg{display:block;font:12px system-ui,sans-serif}.mg text{fill:var(--fg)}.mg-lane{fill:var(--bg)}.mg-lane.zebra{fill:var(--zebra)}.mg-lane-name{font-weight:600;fill:var(--muted)}.mg-step{fill:var(--muted)}.mg-tick{stroke:var(--line);stroke-dasharray:4 4}
.mg-box{stroke:var(--mark);stroke-width:1}.started .mg-box{fill:var(--card)}.hollow .mg-box{fill:transparent;stroke:var(--line)}.mg-node.critical .mg-box{stroke:var(--used);stroke-width:2}.mg-node.loop .mg-box{stroke-dasharray:5 3}.mg-title{font-weight:600}.mg .mg-outcome{fill:var(--muted)}
.mg a{cursor:pointer}.mg a:focus{outline:none}.mg a:focus-visible .mg-box,.mg a:hover .mg-box{stroke:var(--used);stroke-width:2.5}.mg a:focus-visible .mg-box{stroke-width:3}.mg a:hover .mg-flag text,.mg a:focus-visible .mg-flag text{text-decoration:underline;fill:var(--used)}a.file{font-weight:600}a:focus-visible{outline:2px solid var(--used);outline-offset:2px}.mg-bar{fill:var(--track)}.mg-bar-done{fill:var(--st-done)}
.mg-strip,.mg-dot{fill:var(--st)}.mg-node.proposed{--st:var(--st-proposed)}.mg-node.waiting{--st:var(--st-waiting)}.mg-node.ready{--st:var(--st-ready)}.mg-node.in-flight{--st:var(--st-flight)}.mg-node.done{--st:var(--st-done)}
.mg-badge rect{fill:var(--warn-bg);stroke:#d9a53a}.mg-badge.external rect{fill:var(--track);stroke:var(--mark)}.mg .mg-badge text{font-size:10px}
.mg-edge{fill:none;stroke:var(--mark)}.mg-edge.direct{stroke-dasharray:4 3}.mg-edge.critical{stroke:var(--used)}.mg-head{fill:var(--mark)}.mg-head.critical{fill:var(--used)}
.mg-flag line{stroke:var(--mark);stroke-width:1.5}.mg-flag path{fill:var(--st-ready)}.mg-flag.done path{fill:var(--st-done)}
.mg-rule-top{stroke:var(--st-ready);stroke-width:1.5}.mg-rule.done .mg-rule-top{stroke:var(--st-done)}.mg-rule-down{stroke:var(--mark);stroke-width:1;stroke-dasharray:3 4}.mg-badge.release rect{fill:var(--card);stroke:var(--st-ready)}
.mg-h{font-size:.95rem;margin:1.25rem 0 .25rem}table.mg-props{min-width:0}.mg-props .mg-group th{background:var(--track);font-size:.85rem}
@media (max-width:600px){.mg-props thead{display:none}.mg-props tr{display:block;border-bottom:1px solid var(--line);padding:.4rem 0}.mg-props td,.mg-props th{display:block;border:0;padding:.1rem .2rem}.mg-props td[data-label]::before{content:attr(data-label) ": ";color:var(--muted);font-size:.8rem}}
.mg-legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.8rem;color:var(--muted);margin:.25rem 0 .5rem}.mg-legend .sw{display:inline-block;width:.8rem;height:.8rem;border-radius:3px;margin-right:.3rem;vertical-align:-.1rem}
.sw.proposed{background:var(--st-proposed)}.sw.waiting{background:var(--st-waiting)}.sw.ready{background:var(--st-ready)}.sw.in-flight{background:var(--st-flight)}.sw.done{background:var(--st-done)}.sw.critical{background:none;border:2px solid var(--used)}
.drill{display:none;box-sizing:border-box;position:fixed;top:0;right:0;bottom:0;width:min(560px,100%);overflow-y:auto;background:var(--card);border-left:1px solid var(--line);border-radius:10px 0 0 10px;box-shadow:-8px 0 28px #0000002e;z-index:30}.drill:target{display:block}
.drawer-head{position:sticky;top:0;z-index:1;background:var(--card);border-bottom:1px solid var(--line);padding:.75rem 1rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem}.drawer-head h3{margin:0;font-size:1rem;flex:1 1 0}.drawer-head small{flex-basis:100%}
.drawer-close{margin-left:auto;padding:.15rem .7rem;border:1px solid var(--line);border-radius:6px;color:var(--fg);text-decoration:none;font-size:.9rem}.drawer-close:hover{border-color:var(--used)}.drawer-body{padding:.5rem 1rem 1.5rem}.drawer-body h4{font-size:.9rem;margin:1rem 0 .25rem}
.drawer-backdrop{display:none}body:has(.drill:target) .drawer-backdrop{display:block;position:fixed;inset:0;z-index:20;background:transparent}
.mg{position:relative;z-index:25;pointer-events:none}.mg a{pointer-events:auto}.mg-props a{position:relative;z-index:25}
@media (min-width:1100px){body:has(.drill:target){padding-right:min(560px,100%)}}
@media (max-width:1099px){body:has(.drill:target) .drawer-backdrop{background:#00000066}.mg,.mg-props a{z-index:auto}}
.track{fill:var(--track)}.reserve{fill:var(--reserve)}.used{fill:var(--used)}.mark{stroke:var(--mark);stroke-width:1}.stop{stroke:var(--stop);stroke-width:2}
ul{margin:.25rem 0;padding-left:1.2rem}
${r.milestones ? milestoneSectionCss(r.milestones) : ''}
${tabs.css}
</style>
</head>
<body>
${tabs.inputs}
<header class="top">
<h1>${esc(r.project)}: work, quotas and spend</h1>
<div class="muted">${esc(readNote(r))}</div>
<div class="status ${esc(r.gate.mode)}"><strong>${esc(MODE_LABEL[r.gate.mode])}</strong>${esc(r.gate.reason)}${r.gate.forecast ? `<small>Forecast that triggered it: ${esc(r.gate.forecast)}</small>` : ''}<small>Ordinary items: ${r.gate.allow_ordinary ? 'dispatch' : 'wait'}. Critical-path items: ${r.gate.allow_critical_path ? 'dispatch' : 'wait'}.${r.gate.ask_owner ? ' The owner is asked before this hard limit is passed.' : ''}</small></div>
${tabs.nav}
</header>
<main>
${tabs.sections}
</main>
${roadmap.drawers}
</body>
</html>
`;
}
