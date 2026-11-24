// Sizing ready items into tiers 0 to 3 (design part 5.1), with the token estimate. Pure: every
// input comes from the item, the policy and the history the caller derives from the ledger.
//
// The rule, in order:
//   1. tier_override on the item wins (the owner's override).
//   2. Base tier: 0 when every touches glob is an inline path (dispatch.inline_globs, or the
//      tracker's own folder, tracker.json work_dir: a tracker edit); 3 when the item has
//      no plan at all; 1 when "Done when" is executable, the plan is specific to files, and the
//      touches are few; otherwise 2.
//   3. Up one for blast radius: more than one area, or a sensitive path. At most 3.
//   4. Down one for familiar ground: the lower tier's first-pass yield on this area and kind meets
//      policy.dispatch.familiar_min_yield over enough samples. Never below 1 for dispatched work.
//
// Who reviews the output does not set the tier: an item in one of policy.dispatch.owner_review_areas
// carries owner_review, and its brief asks for a review pack for the owner (design part 7.6).

import {
  allWithin,
  areasTouched,
  inlineGlobs,
  doneWhenExecutable,
  globsOverlap,
  planRef,
  planSpecific,
} from './item.mjs';
import { effectiveEvents, sourceKind } from '../ledger/summary.mjs';
import { ESTIMATE_SETTINGS, estimateSettings } from '../ledger/ledger.mjs';

// The estimator's settings live beside the start estimate, which reads them too (HITLD-450).
export { ESTIMATE_SETTINGS, estimateSettings };

/**
 * @typedef {import('./item.mjs').Item} Item
 *
 * @typedef {object} HistoryEntry one finished dispatch, for estimates and familiar ground
 * @property {string | null} area
 * @property {string | null} kind
 * @property {number} tier
 * @property {number | null} tokens actual tokens, from the completion notice
 * @property {boolean} [measured] the figure was measured by the harness, not typed by hand
 * @property {boolean | null} firstPass whether its first verification passed; false for a
 *   dispatch the watchdog found stalled, which was not a clean first pass whatever followed
 * @property {boolean} [stalled] the watchdog found it stalled (not cut off by a usage limit)
 *
 * @typedef {object} Sizing
 * @property {string} item
 * @property {0 | 1 | 2 | 3} tier
 * @property {string[]} reasons why, in order, one line each
 * @property {'orchestrator' | 'background' | 'session'} runs_as
 * @property {string} model the model class from policy.tiers: own, small or large
 * @property {string} effort
 * @property {number} estimate_tokens
 * @property {'item' | 'history' | 'default'} estimate_source
 * @property {number} [estimate_samples] how many similar past completions with a token count there
 *   were; their median sets the estimate only from dispatch.estimate_min_samples of them, and only
 *   when it is within dispatch.estimate_max_multiple of the tier's default
 * @property {string} [estimate_basis] where the estimate came from and how many completions it rests
 *   on, in words: what the plan, `ready`, the brief and the quota gate say beside the figure
 * @property {string} [estimate_note] set when the estimate fell back to the default although there
 *   were similar completions, or kept a figure far above the default: the plan says it
 * @property {string[]} areas
 * @property {string | null} owner_review the area whose output the owner reviews in person, when
 *   there is one: the brief asks for a review pack
 */

/** @param {number[]} xs */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Size one item.
 * @param {Item} item
 * @param {Record<string, any>} policy the effective policy
 * @param {HistoryEntry[]} [history]
 * @param {{ workDir?: string }} [o] workDir: the tracker's folder (its layout's workDir), always
 *   an inline path; the tracker's default folder when absent
 * @returns {Sizing}
 */
