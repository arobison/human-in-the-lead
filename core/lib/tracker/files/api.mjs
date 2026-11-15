// The tracker read API (design part 3.4, "Who owns the format"): `hitld work show --json` and
// `hitld work query --json`. Anything that reads the tracker (a board, a report, a custom view)
// reads this output, never the files, so a change to the files that keeps the API stable breaks
// no reader.
//
// The rule for `api_version`:
//   - Removing a field, renaming it or changing its type raises the version.
//   - Adding a field does not. Readers ignore fields they do not know.
// The version starts at 1. A plugin release that raises it says so in its notes and ships
// `hitld work migrate` steps where the files change too.
//
// Version 2 (HITLD-82): state values are lowercase kebab-case (`in-progress`); `claimed` is
// `claimed_by`, `party` is `waiting_on`, `lead` is `owner`, `tier_hint` is `tier_override`,
// `changelog` is `release_note`; a milestone's `needs` is `constraints`, its derived `error` is
// `unmet_clauses`, and a check result `verdict` is `answered`. Every entity carries `entity`: the
// entity type (`item`, `project`, `milestone` or `release`).
//
// Version 3 (HITLD-90): a milestone's `kind` is `milestone` (it was `capability` or `learning`;
// a learning milestone is one whose check is a study); there are no initiatives (a long outcome
// is a milestone with no `parent`); a project carries the shaping fields and its `decision`, with
// `bet_by` derived; every record carries `owner`, which is the owner when the file names none.

/** The version of the read API's response shapes. */
export const API_VERSION = 3;

/** The entity type of a kind, for the read API's `entity` field. @param {unknown} kind */
export const entityType = (kind) =>
  ({
    work: 'item',
    decision: 'item',
    external: 'item',
    project: 'project',
    milestone: 'milestone',
    release: 'release',
  })[String(kind)] ?? String(kind);

/**
 * The declared project fields, as the read API lists them, so a reader knows each one's type.
 * @param {import('./config.mjs').Layout} layout
 */
export const declaredFields = (layout) =>
  layout.fields.map((f) => ({
    name: f.name,
    type: f.type,
    list: f.list === true,
    ...(f.values ? { values: f.values } : {}),
    description: f.description,
  }));

/**
 * Wrap a read result as the versioned response.
 * @param {import('./config.mjs').Layout} layout @param {Record<string, unknown>} result
 */
export const apiResponse = (layout, result) => ({
  ok: true,
  api_version: API_VERSION,
  ...result,
  declared_fields: declaredFields(layout),
});

/**
 * Turn `name=value` words into a declared-field filter.
 * @param {unknown} words @returns {Record<string, string>}
 */
export function fieldFilter(words) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const w of Array.isArray(words) ? words : []) {
    const at = String(w).indexOf('=');
    if (at < 1) throw new Error(`--field ${JSON.stringify(w)} must be name=value`);
    out[String(w).slice(0, at)] = String(w).slice(at + 1);
  }
  return out;
}
