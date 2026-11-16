// Reading what sizing and the brief need from an item: its body sections, its touches, and how
// path globs relate to each other and to the area map. Pure.

import { globMatch, matchesAny } from '../precedent/glob.mjs';

/**
 * @typedef {Record<string, any>} Item a tracker entity of kind work (or external), plus `body`
 */

/**
 * The text of a `## <title>` section of the body, or null when there is none.
 * @param {string | undefined} body @param {string} title
 * @returns {string | null}
 */
export function section(body, title) {
  if (typeof body !== 'string') return null;
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const want = title.toLowerCase();
  const start = lines.findIndex(
    (l) =>
      /^##\s+/.test(l) &&
      l
        .replace(/^##\s+/, '')
        .trim()
        .toLowerCase() === want,
  );
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##?\s+/.test(l));
  const text = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return text;
}

/** Whether "Done when" is executable: it names a command or a test that exists or is trivial to write. @param {Item} item */
export function doneWhenExecutable(item) {
  const text = section(item.body, 'Done when');
  if (!text) return false;
  return /`[^`]+`/.test(text) || /\b(test|tests|passes|check|assert|exit code)\b/i.test(text);
}

/**
 * Where the item's plan is: a link or path with a section in the Plan section (for the brief to
 * point at), or the item's own Plan section, or none.
 * @param {Item} item
 * @returns {{ kind: 'pointer', ref: string } | { kind: 'section' } | { kind: 'none' }}
 */
export function planRef(item) {
  const text = section(item.body, 'Plan');
  if (text === null || text === '') {
    if (typeof item.plan === 'string' && item.plan) return { kind: 'pointer', ref: item.plan };
    return { kind: 'none' };
  }
  const link = /\]\(([^)\s]+)\)/.exec(text) ?? /`([\w./-]+\.md(?:#[\w.-]+)?)`/.exec(text);
  if (link) return { kind: 'pointer', ref: link[1] };
  return { kind: 'section' };
}

/** Whether the plan is specific to files and functions. @param {Item} item */
export function planSpecific(item) {
  const text = section(item.body, 'Plan') ?? '';
  const concreteTouches = (item.touches ?? []).some((/** @type {string} */ g) => !/[*?]/.test(g));
  return (
    /[\w-]+\/[\w./-]+\.\w+|`[\w.]+\(\)`|\b[\w-]+\.(m?js|ts|py|rs|go|java|c|cc|h|md|json)\b/.test(
      text,
    ) || concreteTouches
  );
}

/** A concrete path a glob stands for, for testing it against other globs. @param {string} glob */
export const sample = (glob) =>
  glob
    .replace(/\*\*\/?/g, 'x/')
    .replace(/\*/g, 'x')
    .replace(/\?/g, 'x')
    .replace(/\/$/, '/x');

/**
 * Whether two path globs can name a common path. A heuristic: each glob's sample path is tested
 * against the other, which is exact for the prefix-style globs items use (src/a/**, src/a/b.js).
 * @param {string} a @param {string} b
 */
export function globsOverlap(a, b) {
  return a === b || globMatch(a, sample(b)) || globMatch(b, sample(a));
}

/**
 * The share of `globs` that overlap any of `others`.
 * @param {string[]} globs @param {string[]} others
 */
export function overlapShare(globs, others) {
  if (!globs.length || !others.length) return 0;
  const hit = globs.filter((g) => others.some((o) => globsOverlap(g, o))).length;
  return hit / globs.length;
}

/**
 * The areas the item's touches fall in, from policy.rights.areas, plus its own area.
 * @param {Item} item @param {Record<string, any>} policy
 * @returns {string[]}
 */
export function areasTouched(item, policy) {
  /** @type {Set<string>} */
  const out = new Set(item.area ? [item.area] : []);
  for (const area of policy.rights?.areas ?? []) {
    const paths = /** @type {string[]} */ (area.paths ?? []);
    if (
      (item.touches ?? []).some((/** @type {string} */ t) => paths.some((p) => globsOverlap(t, p)))
    ) {
      out.add(area.name);
    }
  }
  return [...out].sort();
}

/**
 * Whether every glob falls inside the given globs.
 * @param {string[]} touches @param {string[]} within
 */
export function allWithin(touches, within) {
  return touches.length > 0 && touches.every((t) => matchesAny(within, sample(t)));
}

/** A short slug for a branch name from an item title. @param {string} title */
export function slugify(title) {
  return (
    String(title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'work'
  );
}
