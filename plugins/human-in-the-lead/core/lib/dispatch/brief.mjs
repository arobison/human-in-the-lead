// The brief (design part 5.2): short because it points rather than restates. It never contains the
// item's text, the design's text, background the knowledge base holds, or a description of the
// codebase: those cost tokens on every dispatch and drift from their sources.

import { planRef } from './item.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {import('./sizing.mjs').Sizing} Sizing
 */

/**
 * The environment an executor's hitld commands carry: its dispatch (the env manager reads its role
 * from the dispatch record), its project, and its role, which keeps tracker writes that only the
 * orchestrator may make (ID allocation) away from it.
 * @param {string} dispatch @param {string} projectId
 * @returns {Record<string, string>}
 */
export const executorEnv = (dispatch, projectId) => ({
  HITLD_DISPATCH: dispatch,
  HITLD_PROJECT_ID: projectId,
  HITLD_ROLE: 'executor',
});

/** @param {Record<string, string>} env */
export const envPrefix = (env) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

/** At most this many paths per line of the overlap lines; the rest are counted. */
const PATHS_SHOWN = 6;

/** @param {string[]} paths */
const pathList = (paths) =>
  paths.length > PATHS_SHOWN
    ? `${paths.slice(0, PATHS_SHOWN).join(', ')} and ${paths.length - PATHS_SHOWN} more`
    : paths.join(', ');

/**
 * `touches`: what the overlap rule used (touches.mjs), when the caller derived them; `overlaps`:
 * the dispatches in flight whose touches overlap; `merged`: the merges since the item was planned
 * that changed the same paths.
 * @param {{ item: Item, sizing: Sizing, dispatch: string, branch: string, policy: Record<string, any>,
 *   isolation: 'worktree' | 'none', worktree?: string | null,
 *   touches?: import('./touches.mjs').Touches,
 *   overlaps?: import('./touches.mjs').Overlap[], merged?: import('./touches.mjs').Merge[] }} r
 * @returns {string}
 */
export function renderBrief({
  item,
  sizing,
  dispatch,
  branch,
  policy,
  isolation,
  worktree,
  touches: used,
  overlaps = [],
  merged = [],
}) {
  const prefix = envPrefix(executorEnv(dispatch, String(policy.project?.id ?? '')));
  const id = String(item.id);
  const file = typeof item.path === 'string' ? item.path : `the item file for ${id}`;
  const plan = planRef(item);
  const planLine =
    plan.kind === 'pointer'
      ? `Read ${file} and the plan it points to (${plan.ref}).`
      : plan.kind === 'section'
        ? `Read ${file}, including its Plan section.`
        : `Read ${file}. It has no plan yet: settle the approach first and list it under calls.`;
  const kb = sizing.areas.flatMap((a) => policy.dispatch?.brief_kb?.[a] ?? []);
  const touches = used?.touches ?? /** @type {string[]} */ (item.touches ?? []);
  const derived = used?.source === 'derived';
  const serial = /** @type {string[]} */ (item.serial ?? []);
  const reportAt = Math.round(
    sizing.estimate_tokens * (policy.dispatch?.report_at_budget_multiple ?? 1.5),
  );
  const k = (/** @type {number} */ n) => `${Math.round(n / 1000)}k`;
  const setup =
    isolation === 'worktree'
      ? `First, in your worktree: ${prefix} hitld env setup --dispatch ${dispatch} --adopt "$PWD", then name your branch: git branch -m ${branch}.`
      : `Your worktree is ${worktree ?? 'prepared for you'}, on branch ${branch}.`;
  return [
    `You are implementing ${id} as dispatch ${dispatch}. ${planLine}`,
    '',
    `Done when: the item's "Done when" section. That is the exit; stop when it holds.`,
    '',
    ...(kb.length ? [`Knowledge base: ${kb.join(', ')}.`] : []),
    `Touches${derived ? ' (derived from the item text)' : ''}: ${touches.join(', ') || 'not listed; keep the change small'}. Record why if you go outside.`,
    ...overlaps.map(
      (o) => `In flight on the same paths: ${o.dispatch} (${o.item}) touches ${pathList(o.paths)}.`,
    ),
    // The owner's wording, verbatim (HITLD-136).
    ...(overlaps.length ? ['merge main before you report when a dispatch in flight overlaps'] : []),
    ...merged.map(
      (m) =>
        `Merged since this item was planned, on the same paths: ${m.commit.slice(0, 7)}${m.items.length ? ` (${m.items.join(', ')})` : ''} changed ${pathList(m.paths)}.`,
    ),
    `Serial: ${serial.join(', ') || 'none'}. Budget: ~${k(sizing.estimate_tokens)} tokens${sizing.estimate_basis ? ` (estimate from ${sizing.estimate_basis})` : ''}; report at ${k(reportAt)} even if unfinished.`,
    ...(sizing.owner_review
      ? [
          `Owner review: the owner reviews ${sizing.owner_review} in person. Prepare a review pack: what changed in two or three lines, screens or samples where you can make them (under the item's classification), and each judgment call as a question with your recommendation. Say under evidence where the pack is.`,
        ]
      : []),
    '',
    setup,
    `Prefix every hitld command with ${prefix}`,
    '',
    'Follow the executor contract in AGENTS.md and the execute skill: claim first, close in the same',
    'change, measure through the benchmark tool, report in the fixed shape.',
    '',
  ].join('\n');
}
