// The words the panels show, shared by HITLD's page with no script (core/lib/dashboard/
// panels-html.mjs) and by the React components (HITLD-729), so both say the same thing. Pure: no
// Node module and no browser API, so it runs on both sides.

/** "1 item" or "3 items". @param {number} n @param {string} one @param {string} [many] */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Text cut to `max` characters, ending with an ellipsis when cut. @param {string} t @param {number} max */
export const cut = (t, max) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`);

/** The longest value a cell shows. */
export const CELL_MAX = 200;
/** The longest title a list shows. */
export const TITLE_MAX = 120;
/** The longest label a picture shows. */
export const LABEL_MAX = 24;
/** The most rows a timeline's picture draws; its list has every entry. */
export const TIMELINE_ROWS = 60;

/** A value as text: none as a dash, a list joined, true and false as yes and no. @param {unknown} v @returns {string} */
export function valueText(v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/** A group's name: none as "(none)". @param {unknown} v */
export const groupName = (v) => (v == null ? '(none)' : valueText(v));

/** One filter in words. @param {Record<string, any>} w */
export function filterText(w) {
  const [test, v] = /** @type {[string, any]} */ (Object.entries(w).find(([k]) => k !== 'field'));
  const list = () => (Array.isArray(v) ? v : [v]).map(valueText).join(' or ');
  const said =
    test === 'is'
      ? `is ${valueText(v)}`
      : test === 'not'
        ? `is not ${valueText(v)}`
        : test === 'in'
          ? `is ${list()}`
          : test === 'not_in'
            ? `is not ${list()}`
            : test === 'set'
              ? v
                ? 'is set'
                : 'is not set'
              : `is ${test === 'at_least' ? 'at least' : 'at most'} ${valueText(v)}`;
  return `${w.field} ${said}`;
}

/** What a panel holds, in a sentence. @param {{ matched: number, where: Record<string, any>[] }} p */
export function holds(p) {
  const where = p.where.length ? ` where ${p.where.map(filterText).join(', and ')}` : '';
  return `${count(p.matched, 'item')}${where}.`;
}

/** "And 3 more items not shown.", or empty. @param {number} n */
export const moreText = (n) => (n ? `And ${count(n, 'more item')} not shown.` : '');

/** Days between two dates. @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * The line saying when and where the page's data was read (HITLD-689, HITLD-729): the time the
 * contract was generated, the tracker's commit and branch when it has one, and the private store on
 * the machine that generated it.
 * @param {{ generated_at: string, api_version: number, work?: { source?: { commit?: string | null, branch?: string | null } } | null }} r
 */
export function readNote(r) {
  const at = r.work?.source;
  const tracker = r.work
    ? ` from the tracker in this repository${at?.commit ? ` at commit ${at.commit}` : ''}${at?.branch ? ` on ${at.branch}` : ''},`
    : '';
  return `Read ${r.generated_at}${tracker} and from the ledger and quotas in the private store on the machine that generated it. Data contract version ${r.api_version}. Local data only.`;
}
