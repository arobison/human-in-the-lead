// Rendering a worktree's template (HITLD-744). A file copied into a worktree can name the port the
// primary checkout's server uses, so the project supplies a template instead and `.worktreeinclude`
// marks it; `hitld env setup` renders it with the worktree's leased port.
//
// HITLD knows no file formats. Everything here works on lines and on one placeholder syntax:
//  - `${HITLD_PORT}` is replaced by the worktree's leased port. Any other `${HITLD_<NAME>}` has no
//    value, and the template fails to render. Other `${...}` text (an editor's `${workspaceFolder}`)
//    is left as it is.
//  - A line that holds `hitld:owner-only` is dropped. A line that holds `hitld:owner-only-begin`
//    starts a block that ends at a line holding `hitld:owner-only-end`; the block and both marker
//    lines are dropped. The comment syntax around a marker is the project's own, since marker lines
//    never reach the rendered file. Blocks do not nest.
//
// A failure is described by a reason, line numbers and placeholder names, never by the template's
// text: a caller may print the reason, and the text can hold what the project keeps private.

/** The placeholders HITLD fills: `${HITLD_` then capitals, digits and underscores, then `}`. */
const PLACEHOLDER = /\$\{(HITLD_[A-Z0-9_]+)\}/g;
const OWNER_ONLY = 'hitld:owner-only';
const BEGIN = `${OWNER_ONLY}-begin`;
const END = `${OWNER_ONLY}-end`;

/**
 * @typedef {'missing-value' | 'owner-only-unclosed' | 'owner-only-unopened' | 'owner-only-nested'}
 *   RenderReason
 * @typedef {{ ok: true, text: string } | { ok: false, reason: RenderReason, detail: string }} Rendered
 */

/**
 * Render a template's text with the values given, dropping owner-only lines first, so a
 * placeholder on a dropped line needs no value.
 * @param {string} text the template's contents
 * @param {Record<string, string>} values placeholder name (HITLD_PORT) to value
 * @returns {Rendered}
 */
export function renderTemplate(text, values) {
  const lines = text.split(/(?<=\n)/);
  /** @type {string[]} */
  const kept = [];
  let openedAt = 0;
  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    if (line.includes(BEGIN)) {
      if (openedAt) {
        return {
          ok: false,
          reason: 'owner-only-nested',
          detail: `line ${n} opens an owner-only block inside the one line ${openedAt} opened`,
        };
      }
      openedAt = n;
    } else if (line.includes(END)) {
      if (!openedAt) {
        return {
          ok: false,
          reason: 'owner-only-unopened',
          detail: `line ${n} closes an owner-only block that no line opened`,
        };
      }
      openedAt = 0;
    } else if (!openedAt && !line.includes(OWNER_ONLY)) {
      kept.push(line);
    }
  }
  if (openedAt) {
    return {
      ok: false,
      reason: 'owner-only-unclosed',
      detail: `the owner-only block line ${openedAt} opens is never closed`,
    };
  }
  const body = kept.join('');
  const missing = [
    ...new Set(
      [...body.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !Object.hasOwn(values, k)),
    ),
  ].sort();
  if (missing.length) {
    return {
      ok: false,
      reason: 'missing-value',
      detail: `no value for ${missing.join(', ')}${missing.includes('HITLD_PORT') ? ' (the worktree has no leased port)' : ''}`,
    };
  }
  return { ok: true, text: body.replace(PLACEHOLDER, (_, k) => values[k]) };
}
