// An item's touches for the overlap rule and the brief (design part 5.2): the item's own, or,
// when it has none, touches derived from its text and the repository, recorded as derived. Also
// what the brief says about them: the dispatches in flight whose touches overlap, and the merges
// since the item was planned that changed the same paths.
//
// Deriving is a lookup, not a judgment: a path or module the item's text names counts only when
// the repository has it. The owner or the orchestrator corrects derived touches by writing
// `touches` on the item, which always wins.

import { git } from '../tracker/files/tree.mjs';
import { matchesAny } from '../precedent/glob.mjs';
import { globsOverlap } from './item.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {{ touches: string[], source: 'item' | 'derived' | 'none' }} Touches
 * @typedef {{ dispatch: string, item: string, paths: string[] }} Overlap
 * @typedef {{ commit: string, items: string[], subject: string, paths: string[] }} Merge
 */

/** At most this many derived touches: past it, the text names too much to be a scope. */
export const MAX_DERIVED = 20;

/** Candidate paths in text: a token with a slash, or a file name with an extension. */
const CANDIDATE =
  /(?:[\w.@*-]+\/)+[\w.@*-]*|[\w@-][\w.@-]*\.(?:m?[jt]sx?|c?js|json|ya?ml|toml|md|py|rs|go|java|rb|sh|css|html|sql|proto)\b/g;

/** @param {string} raw */
const clean = (raw) =>
  raw
    .replace(/#.*$/, '')
    .replace(/^\.\//, '')
    .replace(/[.,;:)]+$/, '');

/**
 * Touches derived from an item's text: each path or module the title and body name that the
 * repository has. A file is itself; a directory is `<dir>/**`; a glob counts when it matches a
 * file; a bare file name or a partial path (`brief.mjs`, `dispatch/brief.mjs`) is the file it
 * ends, when at most three files end that way. Tracker paths (`inlineGlobs`: dispatch.inline_globs
 * and the tracker's work_dir) are left out: the item's own file changes on every branch.
 * @param {Item} item @param {string[]} files the repository's tracked files
 * @param {{ inline?: string[] }} [o]
 * @returns {string[]}
 */
export function deriveTouches(item, files, o = {}) {
  const text = `${item.title ?? ''}\n${typeof item.body === 'string' ? item.body : ''}`;
  const inline = o.inline ?? [];
  const tracked = new Set(files);
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of text.matchAll(CANDIDATE)) {
    const c = clean(m[0]);
    if (!c || c.includes('..') || c.startsWith('/') || /^https?:/.test(c)) continue;
    /** @type {string[]} */
    let hits = [];
    if (/[*?]/.test(c)) {
      if (files.some((f) => matchesAny([c], f))) hits = [c];
    } else if (tracked.has(c)) {
      hits = [c];
    } else {
      const dir = c.replace(/\/$/, '');
      if (files.some((f) => f.startsWith(`${dir}/`))) hits = [`${dir}/**`];
      else if (!c.endsWith('/')) {
        const ends = files.filter((f) => f.endsWith(`/${c}`));
        if (ends.length > 0 && ends.length <= 3) hits = ends;
      }
    }
    for (const h of hits) {
      if (!matchesAny(inline, h.replace(/\*\*$/, 'x'))) out.add(h);
    }
  }
  return [...out].sort().slice(0, MAX_DERIVED);
}

/**
 * The touches the overlap rule and the brief use: the item's own when it has any, else the
 * recorded derived ones, else derived now.
 * @param {Item} item
 * @param {{ files?: string[] | null, inline?: string[], recorded?: string[] | null }} [o]
 *   recorded: touches already derived for this item (on its dispatched event)
 * @returns {Touches}
 */
export function touchesOf(item, o = {}) {
  const own = /** @type {string[]} */ (item.touches ?? []);
  if (own.length) return { touches: own, source: 'item' };
  if (o.recorded?.length) return { touches: o.recorded, source: 'derived' };
  const derived = o.files ? deriveTouches(item, o.files, { inline: o.inline }) : [];
  return derived.length ? { touches: derived, source: 'derived' } : { touches: [], source: 'none' };
}

/** The repository's tracked files, or none when git cannot list them. @param {string} repoRoot */
export const trackedFiles = (repoRoot) =>
  git(repoRoot, ['ls-files', '-z'], { allowFail: true }).split('\0').filter(Boolean);

/**
 * The dispatches in flight whose touches overlap these, each with the paths of its own that do.
 * @param {string[]} touches
 * @param {{ dispatch: string, item: string, touches?: string[] }[]} running
 * @returns {Overlap[]}
 */
export function overlapsInFlight(touches, running) {
  /** @type {Overlap[]} */
  const out = [];
  if (!touches.length) return out;
  for (const d of running) {
    const paths = (d.touches ?? []).filter((t) => touches.some((g) => globsOverlap(g, t)));
    if (paths.length) out.push({ dispatch: d.dispatch, item: d.item, paths });
  }
  return out;
}

/** Work-Item trailers or a "(KEY-n)" at the end of a subject. @param {string} subject @param {string} trailers */
const itemsOf = (subject, trailers) => {
  const named = trailers
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (named.length) return [...new Set(named)];
  const m = /\(([A-Z][A-Z0-9]*-\d+(?:\s*(?:,|and|to)\s*\d+)*)\)\s*$/.exec(subject);
  return m ? [m[1]] : [];
};

/**
 * The commits on main since the item was planned (the first commit on main that wrote
 * `state: planned` into its file) that change files under its touches, newest first. None when
 * the item has no file, no touches, or was never planned on main.
 * @param {{ repoRoot: string, main: string, path?: string, touches: string[], limit?: number }} o
 * @returns {Merge[]}
 */
export function mergedSincePlanned(o) {
  if (!o.path || !o.touches.length) return [];
  const planned = git(
    o.repoRoot,
    [
      'log',
      '--first-parent',
      '--reverse',
      '--format=%H',
      '-G',
      '^state: *planned',
      o.main,
      '--',
      o.path,
    ],
    { allowFail: true },
  )
    .split('\n')
    .find(Boolean);
  if (!planned) return [];
  const log = git(
    o.repoRoot,
    [
      'log',
      '--first-parent',
      '--name-only',
      '--format=%x1e%H%x1f%s%x1f%(trailers:key=Work-Item,valueonly,separator=%x2C)%x1f',
      `${planned}..${o.main}`,
    ],
    { allowFail: true },
  );
  /** @type {Merge[]} */
  const out = [];
  for (const rec of log.split('\x1e').filter((r) => r.trim())) {
    const [commit, subject = '', trailers = '', names = ''] = rec.split('\x1f');
    const paths = names
      .split('\n')
      .map((s) => s.trim())
      .filter((f) => f && f !== o.path && matchesAny(o.touches, f));
    if (paths.length) {
      out.push({ commit: commit.trim(), items: itemsOf(subject, trailers), subject, paths });
    }
    if (out.length >= (o.limit ?? 10)) break;
  }
  return out;
}
