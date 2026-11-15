// The files backend's format before HITLD-82, and how to read it.
//
// The format stored `status` (with the values `Proposed`, `Planned`, `In progress`, `Done`,
// `Dropped`), `claimed`, `decided-by`, `lead`, `party`, `tier_hint`, `changelog`, a milestone's
// `needs` and the check result `verdict`. `hitld work migrate` (the step names-and-states) moves a
// tracker's files. Git holds files in the old form outside the working tree, where no migration
// reaches: claim branches made before it, the history of an item file, the tree at an earlier
// release tag. `fromLegacy` reads those, so a claim, a history and a release proposal stay right
// across the change.

import { MILESTONE_KINDS } from './milestones.mjs';

/** The state values before HITLD-82, and what each is now. */
export const LEGACY_STATES = /** @type {Record<string, string>} */ ({
  Proposed: 'proposed',
  Planned: 'planned',
  'In progress': 'in-progress',
  Done: 'done',
  Dropped: 'dropped',
});

/**
 * Stored keys renamed by HITLD-82, old name to new. A milestone's `needs` became `constraints`
 * (MILESTONE_RENAMED_KEYS); an item's `needs` keeps its name.
 */
export const RENAMED_KEYS = /** @type {Record<string, string>} */ ({
  status: 'state',
  claimed: 'claimed_by',
  'decided-by': 'decider',
  lead: 'owner',
  party: 'waiting_on',
  tier_hint: 'tier_override',
  changelog: 'release_note',
});

/** Renamed keys on milestones only. */
export const MILESTONE_RENAMED_KEYS = /** @type {Record<string, string>} */ ({
  needs: 'constraints',
});

/** The check result `verdict` (a learning milestone's study answered) is now `answered`. */
export const LEGACY_CHECK_RESULTS = /** @type {Record<string, string>} */ ({
  verdict: 'answered',
});

/**
 * The renamed keys for a file of this kind.
 * @param {unknown} kind
 * @returns {Record<string, string>}
 */
export const renamesFor = (kind) =>
  MILESTONE_KINDS.includes(String(kind))
    ? { ...RENAMED_KEYS, ...MILESTONE_RENAMED_KEYS }
    : RENAMED_KEYS;

/** A check_results line with its old result word renamed. @param {unknown} line */
export function legacyCheckResult(line) {
  const s = String(line);
  const m = /^(\S+)(\s[\s\S]*)?$/.exec(s);
  return m && LEGACY_CHECK_RESULTS[m[1]] ? `${LEGACY_CHECK_RESULTS[m[1]]}${m[2] ?? ''}` : s;
}

/**
 * A file's stored keys in the current form, from the form before HITLD-82 (or the current form,
 * unchanged). A key already in the new form wins over its old name.
 * @template {Record<string, unknown> | null | undefined} T
 * @param {T} d stored keys
 * @returns {T}
 */
export function fromLegacy(d) {
  if (!d || typeof d !== 'object') return d;
  const renames = renamesFor(d.kind);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    const to = renames[k];
    if (to === undefined) {
      if (!(k in out)) out[k] = v;
    } else if (d[to] === undefined) out[to] = v;
  }
  if (typeof out.state === 'string') out.state = LEGACY_STATES[out.state] ?? out.state;
  if (MILESTONE_KINDS.includes(String(d.kind)) && out.check_results !== undefined) {
    const lines = out.check_results;
    out.check_results = Array.isArray(lines)
      ? lines.map(legacyCheckResult)
      : legacyCheckResult(lines);
  }
  return /** @type {T} */ (out);
}
