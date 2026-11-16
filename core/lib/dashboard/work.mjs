// The work the dashboard shows beside quotas and spend (design part 12.1, HITLD-152): read from the
// tracker's read API (the entities `hitld work query --json` gives, the claims and the committed
// state history) and the ledger, never from the item files. Derived states follow the tracker's
// rules (design part 3.2): an item is ready when it is planned and every need is done, blocked when
// it is planned with an open need. Each figure is computed once, here, for the view whose question
// it answers.

import { buildGraph } from '../tracker/files/graph.mjs';
import { criticalPaths } from '../tracker/files/views.mjs';
import { effectiveEntries } from '../quota/usage.mjs';
import { byId } from './layout.mjs';

/**
 * @typedef {Record<string, any>} Entity an entity as the read API gives it
 * @typedef {import('../tracker/interface.mjs').Change} Change
 * @typedef {'proposed' | 'blocked' | 'ready' | 'in-progress' | 'done' | 'dropped'} Stage
 *
 * @typedef {object} WorkItem
 * @property {string} id
 * @property {string} kind work, decision or external
 * @property {string} title
 * @property {string} state
 * @property {Stage} stage
 * @property {string | null} project
 * @property {string[]} needs
 * @property {string[]} open_needs needs not done
 * @property {string | null} path
 * @property {string | null} created
 * @property {boolean} critical on the item critical path
 * @property {number} waiting_on_it open items that wait on it, directly or through other items
 * @property {string | null} decider
 * @property {string | null} waiting_on an outside wait's party
 * @property {string[]} scopes the projects, milestones and long outcomes it belongs to
 */

const DAY = 86_400_000;

/** @param {unknown} v @returns {string[]} */
const strings = (v) =>
  Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)];

/** An entity as the graph module reads it. @param {Entity} e */
const asNode = (e) => {
  const { constraints: _, ...data } = e;
  return /** @type {any} */ ({ path: e.path ?? '', data: { ...data, project: e.parent ?? null } });
};

/**
 * The stage an item shows in: its state, with planned split into ready and blocked.
 * @param {Entity} e @param {(id: string) => string | undefined} stateOf
 * @returns {Stage}
 */
export function stageOf(e, stateOf) {
  const s = String(e.state);
  if (s !== 'planned') return /** @type {Stage} */ (s);
  return strings(e.needs).every((n) => stateOf(n) === 'done') ? 'ready' : 'blocked';
}

/**
 * The work model: every item with its derived stage, the critical path, the scopes, and the
 * figures of Your move, Proposals and Flow.
 * @param {object} input
 * @param {Entity[]} input.entities
 * @param {import('../tracker/files/claims.mjs').ClaimedItem[]} [input.claims]
 * @param {Map<string, Change[]>} [input.histories]
 * @param {Record<string, any>[]} [input.ledger]
 * @param {number} input.now
 * @param {{ commit: string | null, branch: string | null }} [input.source] where the tracker was read
 */
