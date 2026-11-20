// Properties of the core area that its invariant registry names (kb/areas/core/invariants.json,
// design 6.3). Each takes generated arguments and returns true when the invariant holds for them.
// They are the area's own statements of what must hold; `hitld adversary attack` draws the inputs.

import { posix } from 'node:path';
import { globMatch, safePath } from '../../lib/precedent/glob.mjs';
import { isCodeRunningKey } from '../../lib/schema/validate.mjs';
import { parseItem, renderItem } from '../../lib/tracker/files/frontmatter.mjs';

/**
 * A slow glob matcher written from the rules in glob.mjs's header, without regular expressions:
 * the oracle for globMatch. `*` matches within a segment, `**` across segments, `**\/` zero or
 * more directories, `?` one character other than a slash. Both sides are normalized first.
 * @param {string} glob @param {string} path
 */
export function slowGlobMatch(glob, path) {
  const norm = (/** @type {string} */ p) => posix.normalize(p.replace(/\\/g, '/'));
  const g = norm(glob);
  const p = norm(path);
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {number} i @param {number} j @returns {boolean} */
  const at = (i, j) => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r;
    if (i === g.length) r = j === p.length;
    else if (g.startsWith('**/', i)) {
      r = at(i + 3, j);
      for (let k = j; !r && k < p.length; k++) if (p[k] === '/') r = at(i + 3, k + 1);
    } else if (g.startsWith('**', i)) {
      r = false;
      for (let k = j; !r && k <= p.length; k++) r = at(i + 2, k);
    } else if (g[i] === '*') {
      r = false;
      for (let k = j; !r && k <= p.length; k++) {
        r = at(i + 1, k);
        if (p[k] === '/') break;
      }
    } else if (g[i] === '?') r = j < p.length && p[j] !== '/' && at(i + 1, j + 1);
    else r = j < p.length && p[j] === g[i] && at(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return at(0, 0);
}

/**
 * A path one `*` glob matches under a directory, the `**` glob over the same directory matches
 * too: `**` reaches everything `*` does.
 * @param {string} dir @param {string} rest
 */
export function doubleStarCoversStar(dir, rest) {
  const path = `${dir}/${rest}`;
  return !globMatch(`${dir}/*`, path) || globMatch(`${dir}/**`, path);
}

/**
 * A path safePath accepts names a place inside the repository, and reads the same when given
 * again.
 * @param {string} path
 */
export function safePathStaysInside(path) {
  const r = safePath(path);
  if ('error' in r) return true;
  if (r.path.startsWith('/') || r.path.split('/').includes('..')) return false;
  if (r.path === '') return true;
  const again = safePath(r.path);
  return 'path' in again && again.path === r.path;
}

/**
 * Whether a key names code to run does not depend on how it is spelled: snake_case, kebab-case,
 * camelCase and UPPER_CASE forms of the same words get the same answer.
 * @param {string[]} words
 */
export function codeKeySpellingAgrees(words) {
  const snake = words.join('_');
  const forms = [
    snake,
    words.join('-'),
    words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''),
    snake.toUpperCase(),
  ];
  const answers = forms.map(isCodeRunningKey);
  return answers.every((a) => a === answers[0]);
}

/**
 * Front matter written by renderItem reads back as the same values with parseItem. An empty
 * value is not written at all, so the generators draw none.
 * @param {string} title @param {string[]} needs
 */
export function frontMatterRoundTrip(title, needs) {
  const data = { id: 'W-1', title, ...(needs.length ? { needs } : {}) };
  const parsed = parseItem(renderItem(data, ['id', 'title', 'needs'], '\nBody.\n'));
  if (parsed.errors.length || !parsed.data) return false;
  const back = parsed.data;
  return back.title === title && JSON.stringify(back.needs ?? []) === JSON.stringify(needs);
}
