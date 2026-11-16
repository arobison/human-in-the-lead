// Small helpers the eval runner shares: a seeded random generator, dotted-path access into a
// scenario's state, and file writes confined to a sandbox.

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { realPath } from '../platform/fs.mjs';

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A 32-bit integer from a string and a seed, stable across runs and machines.
 * @param {string} text @param {number} [seed]
 */
export function hashSeed(text, seed = 0) {
  return createHash('sha256').update(`${seed}:${text}`).digest().readUInt32BE(0);
}

/**
 * A seeded random generator (mulberry32): the same seed gives the same sequence everywhere.
 * @param {number} seed
 * @returns {() => number} numbers in [0, 1)
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle a copy of a list with a seeded generator (Fisher-Yates).
 * @template T
 * @param {T[]} list @param {number} seed @returns {T[]}
 */
export function seededShuffle(list, seed) {
  const rand = seededRandom(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** @param {string} path "a.b[0].c" or "a[*].c" -> ["a","b","0","c"] */
function tokens(path) {
  return [...path.matchAll(/([^.[\]]+)|\[(\d+|\*)\]/g)].map((m) => m[1] ?? m[2]);
}

/**
 * Read a dotted path from data. `[n]` indexes an array; `[*]` maps the rest of the path over an
 * array's elements and returns the list of what was found. Only own properties are followed.
 * @param {unknown} root @param {string} path
 * @returns {{ found: boolean, value: unknown }}
 */
export function getPath(root, path) {
  /** @param {unknown} node @param {string[]} rest @returns {{ found: boolean, value: unknown }} */
  const walk = (node, rest) => {
    if (rest.length === 0) return { found: true, value: node };
    const [head, ...tail] = rest;
    if (head === '*') {
      if (!Array.isArray(node)) return { found: false, value: undefined };
      const values = node.map((n) => walk(n, tail)).filter((r) => r.found);
      return { found: true, value: values.map((r) => r.value) };
    }
    if (Array.isArray(node) && /^\d+$/.test(head)) return walk(node[Number(head)], tail);
    if (isObject(node) && Object.hasOwn(node, head)) return walk(node[head], tail);
    return { found: false, value: undefined };
  };
  return walk(root, tokens(path));
}

/** O_NOFOLLOW where the platform has it: opening a symbolic link then fails instead of following it. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** @param {string} dir @param {string} p whether p is dir or inside it */
const within = (dir, p) => p === dir || p.startsWith(dir + sep);

/**
 * Resolve a path inside a sandbox directory, refusing any that leaves it, by its name or through a
 * symbolic link: the real path of the nearest part that exists must be inside the real sandbox. A
 * link that does not resolve (dangling) is refused, since writing to it would create its target.
 * @param {string} sandbox @param {string} rel
 */
export function sandboxPath(sandbox, rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel) || rel.includes('\0')) {
    throw new Error(`path ${JSON.stringify(rel)} must be a non-empty path relative to the sandbox`);
  }
  const base = resolve(sandbox);
  const p = resolve(base, rel);
  if (!within(base, p)) throw new Error(`path ${JSON.stringify(rel)} leaves the sandbox`);
  const realBase = realPath(base);
  let probe = p;
  for (;;) {
    /** @type {import('node:fs').Stats | undefined} */
    let st;
    try {
      st = lstatSync(probe);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
    }
    if (st) {
      let real;
      try {
        real = realPath(probe);
      } catch {
        throw new Error(`path ${JSON.stringify(rel)} goes through a link that does not resolve`);
      }
      if (!within(realBase, real)) {
        throw new Error(`path ${JSON.stringify(rel)} leaves the sandbox through a symbolic link`);
      }
      return p;
    }
    const parent = dirname(probe);
    if (parent === probe) return p;
    probe = parent;
  }
}

/**
 * Read a text file without following a symbolic link at its last component.
 * @param {string} path @returns {string}
 */
export function readSandboxFile(path) {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a file with mode 0644 whatever the umask, so a fixture policy.json is never group-writable
 * (the policy loader refuses one that is). A symbolic link at the last component is refused.
 * @param {string} path @param {string} text
 */
export function writeSandboxFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW,
    0o644,
  );
  try {
    writeFileSync(fd, text);
    fchmodSync(fd, 0o644);
  } finally {
    closeSync(fd);
  }
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