export function workModel({
  entities,
  claims = [],
  histories = new Map(),
  ledger = [],
  now,
  source = { commit: null, branch: null },
}) {
  const g = buildGraph(entities.map(asNode));
  const byIdMap = new Map(entities.map((e) => [String(e.id), e]));
  const stateOf = (/** @type {string} */ id) => byIdMap.get(id)?.state;
  const path = criticalPaths(g)[0]?.chain.map((n) => String(n.data.id)) ?? [];
  const critical = new Set(path);
  const itemEntities = entities.filter((e) => ['work', 'decision', 'external'].includes(e.kind));
  // What waits on each item, through other items: open items only.
  /** @type {Map<string, string[]>} */
  const needers = new Map();
  for (const e of itemEntities) {
    if (['done', 'dropped'].includes(e.state)) continue;
    for (const n of strings(e.needs)) needers.set(n, [...(needers.get(n) ?? []), String(e.id)]);
  }
  /** @param {string} id */
  const behind = (id) => {
    const seen = new Set();
    const stack = [...(needers.get(id) ?? [])];
    while (stack.length) {
      const v = /** @type {string} */ (stack.pop());
      if (seen.has(v) || v === id) continue;
      seen.add(v);
      stack.push(...(needers.get(v) ?? []));
    }
    return seen.size;
  };
  // Scopes: an item's project, the milestones it is a constraint of or contributes to, and the
  // long outcomes (milestones with no project) that need those milestones.
  const milestones = entities.filter((e) => e.kind === 'milestone');
  /** @type {Map<string, string[]>} milestone → long outcomes that need it */
  const outcomesOf = new Map();
  for (const m of milestones) {
    if (m.parent) continue;
    for (const c of Array.isArray(m.constraints) ? m.constraints : []) {
      const id = String(c?.id ?? c);
      outcomesOf.set(id, [...(outcomesOf.get(id) ?? []), String(m.id)]);
    }
  }
  /** @type {WorkItem[]} */
  const items = itemEntities
    .map((e) => {
      const id = String(e.id);
      const ms = [...strings(e.constraint_of), ...strings(e.contributes_to)];
      return {
        id,
        kind: String(e.kind),
        title: String(e.title ?? id),
        state: String(e.state),
        stage: stageOf(e, stateOf),
        project: e.parent ? String(e.parent) : null,
        needs: strings(e.needs),
        open_needs: strings(e.needs).filter((n) => stateOf(n) !== 'done'),
        path: e.path ? String(e.path) : null,
        created: e.created ? String(e.created) : null,
        critical: critical.has(id),
        waiting_on_it: behind(id),
        decider: e.decider ? String(e.decider) : null,
        waiting_on: e.waiting_on ? String(e.waiting_on) : null,
        scopes: [
          ...new Set([
            ...(e.parent ? [String(e.parent)] : []),
            ...ms,
            ...ms.flatMap((m) => outcomesOf.get(m) ?? []),
          ]),
        ],
      };
    })
    .sort((a, b) => byId(a.id, b.id));
  const projects = entities
    .filter((e) => e.kind === 'project')
    .map((e) => ({ id: String(e.id), title: String(e.title ?? e.id), state: String(e.state) }))
    .sort((a, b) => byId(a.id, b.id));
  return {
    read_at: new Date(now).toISOString(),
    source,
    projects,
    milestones: milestones
      .map((m) => ({
        id: String(m.id),
        title: String(m.title ?? m.id),
        state: String(m.state),
        long_outcome: !m.parent,
      }))
      .sort((a, b) => byId(a.id, b.id)),
    critical_path: path,
    items,
    move: yourMove(items, claims, ledger, now),
    flow: flowModel(items, histories, ledger, now),
  };
}

/** @typedef {ReturnType<typeof workModel>} WorkModel */

/** Whole days between two times, never negative. @param {number} from @param {number} to */
const daysBetween = (from, to) => Math.max(0, Math.floor((to - from) / DAY));

/** Most waited-on first, then by ID. @param {{ id: string, waiting_on_it: number }} a @param {{ id: string, waiting_on_it: number }} b */
const mostWaited = (a, b) => b.waiting_on_it - a.waiting_on_it || byId(a.id, b.id);

/**
 * Your move (design part 12.1, "Live"): decisions waiting on the owner, what is ready to start,
 * what is in progress (who holds it, on which branch, and what its dispatch last did, claims in
 * other worktrees included until they merge), branches waiting on checks or on the owner's merge,
 * and outside waits. Each with its age.
 * @param {WorkItem[]} items @param {import('../tracker/files/claims.mjs').ClaimedItem[]} claims
 * @param {Record<string, any>[]} ledger @param {number} now
 */
