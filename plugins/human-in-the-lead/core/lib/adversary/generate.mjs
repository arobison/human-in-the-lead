// Input generators for the adversarial pass (design 6.3): plain data in an invariant registry
// describes the inputs an invariant must hold for, and a seeded generator draws them, so the same
// seed finds the same counterexample on any machine. Shrinking makes a found counterexample small
// while it stays inside the described domain, so the regression test it becomes is readable.

import { seededRandom } from '../eval/util.mjs';

/**
 * @typedef {{ type: 'integer', min?: number, max?: number }
 *   | { type: 'boolean' }
 *   | { type: 'string', chars?: string, min_length?: number, max_length?: number }
 *   | { type: 'enum', values: unknown[] }
 *   | { type: 'array', items: Gen, min_items?: number, max_items?: number }
 *   | { type: 'object', properties: Record<string, Gen> }} Gen
 */

const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/** @param {Gen & { type: 'integer' }} g */
const bounds = (g) => [g.min ?? -1000, g.max ?? 1000];

/**
 * Draw one value. Small sizes come first: the size grows with the run number, so early runs try
 * short strings and lists, where most edge cases sit.
 * @param {Gen} g @param {() => number} rand @param {number} size 0..1
 * @returns {unknown}
 */
export function draw(g, rand, size) {
  const int = (/** @type {number} */ lo, /** @type {number} */ hi) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  switch (g.type) {
    case 'integer': {
      const [lo, hi] = bounds(g);
      // Edges often: the bounds, zero and one step from them.
      const r = rand();
      if (r < 0.1) return lo;
      if (r < 0.2) return hi;
      if (r < 0.3 && lo <= 0 && hi >= 0) return 0;
      const span = Math.max(1, Math.round((hi - lo) * Math.max(size, 0.05)));
      const mid = lo <= 0 && hi >= 0 ? 0 : lo;
      return Math.min(hi, Math.max(lo, mid + int(-span, span)));
    }
    case 'boolean':
      return rand() < 0.5;
    case 'string': {
      const chars = g.chars ?? PRINTABLE;
      const min = g.min_length ?? 0;
      const max = Math.max(min, Math.round(min + ((g.max_length ?? 16) - min) * size));
      const n = int(min, max);
      let s = '';
      for (let i = 0; i < n; i++) s += chars[int(0, chars.length - 1)];
      return s;
    }
    case 'enum':
      return structuredClone(g.values[int(0, g.values.length - 1)]);
    case 'array': {
      const min = g.min_items ?? 0;
      const max = Math.max(min, Math.round(min + ((g.max_items ?? 8) - min) * size));
      const n = int(min, max);
      return Array.from({ length: n }, () => draw(g.items, rand, size));
    }
    case 'object': {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, sub] of Object.entries(g.properties)) out[k] = draw(sub, rand, size);
      return out;
    }
  }
  throw new Error(`unknown generator type ${JSON.stringify(/** @type {any} */ (g).type)}`);
}

/**
 * The argument lists for one invariant: `runs` lists, from the seed.
 * @param {Gen[]} args @param {number} seed @param {number} runs
 * @returns {Generator<unknown[]>}
 */
export function* cases(args, seed, runs) {
  const rand = seededRandom(seed);
  for (let i = 0; i < runs; i++) {
    const size = runs <= 1 ? 1 : i / (runs - 1);
    yield args.map((g) => draw(g, rand, size));
  }
}

/**
 * Smaller values inside the generator's domain, simplest first.
 * @param {Gen} g @param {unknown} v
 * @returns {unknown[]}
 */
export function smaller(g, v) {
  /** @type {unknown[]} */
  const out = [];
  switch (g.type) {
    case 'integer': {
      const n = /** @type {number} */ (v);
      const [lo, hi] = bounds(g);
      const target = lo <= 0 && hi >= 0 ? 0 : lo;
      if (n !== target) out.push(target);
      const half = Math.trunc((n + target) / 2);
      if (half !== n && half !== target) out.push(half);
      const step = n > target ? n - 1 : n + 1;
      if (step !== n && step !== target && step !== half) out.push(step);
      break;
    }
    case 'boolean':
      if (v === true) out.push(false);
      break;
    case 'string': {
      const s = /** @type {string} */ (v);
      const min = g.min_length ?? 0;
      const first = (g.chars ?? PRINTABLE)[0];
      if (s.length > min) {
        if (Math.floor(s.length / 2) >= min && s.length > 1) out.push(s.slice(0, s.length / 2));
        for (let i = 0; i < s.length; i++) out.push(s.slice(0, i) + s.slice(i + 1));
      }
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== first) out.push(s.slice(0, i) + first + s.slice(i + 1));
      }
      break;
    }
    case 'enum': {
      const i = g.values.findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
      for (let j = 0; j < i; j++) out.push(structuredClone(g.values[j]));
      break;
    }
    case 'array': {
      const a = /** @type {unknown[]} */ (v);
      const min = g.min_items ?? 0;
      if (a.length > min) {
        for (let i = 0; i < a.length; i++) out.push([...a.slice(0, i), ...a.slice(i + 1)]);
      }
      a.forEach((x, i) => {
        for (const y of smaller(g.items, x)) out.push([...a.slice(0, i), y, ...a.slice(i + 1)]);
      });
      break;
    }
    case 'object': {
      const o = /** @type {Record<string, unknown>} */ (v);
      for (const [k, sub] of Object.entries(g.properties)) {
        for (const y of smaller(sub, o[k])) out.push({ ...o, [k]: y });
      }
      break;
    }
  }
  return out;
}

/**
 * Shrink a failing argument list: keep taking the first smaller candidate that still fails, up to
 * `budget` tries.
 * @param {Gen[]} gens @param {unknown[]} args @param {(args: unknown[]) => boolean} fails
 * @param {number} [budget]
 * @returns {unknown[]}
 */
export function shrink(gens, args, fails, budget = 2000) {
  let current = args;
  let tries = 0;
  let improved = true;
  while (improved && tries < budget) {
    improved = false;
    outer: for (let i = 0; i < gens.length; i++) {
      for (const candidate of smaller(gens[i], current[i])) {
        if (++tries > budget) break outer;
        const next = [...current.slice(0, i), candidate, ...current.slice(i + 1)];
        if (fails(next)) {
          current = next;
          improved = true;
          break outer;
        }
      }
    }
  }
  return current;
}