export function sizeItem(item, policy, history = [], o = {}) {
  const d = policy.dispatch ?? {};
  const touches = /** @type {string[]} */ (item.touches ?? []);
  const areas = areasTouched(item, policy);
  /** @type {string[]} */
  const reasons = [];
  /** @type {number} */
  let tier;

  if (Number.isInteger(item.tier_override)) {
    tier = item.tier_override;
    reasons.push(`tier_override ${tier} on the item (the owner's override)`);
  } else {
    const plan = planRef(item);
    if (allWithin(touches, inlineGlobs(policy, o.workDir))) {
      tier = 0;
      reasons.push('every touches glob is an inline path: the orchestrator does it itself');
    } else if (plan.kind === 'none') {
      tier = 3;
      reasons.push('no plan: design-heavy work for its own session');
    } else if (
      doneWhenExecutable(item) &&
      planSpecific(item) &&
      touches.length > 0 &&
      touches.length <= (d.tier1_max_touches ?? 3)
    ) {
      tier = 1;
      reasons.push(
        'mechanical: "Done when" is executable, the plan names files, the touches are few',
      );
    } else {
      tier = 2;
      reasons.push('implementation inside a known plan');
    }

    if (tier >= 1 && tier < 3) {
      const sensitive = touches.find((t) =>
        (d.sensitive_globs ?? []).some((/** @type {string} */ g) => globsOverlap(t, g)),
      );
      if (areas.length > 1) {
        tier++;
        reasons.push(`up one for blast radius: it spans areas ${areas.join(', ')}`);
      } else if (sensitive) {
        tier++;
        reasons.push(`up one for blast radius: ${sensitive} is a sensitive path`);
      }
    }

    if (tier >= 2) {
      const lower = tier - 1;
      const same = history.filter(
        (h) =>
          h.tier === lower &&
          h.area === (areas[0] ?? null) &&
          h.kind === (item.kind ?? null) &&
          h.firstPass !== null,
      );
      const min = d.familiar_min_samples ?? 5;
      if (areas.length === 1 && same.length >= min) {
        const yieldShare = same.filter((h) => h.firstPass).length / same.length;
        if (yieldShare >= (d.familiar_min_yield ?? 0.9)) {
          tier = lower;
          reasons.push(
            `down one for familiar ground: ${Math.round(yieldShare * 100)}% first-pass yield at tier ${lower} over ${same.length} items in ${areas[0]}`,
          );
        }
      }
    }
  }

  const t = /** @type {0 | 1 | 2 | 3} */ (tier);
  const config = policy.tiers?.[String(t)] ?? {
    runs_as: 'background',
    model: 'small',
    effort: 'medium',
  };
  const estimate = estimateTokens(item, t, areas, history, d);
  if (estimate.note) reasons.push(estimate.note);
  const reviewed = areas.find((a) => (d.owner_review_areas ?? []).includes(a)) ?? null;
  if (reviewed) {
    reasons.push(`area ${reviewed} is reviewed in person: the brief asks for a review pack`);
  }
  return {
    item: String(item.id),
    tier: t,
    reasons,
    runs_as: config.runs_as,
    model: config.model,
    effort: config.effort,
    estimate_tokens: estimate.tokens,
    estimate_source: estimate.source,
    estimate_samples: estimate.samples,
    estimate_basis: estimate.basis,
    ...(estimate.note ? { estimate_note: estimate.note } : {}),
    areas,
    owner_review: reviewed,
  };
}

/** @param {number} n */
const completions = (n) => `${n} similar past ${n === 1 ? 'completion' : 'completions'}`;
/** @param {number} n */
const thousands = (n) => n.toLocaleString('en-US');

/**
 * The token estimate (design part 5.1): the median actual tokens of similar past items (same area,
 * kind and tier), scaled by the item's touches breadth. The policy default for the tier stands
 * instead when there are fewer than dispatch.estimate_min_samples of them, or when their median is
 * more than dispatch.estimate_max_multiple times that default, so one odd record cannot set every
 * estimate (HITLD-436, HITLD-439); a note says which. An estimate already on the item is kept, with
 * a note when it is far above the default. `basis` says where the figure came from and how many
 * completions it rests on, in words.
 * @param {Item} item @param {number} tier @param {string[]} areas @param {HistoryEntry[]} history
 * @param {Record<string, any>} d policy.dispatch
 * @returns {{ tokens: number, source: 'item' | 'history' | 'default', samples: number,
 *   basis: string, note?: string }}
 */
