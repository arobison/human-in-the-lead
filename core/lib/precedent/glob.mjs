// Path globs, as precedents and areas write them: `*` matches within one path segment, `**`
// matches across segments, `?` matches one character. Paths are relative to the repository root.

import { posix } from 'node:path';

/** @type {Map<string, RegExp>} */
const cache = new Map();

/** @param {string} glob @returns {RegExp} */
function toRegExp(glob) {
  const hit = cache.get(glob);
  if (hit) return hit;
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?'; // "**/" matches zero or more directories
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${out}$`, 'u');
  cache.set(glob, re);
  return re;
}

/** @param {string} p */
const normalize = (p) => posix.normalize(p.replace(/\\/g, '/'));

/**
 * A path as the rules see it: relative to the repository root, with `.` and `..` segments
 * resolved by posix.normalize. A path that is absolute, or still climbs out of the root after
 * normalizing, is refused: it names nothing in the repository, so no area or precedent may claim it.
 * @param {unknown} path
 * @returns {{ path: string } | { error: string }}
 */
export function safePath(path) {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    return { error: 'must be a non-empty path' };
  }
  const slashed = path.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    return {
      error: `${JSON.stringify(path)} is absolute; paths are relative to the repository root`,
    };
  }
  const n = posix.normalize(slashed);
  if (n === '..' || n.startsWith('../') || n.split('/').includes('..')) {
    return { error: `${JSON.stringify(path)} leaves the repository root` };
  }
  return { path: n === '.' ? '' : n };
}

/**
 * Normalize a list of paths or globs, or say which is not allowed.
 * @param {readonly unknown[]} paths
 * @returns {{ paths: string[], errors: string[] }}
 */
export function safePaths(paths) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const errors = [];
  for (const p of paths) {
    const r = safePath(p);
    if ('error' in r) errors.push(r.error);
    else out.push(r.path);
  }
  return { paths: out, errors };
}

/**
 * Whether a path matches a glob.
 * @param {string} glob @param {string} path
 */
export function globMatch(glob, path) {
  return toRegExp(normalize(glob)).test(normalize(path));
}

/**
 * Whether a path matches any of the globs.
 * @param {readonly string[]} globs @param {string} path
 */
export function matchesAny(globs, path) {
  return globs.some((g) => globMatch(g, path));
}
