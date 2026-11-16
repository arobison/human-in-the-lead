// The Roadmap's columns by release stage (design part 12.1.2, decision HITLD-420): the releases in
// order, each a stage; a milestone stands in the stage of the earliest release that needs it, and
// milestones no release needs stand in a last stage after every release. Where one milestone needs
// another in a later stage, the needs win: the needed one is drawn in the earlier stage, and the
// board says so. Within a stage, milestones that need others there stand a column further right,
// so every wait runs left to right. Computed when the page is generated; deterministic.

import { compareVersions } from '../tracker/files/views.mjs';
import { acyclic, byId, longestPathLayers } from './layout.mjs';

/** @typedef {import('../tracker/files/views.mjs').MilestoneGraph} MilestoneGraph */
/** @typedef {MilestoneGraph['releases'][number]} Release */

/**
 * @typedef {object} Stage
 * @property {Release | null} release null for the last stage: milestones no release needs
 * @property {number} start its first column
 * @property {number} width its columns; 0 when no milestone stands in it
 * @typedef {object} Pulled a milestone drawn in an earlier stage than its own, because the needs say so
 * @property {string} id
 * @property {Release | null} own the earliest release that needs it; null when none does
 * @property {Release} drawn the release whose stage it is drawn in
 * @property {string} by the milestone that needs it there
 * @typedef {object} Stages
 * @property {Release[]} releases in stage order
 * @property {Stage[]} stages one per release, then the last stage
 * @property {Map<string, number>} stageOf each milestone's stage, an index into `stages`
 * @property {Map<string, number>} columnOf each milestone's column
 * @property {number} columns how many columns in all, at least 1
 * @property {Pulled[]} pulled in ID order
 */

/**
 * The releases in stage order: by version, and never before a release they need.
 * @param {Release[]} releases @returns {Release[]}
 */
export function stageOrder(releases) {
  const byVersion = [...releases].sort(
    (a, b) => compareVersions(a.release, b.release) || a.id.localeCompare(b.id),
  );
  const ids = new Set(byVersion.map((r) => r.id));
  /** @type {Release[]} */
  const out = [];
  const placed = new Set();
  while (out.length < byVersion.length) {
    const free = byVersion.filter((r) => !placed.has(r.id));
    // A loop between releases (the check reports it) falls back to version order.
    const next =
      free.find((r) => r.needs.every((n) => n.id === r.id || !ids.has(n.id) || placed.has(n.id))) ??
      free[0];
    out.push(next);
    placed.add(next.id);
  }
  return out;
}

/**
 * The columns of the board: each milestone's stage and column.
 * @param {MilestoneGraph} mg
 * @param {string[]} ids the milestones on the board
 * @returns {Stages}
 */
export function releaseStages(mg, ids) {
  const releases = stageOrder(mg.releases);
  const last = releases.length;
  const on = new Set(ids);
  const dag = acyclic(
    ids,
    mg.edges
      .filter((e) => on.has(e.from) && on.has(e.to))
      .map((e) => /** @type {[string, string]} */ ([e.from, e.to])),
  );
  /** @type {Map<string, number>} the earliest release that needs each milestone */
  const own = new Map(
    ids.map((id) => {
      const k = releases.findIndex((r) => r.milestones.includes(id));
      return [id, k < 0 ? last : k];
    }),
  );
  /** @type {Map<string, number>} */
  const stageOf = new Map(own);
  /** @type {Map<string, string>} the milestone that pulled each one left */
  const by = new Map();
  // A needed milestone stands no later than what needs it: pass over the waits until none moves.
  const sorted = [...dag].sort((x, y) => byId(x[1], y[1]) || byId(x[0], y[0]));
  for (let pass = 0; pass <= ids.length; pass++) {
    let moved = false;
    for (const [from, to] of sorted) {
      const s = /** @type {number} */ (stageOf.get(to));
      if (s < /** @type {number} */ (stageOf.get(from))) {
        stageOf.set(from, s);
        by.set(from, to);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Within each stage, columns by longest path over the waits inside it.
  const inside = dag.filter(([a, b]) => stageOf.get(a) === stageOf.get(b));
  const step = longestPathLayers(ids, inside);
  /** @type {Stage[]} */
  const stages = [];
  let start = 0;
  for (let k = 0; k <= last; k++) {
    const here = ids.filter((id) => stageOf.get(id) === k);
    const width = here.length
      ? Math.max(...here.map((id) => /** @type {number} */ (step.get(id)))) + 1
      : 0;
    stages.push({ release: k < last ? releases[k] : null, start, width });
    start += width;
  }
  const columnOf = new Map(
    ids.map((id) => {
      const k = /** @type {number} */ (stageOf.get(id));
      return [id, stages[k].start + /** @type {number} */ (step.get(id))];
    }),
  );
  const pulled = ids
    .filter((id) => /** @type {number} */ (stageOf.get(id)) < /** @type {number} */ (own.get(id)))
    .sort(byId)
    .map((id) => {
      const o = /** @type {number} */ (own.get(id));
      return {
        id,
        own: o < last ? releases[o] : null,
        drawn: releases[/** @type {number} */ (stageOf.get(id))],
        by: /** @type {string} */ (by.get(id)),
      };
    });
  return { releases, stages, stageOf, columnOf, columns: Math.max(1, start), pulled };
}
