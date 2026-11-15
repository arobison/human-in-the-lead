// The files backend's format before HITLD-82 and HITLD-90, and how to read it.
//
// Before HITLD-82 the format stored `status` (with the values `Proposed`, `Planned`, `In progress`, `Done`,
// `Dropped`), `claimed`, `decided-by`, `lead`, `party`, `tier_hint`, `changelog`, a milestone's
// `needs` and the check result `verdict`. `hitld work migrate` (the step names-and-states) moves a
// tracker's files. Git holds files in the old form outside the working tree, where no migration
// reaches: claim branches made before it, the history of an item file, the tree at an earlier
// release tag. `fromLegacy` reads those, so a claim, a history and a release proposal stay right
// across the change.
//
// Before HITLD-90 the format had more kinds: an `initiative` grouped projects, a milestone was a
// `capability` or a `learning` milestone, and the model had an `opportunity` beside the project.
// Now a long outcome is a milestone with no parent, every milestone has `kind: milestone` (a
// learning milestone is one whose check is a study), and a project being shaped is a proposed
// project. The step tracker-structure moves a tracker's files; `fromLegacy` reads the old kinds
// from git, and the check names a working-tree file that still holds one. Both go in the next
// minor release.

/** The milestone kinds before HITLD-90. */
export const LEGACY_MILESTONE_KINDS = ['capability', 'learning'];

/** Every kind a milestone file has had: the current one and the ones before HITLD-90. */
const ANY_MILESTONE_KIND = ['milestone', ...LEGACY_MILESTONE_KINDS];

/** The kinds before HITLD-90, and what each is now. */
export const LEGACY_KINDS = /** @type {Record<string, string>} */ ({
  initiative: 'milestone',
  capability: 'milestone',
  learning: 'milestone',
  opportunity: 'project',
});

/** Why each old kind changed, for the check's message. */
export const LEGACY_KIND_NOTES = /** @type {Record<string, string>} */ ({
  initiative:
    'a long outcome is a milestone with no parent, whose constraints are other milestones',
  capability: 'there is one milestone kind',
  learning: 'there is one milestone kind; a learning milestone is one whose check is a study',
  opportunity: 'a project being shaped is a proposed project',
});

/** An opportunity's states, and the project state each is now. */
export const OPPORTUNITY_STATES = /** @type {Record<string, string>} */ ({
  raw: 'proposed',
  shaping: 'proposed',
  shaped: 'proposed',
  parked: 'proposed',
  bet: 'planned',
  rejected: 'dropped',
});

/**
 * An opportunity's keys that a project names differently. `bet_by` has no key: it is derived from
 * the decision.
 */
export const OPPORTUNITY_RENAMED_KEYS = /** @type {Record<string, string>} */ ({
  no_gos: 'out_of_scope',
  rabbit_holes: 'risks',
  bet_decision: 'decision',
});

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
  ANY_MILESTONE_KIND.includes(String(kind))
    ? { ...RENAMED_KEYS, ...MILESTONE_RENAMED_KEYS }
    : RENAMED_KEYS;

/** A check_results line with its old result word renamed. @param {unknown} line */
export function legacyCheckResult(line) {
  const s = String(line);
  const m = /^(\S+)(\s[\s\S]*)?$/.exec(s);
  return m && LEGACY_CHECK_RESULTS[m[1]] ? `${LEGACY_CHECK_RESULTS[m[1]]}${m[2] ?? ''}` : s;
}

/**
 * A file's stored keys in the current form, from the forms before HITLD-82 and HITLD-90 (or the
 * current form, unchanged). A key already in the new form wins over its old name.
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
  if (ANY_MILESTONE_KIND.includes(String(d.kind)) && out.check_results !== undefined) {
    const lines = out.check_results;
    out.check_results = Array.isArray(lines)
      ? lines.map(legacyCheckResult)
      : legacyCheckResult(lines);
  }
  return /** @type {T} */ (fromLegacyKind(out));
}

/**
 * A file's stored keys with a kind from before HITLD-90 read as its kind now: an initiative or a
 * capability or learning milestone is a milestone, an opportunity a project. A milestone under an
 * initiative, and a project's initiative, lose that parent: the initiative is a milestone with no
 * parent, and a project has none.
 * @param {Record<string, unknown>} d stored keys, HITLD-82 names
 * @returns {Record<string, unknown>}
 */
export function fromLegacyKind(d) {
  const kind = String(d.kind);
  if (kind === 'project' || ANY_MILESTONE_KIND.includes(kind) || kind === 'initiative') {
    if (d.initiative === undefined && !Object.hasOwn(LEGACY_KINDS, kind)) return d;
    const { initiative: _, ...out } = d;
    return Object.hasOwn(LEGACY_KINDS, kind) ? { ...out, kind: LEGACY_KINDS[kind] } : out;
  }
  if (kind !== 'opportunity') return d;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'bet_by') continue;
    const to = OPPORTUNITY_RENAMED_KEYS[k] ?? k;
    if (to !== k && d[to] !== undefined) continue;
    out[to] = v;
  }
  out.kind = 'project';
  if (typeof d.state === 'string') out.state = OPPORTUNITY_STATES[d.state] ?? d.state;
  return out;
}
