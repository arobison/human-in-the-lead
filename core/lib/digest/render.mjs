// The digest as text that fits one phone screen (design part 12.2, "a report that grows past its
// budget is shortened, not sent longer"). A digest is assembled from sections, each built by a
// named part (core/lib/digest/parts.mjs). This file knows nothing about what a section holds: it
// gives each one the lines it can have, in the order of their rank, and shortens a section by
// leaving out its last entries and saying how many.

/**
 * The size budget of one digest message: at most this many lines, each at most this many
 * characters, so the whole is at most `lines * width` characters. A phone shows about this much
 * without scrolling; a line longer than the width wraps and takes two.
 */
export const DIGEST_BUDGET = Object.freeze({ lines: 30, width: 56 });

/**
 * @typedef {object} Section one block of a digest
 * @property {string} id the part that made it
 * @property {number} rank who keeps its lines when the digest is too long: lowest first
 * @property {string} [title] the heading; the count of entries is added. A section with no title
 *   is its entries alone
 * @property {string[][]} entries each entry is the lines it takes, already clipped to the width
 * @property {string} [noun] what its entries are, for "+3 more <noun>"
 * @property {string[]} [notes] lines that go with the section when it fits whole or nearly (how
 *   to reverse a call)
 * @property {boolean} news whether it makes a digest worth sending. A section that is not news is
 *   shown for context when there is room, and never makes a digest on its own
 */

/**
 * Cut a line to the width, ending with an ellipsis when something was cut.
 * @param {string} text @param {number} [width]
 */
export function clip(text, width = DIGEST_BUDGET.width) {
  const indent = /^[ ]*/.exec(text)?.[0] ?? '';
  const t = indent + text.replace(/\s+/g, ' ').trim();
  return t.length <= width ? t : `${t.slice(0, Math.max(0, width - 1)).trimEnd()}…`;
}

/**
 * Word-wrap text into at most `max` lines, the first line prefixed by `first` and the rest by
 * `rest`; what does not fit ends the last line with an ellipsis.
 * @param {string} text @param {string} first @param {string} rest
 * @param {number} max @param {number} [width]
 * @returns {string[]}
 */
export function wrap(text, first, rest, max, width = DIGEST_BUDGET.width) {
  /** @type {string[]} */
  const lines = [];
  let line = first;
  let empty = true;
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!empty && line.length + 1 + word.length > width) {
      if (lines.length + 1 >= max) {
        lines.push(clip(`${line} ${words.slice(i).join(' ')}`, width));
        return lines;
      }
      lines.push(line);
      line = rest + word;
    } else {
      line += (empty ? '' : ' ') + word;
    }
    empty = false;
  }
  lines.push(clip(line, width));
  return lines;
}

/** @param {Section} s */
const heading = (s) => (s.title ? `${s.title} (${s.entries.length})` : null);

/**
 * The shortest a section can be and still say it is there: its heading with the count, or the
 * first line of a section with no heading.
 * @param {Section} s @returns {string[]}
 */
export function minimalLines(s) {
  const h = heading(s);
  if (h !== null) return [h];
  return s.entries.length ? [s.entries[0][0]] : [];
}

/**
 * The lines a section takes in `room` lines. Whole when it fits. Otherwise its heading, the
 * entries that fit and "+N more", keeping its notes when there is room for them as well.
 * @param {Section} s @param {number} room
 * @returns {{ lines: string[], omitted: number }}
 */
export function fitSection(s, room) {
  const head = heading(s);
  const headLines = head === null ? [] : [head];
  const notes = s.notes ?? [];
  const whole = [...headLines, ...s.entries.flat(), ...(s.entries.length ? notes : [])];
  if (whole.length <= room) return { lines: whole, omitted: 0 };
  if (room <= 0) return { lines: [], omitted: s.entries.length };
  if (room === 1 || s.entries.length === 0) {
    return { lines: minimalLines(s).slice(0, 1), omitted: s.entries.length };
  }
  const more = (/** @type {number} */ n) => `+${n} more ${s.noun ?? 'entries'}`;
  /** @param {number} space */
  const take = (space) => {
    /** @type {string[]} */
    const out = [];
    let n = 0;
    for (const e of s.entries) {
      if (out.length + e.length > space) break;
      out.push(...e);
      n++;
    }
    return { out, n };
  };
  // With the notes, if at least one entry still fits beside them.
  for (const keep of [notes, /** @type {string[]} */ ([])]) {
    const { out, n } = take(room - headLines.length - 1 - keep.length);
    if (n === 0) continue;
    const omitted = s.entries.length - n;
    return { lines: [...headLines, ...out, more(omitted), ...keep], omitted };
  }
  return { lines: minimalLines(s).slice(0, 1), omitted: s.entries.length };
}

/**
 * Give every section the room it can have, then put them in the order they were given. Sections
 * are served by rank: each gets what it needs from the room left, after the shortest form of every
 * section ranked after it. The lines never exceed `room`, unless the shortest forms alone do.
 * @param {Section[]} sections in the order they are shown
 * @param {number} room
 * @returns {{ lines: string[], omitted: Record<string, number> }}
 */
export function layOut(sections, room) {
  const byRank = [...sections].sort((a, b) => a.rank - b.rank);
  const minimum = new Map(byRank.map((s) => [s.id, minimalLines(s).length]));
  /** @type {Map<string, { lines: string[], omitted: number }>} */
  const given = new Map();
  let left = room;
  byRank.forEach((s, i) => {
    const reserve = byRank.slice(i + 1).reduce((sum, t) => sum + (minimum.get(t.id) ?? 0), 0);
    const fitted = fitSection(s, Math.max(0, left - reserve));
    given.set(s.id, fitted);
    left -= fitted.lines.length;
  });
  /** @type {string[]} */
  const lines = [];
  /** @type {Record<string, number>} */
  const omitted = {};
  for (const s of sections) {
    const g = /** @type {{ lines: string[], omitted: number }} */ (given.get(s.id));
    lines.push(...g.lines);
    if (g.omitted > 0) omitted[s.id] = g.omitted;
  }
  return { lines, omitted };
}