export function estimateTokens(item, tier, areas, history, d) {
  const { min_samples: min, max_multiple: multiple } = estimateSettings(d);
  const minKey = ESTIMATE_SETTINGS.min_samples.key;
  const multipleKey = ESTIMATE_SETTINGS.max_multiple.key;
  const base = Number(d.default_estimates?.[String(tier)] ?? 150000);
  if (Number.isInteger(item.estimate_tokens)) {
    const tokens = /** @type {number} */ (item.estimate_tokens);
    const far = tier > 0 && base > 0 && tokens > base * multiple;
    return {
      tokens,
      source: 'item',
      samples: 0,
      basis: "the item's own estimate_tokens (no completions behind it)",
      ...(far
        ? {
            note: `estimate from the item's own estimate_tokens (${thousands(tokens)}), more than ${multiple} times the tier ${tier} default of ${thousands(base)} (${multipleKey}): kept, as the item sets it`,
          }
        : {}),
    };
  }
  if (tier === 0)
    return {
      tokens: 0,
      source: 'default',
      samples: 0,
      basis: 'tier 0: the orchestrator does it inline, no executor to budget',
    };
  const breadth = Math.max(1, (item.touches ?? []).length);
  const scale = 1 + 0.25 * (breadth - 1);
  const scaled = breadth > 1 ? `, scaled by ${scale} for ${breadth} touches globs` : '';
  const similar = /** @type {number[]} */ (
    measuredFirst(
      history.filter(
        (h) => h.tier === tier && h.area === (areas[0] ?? null) && h.kind === (item.kind ?? null),
      ),
      min,
    )
      .map((h) => h.tokens)
      .filter((x) => typeof x === 'number')
  );
  const n = similar.length;
  const mid = n ? median(similar) : 0;
  if (n >= min && mid <= base * multiple)
    return {
      tokens: Math.round(mid * scale),
      source: 'history',
      samples: n,
      basis: `the median of ${completions(n)} at tier ${tier}${scaled}`,
    };
  const fallback = `the tier ${tier} default (dispatch.default_estimates)${scaled}`;
  /** @type {string | undefined} */
  let note;
  /** @type {string} */
  let basis;
  if (n === 0) {
    basis = `${fallback}: no similar past completion yet`;
  } else if (n < min) {
    basis = `${fallback}: ${completions(n)} ${n === 1 ? 'is' : 'are'} fewer than the ${min} needed (${minKey})`;
    note = `estimate from the tier ${tier} default: ${completions(n)} ${n === 1 ? 'is' : 'are'} too few to set it (${min} needed, ${minKey})`;
  } else {
    basis = `${fallback}: the median of ${completions(n)}, ${thousands(mid)}, is more than ${multiple} times the default (${multipleKey})`;
    note = `estimate from the tier ${tier} default: the median of ${completions(n)}, ${thousands(mid)}, is more than ${multiple} times the default of ${thousands(base)}, so it is not used (${multipleKey})`;
  }
  return {
    tokens: Math.round(base * scale),
    source: 'default',
    samples: n,
    basis,
    ...(note ? { note } : {}),
  };
}

/**
 * A measured figure weighs over a typed one (HITLD-438): when similar completions hold at least
 * `min` figures the harness measured, the typed ones and those whose source the ledger does not
 * state are set aside. Below that, every figure counts, as before the ledger said where they came
 * from.
 * @param {HistoryEntry[]} entries similar completions
 * @param {number} min the sample the estimate needs
 * @returns {HistoryEntry[]}
 */
export function measuredFirst(entries, min) {
  const measured = entries.filter((h) => h.measured === true && typeof h.tokens === 'number');
  return measured.length >= min ? measured : entries;
}

/**
 * History for sizing, from ledger events and the items they were about. Events are read as they
 * stand after corrections, so a corrected completion counts with its corrected token figure.
 * @param {Record<string, any>[]} ledger the ledger
 * @param {(id: string) => Item | undefined} itemOf
 * @returns {HistoryEntry[]}
 */
export function historyFromLedger(ledger, itemOf) {
  const events = effectiveEvents(ledger);
  /** @type {Map<string, Record<string, any>>} */
  const dispatched = new Map();
  /** @type {Map<string, boolean>} first verification per item */
  const firstVerdict = new Map();
  /** @type {Set<string>} dispatches the watchdog found stalled */
  const stalled = new Set();
  for (const e of events) {
    if (e.event === 'dispatched') dispatched.set(e.dispatch, e);
    if (e.event === 'verified' && !firstVerdict.has(e.item))
      firstVerdict.set(e.item, e.result === 'pass');
    if (e.event === 'stalled' && e.reason !== 'limit') stalled.add(e.dispatch);
  }
  /** @type {HistoryEntry[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const e of events) {
    // A finished dispatch: reported, or ended by the watchdog after it stalled.
    const ended =
      e.event === 'reported' ||
      (['interrupted', 'abandoned'].includes(e.event) && stalled.has(e.dispatch));
    if (!ended || seen.has(e.dispatch)) continue;
    const d = dispatched.get(e.dispatch);
    if (!d || d.tier === undefined || d.role !== 'executor') continue;
    seen.add(e.dispatch);
    const item = itemOf(e.item);
    const stall = stalled.has(e.dispatch);
    out.push({
      area: item?.area ?? null,
      kind: item?.kind ?? null,
      tier: d.tier,
      tokens: e.event === 'reported' && typeof e.tokens === 'number' ? e.tokens : null,
      ...(e.event === 'reported' && sourceKind(e.tokens_source) === 'measured'
        ? { measured: true }
        : {}),
      // A stall counts against familiar ground: the calibration sees it as a miss at its tier.
      firstPass: stall
        ? false
        : firstVerdict.has(e.item)
          ? /** @type {boolean} */ (firstVerdict.get(e.item))
          : null,
      ...(stall ? { stalled: true } : {}),
    });
  }
  return out;
}