function yourMove(items, claims, ledger, now) {
  const live = effectiveEntries(ledger);
  const open = (/** @type {WorkItem} */ it) => !['done', 'dropped'].includes(it.state);
  /** When the ledger says each decision was asked. */
  /** @type {Map<string, number>} */
  const asked = new Map();
  /** The last event of each dispatch, and of each item. */
  /** @type {Map<string, Record<string, any>>} */
  const lastOfDispatch = new Map();
  /** @type {Map<string, Record<string, any>>} */
  const lastOfItem = new Map();
  for (const e of live) {
    const at = Date.parse(e.at);
    if (e.event === 'asked' && e.decision && !asked.has(e.decision)) asked.set(e.decision, at);
    if (e.dispatch) lastOfDispatch.set(e.dispatch, e);
    if (e.item) lastOfItem.set(e.item, e);
  }
  const ageFrom = (/** @type {string | null} */ created, /** @type {number | undefined} */ at) => {
    const t = at ?? (created ? Date.parse(created) : NaN);
    return Number.isFinite(t) ? daysBetween(t, now) : null;
  };
  const brief = (/** @type {WorkItem} */ it) => ({
    id: it.id,
    title: it.title,
    path: it.path,
    waiting_on_it: it.waiting_on_it,
    critical: it.critical,
  });
  const decisions = items
    .filter((it) => it.kind === 'decision' && open(it) && it.decider === 'owner')
    .map((it) => ({
      ...brief(it),
      age_days: ageFrom(it.created, asked.get(it.id)),
      first_needs: it.open_needs,
    }))
    .sort(mostWaited);
  const claimed = new Map(claims.map((c) => [c.id, c]));
  const ready = items
    .filter((it) => it.kind === 'work' && it.stage === 'ready' && !claimed.has(it.id))
    .map(brief)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || mostWaited(a, b));
  const byItem = new Map(items.map((it) => [it.id, it]));
  const ids = new Set([
    ...claims.map((c) => c.id),
    ...items.filter((it) => it.state === 'in-progress').map((it) => it.id),
  ]);
  /** What a dispatch last did, in words. @param {Record<string, any> | undefined} e */
  const doing = (e) => {
    if (!e) return null;
    const what = /** @type {Record<string, string>} */ ({
      dispatched: 'dispatched',
      started: 'started',
      reported: `reported ${e.result ?? ''}`.trim(),
      verified: e.result === 'pass' ? 'verification passed' : 'verification failed',
      stalled: 'stalled',
      poked: 'asked for its status',
      interrupted: 'interrupted',
      merged: 'merged',
      reverted: 'reverted',
      abandoned: 'abandoned',
      unclaimed: 'unclaimed',
    })[e.event];
    return what ? { event: what, age_days: daysBetween(Date.parse(e.at), now) } : null;
  };
  const inProgress = [...ids].sort(byId).map((id) => {
    const it = byItem.get(id);
    const c = claimed.get(id);
    const first = c?.claims[0];
    const holder = first?.claimant ?? null;
    const since = first?.at ? Date.parse(first.at) : NaN;
    return {
      id,
      title: it?.title ?? c?.title ?? id,
      path: it?.path ?? null,
      by: holder,
      branch: first?.branch ?? null,
      claims: c?.claims.length ?? 0,
      age_days: Number.isFinite(since) ? daysBetween(since, now) : null,
      doing: doing((holder && lastOfDispatch.get(holder)) || lastOfItem.get(id)),
      waiting_on_it: it?.waiting_on_it ?? 0,
    };
  });
  // Branches that reported done and that no verification has answered since: waiting on checks.
  /** @type {Map<string, Record<string, any>>} */
  const checking = new Map();
  for (const e of live) {
    if (e.event === 'reported' && e.result === 'done') checking.set(e.item, e);
    else if (['verified', 'merged', 'reverted', 'abandoned', 'unclaimed'].includes(e.event)) {
      checking.delete(e.item);
    }
  }
  const checks = [...checking.values()].map((e) => ({
    id: String(e.item),
    title: byItem.get(e.item)?.title ?? String(e.item),
    path: byItem.get(e.item)?.path ?? null,
    branch: e.branch ?? null,
    age_days: daysBetween(Date.parse(e.at), now),
  }));
  const outside = items
    .filter((it) => it.kind === 'external' && open(it))
    .map((it) => ({
      ...brief(it),
      waiting_on: it.waiting_on,
      age_days: ageFrom(it.created, undefined),
    }))
    .sort(mostWaited);
  return { decisions, ready, in_progress: inProgress, checks, outside };
}

