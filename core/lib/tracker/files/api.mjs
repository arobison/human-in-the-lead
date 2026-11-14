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

/** The version of the read API's response shapes. */
export const API_VERSION = 1;

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