/** The stages Flow draws, bottom to top. */
export const FLOW_STAGES = /** @type {const} */ ([
  'done',
  'in-progress',
  'ready',
  'blocked',
  'proposed',
]);

/** The median of a list, or null when it is empty. @param {number[]} xs */
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Flow (design part 11.1): each item's stage at the end of each day, from the committed state
 * history, as bands; then the measures, each beside its pair, the one that must not get worse
 * (design part 11.3). Ready and blocked on a past day are derived from the item's needs as they are
 * now and their states on that day.
 * @param {WorkItem[]} items @param {Map<string, Change[]>} histories
 * @param {Record<string, any>[]} ledger @param {number} now
 */
function flowModel(items, histories, ledger, now, maxDays = 90) {
  const times = [...histories.values()]
    .flat()
    .map((c) => Date.parse(c.at))
    .filter(Number.isFinite);
  const today = Math.floor(now / DAY) * DAY;
  const start = times.length
    ? Math.max(Math.floor(Math.min(...times) / DAY) * DAY, today - (maxDays - 1) * DAY)
    : today;
  /** @param {string} id @param {number} end @returns {string | undefined} */
  const stateAt = (id, end) => {
    let s;
    for (const c of histories.get(id) ?? []) {
      if (Date.parse(c.at) < end) s = c.to;
      else break;
    }
    return s;
  };
  const days = [];
  for (let d = start; d <= today; d += DAY) {
    const end = Math.min(d + DAY, now);
    /** @type {Record<string, number>} */
    const counts = Object.fromEntries(FLOW_STAGES.map((s) => [s, 0]));
    for (const it of items) {
      const s = stateAt(it.id, end);
      if (!s || s === 'dropped') continue;
      const stage =
        s === 'planned'
          ? it.needs.every((n) => stateAt(n, end) === 'done')
            ? 'ready'
            : 'blocked'
          : s;
      if (stage in counts) counts[stage]++;
    }
    days.push({ day: new Date(d).toISOString().slice(0, 10), ...counts });
  }
  // Throughput: items done in the last seven days, and in the seven before.
  const doneAt = (/** @type {string} */ id) => {
    const c = (histories.get(id) ?? []).findLast((x) => x.to === 'done');
    return c ? Date.parse(c.at) : null;
  };
  const doneIn = (/** @type {number} */ from, /** @type {number} */ to) =>
    items.filter((it) => {
      const t = doneAt(it.id);
      return it.state === 'done' && t !== null && t >= from && t < to;
    }).length;
  // Lead time: from planned to done, for items done in the last 30 days.
  const leads = items.flatMap((it) => {
    const h = histories.get(it.id) ?? [];
    const planned = h.find((c) => c.to === 'planned');
    const done = doneAt(it.id);
    if (it.state !== 'done' || !planned || done === null || done < now - 30 * DAY) return [];
    return [(done - Date.parse(planned.at)) / DAY];
  });
  // Change failure rate, from the ledger: items reverted over items merged.
  const live = effectiveEntries(ledger);
  const merged = new Set(live.filter((e) => e.event === 'merged').map((e) => e.item));
  const reverted = new Set(live.filter((e) => e.event === 'reverted').map((e) => e.item));
  // First-pass yield: of items verified, the share whose first verification passed.
  /** @type {Map<string, string>} */
  const firstVerdict = new Map();
  for (const e of live) {
    if (e.event === 'verified' && !firstVerdict.has(e.item)) firstVerdict.set(e.item, e.result);
  }
  return {
    days,
    measures: {
      done_last_7_days: doneIn(now - 7 * DAY, now + 1),
      done_previous_7_days: doneIn(now - 14 * DAY, now - 7 * DAY),
      lead_time_median_days: median(leads),
      lead_time_items: leads.length,
      merged: merged.size,
      reverted: [...reverted].filter((id) => merged.has(id)).length,
      verified: firstVerdict.size,
      first_pass: [...firstVerdict.values()].filter((r) => r === 'pass').length,
      in_progress: items.filter((it) => it.state === 'in-progress').length,
      blocked: items.filter((it) => it.stage === 'blocked').length,
    },
  };
}
