// The property forms an invariant can take (design 6.3, kinds of test). Each turns the exports it
// names and one argument list into a verdict: null when the invariant holds for those arguments,
// or what broke. The same rules write the regression test for a break (regression.mjs), so a
// recorded test checks exactly what the pass checked.

import { isDeepStrictEqual, inspect } from 'node:util';
import { hashSeed, seededShuffle } from '../eval/util.mjs';

/** The forms, with what each needs beside the target export. */
export const FORMS = Object.freeze({
  'round-trip': 'inverse(target(x)) equals x',
  idempotent: 'target(target(x)) equals target(x)',
  differential: 'target(...args) equals oracle(...args), a thrown error matching a thrown error',
  'order-independent': 'target gives the same result when its first argument, a list, is reordered',
  total: 'target(...args) returns without throwing',
  holds: 'target(...args), a property the area wrote, returns true',
});

/**
 * @typedef {{ form: keyof typeof FORMS }} FormSpec
 * @typedef {{ target: Function, second?: Function }} Fns target, and the inverse or oracle
 * @typedef {{ message: string, variant?: unknown[] }} Break
 */

/** @param {unknown} v */
export const show = (v) => inspect(v, { depth: 6, breakLength: Infinity, maxStringLength: 400 });

/** @param {() => unknown} f @returns {{ value: unknown } | { threw: string }} */
function outcome(f) {
  try {
    return { value: f() };
  } catch (e) {
    return { threw: e instanceof Error ? e.message : String(e) };
  }
}

/** @param {{ value: unknown } | { threw: string }} o */
const said = (o) => ('threw' in o ? `threw ${JSON.stringify(o.threw)}` : `gave ${show(o.value)}`);

/**
 * The reorderings of a list tried for order-independence: reversed, rotated, then seeded shuffles
 * drawn from the list itself, so the same arguments always give the same reorderings.
 * @param {unknown[]} list @returns {unknown[][]}
 */
export function reorderings(list) {
  if (list.length < 2) return [];
  const seed = hashSeed(JSON.stringify(list));
  return [
    [...list].reverse(),
    [...list.slice(1), list[0]],
    ...[0, 1, 2, 3].map((i) => seededShuffle(list, seed + i)),
  ].filter((v) => !isDeepStrictEqual(v, list));
}

/**
 * Whether the invariant holds for these arguments, or what broke.
 * @param {FormSpec} inv @param {Fns} fns @param {unknown[]} args
 * @returns {Break | null}
 */
export function evaluate(inv, fns, args) {
  const { target, second } = fns;
  const copy = () => structuredClone(args);
  switch (inv.form) {
    case 'total': {
      const o = outcome(() => target(...copy()));
      return 'threw' in o ? { message: `target ${said(o)}` } : null;
    }
    case 'holds': {
      const o = outcome(() => target(...copy()));
      if ('threw' in o) return { message: `the property ${said(o)}` };
      return o.value === true ? null : { message: `the property ${said(o)}, not true` };
    }
    case 'idempotent': {
      const once = outcome(() => target(...copy()));
      if ('threw' in once) return { message: `target ${said(once)}` };
      const twice = outcome(() => target(structuredClone(once.value), ...copy().slice(1)));
      if ('threw' in twice) return { message: `applied twice, target ${said(twice)}` };
      return isDeepStrictEqual(once.value, twice.value)
        ? null
        : { message: `once ${said(once)}; twice ${said(twice)}` };
    }
    case 'round-trip': {
      if (!second) throw new Error('round-trip needs an inverse');
      const there = outcome(() => target(...copy()));
      if ('threw' in there) return { message: `target ${said(there)}` };
      const back = outcome(() => second(structuredClone(there.value)));
      if ('threw' in back) return { message: `target ${said(there)}; inverse ${said(back)}` };
      return isDeepStrictEqual(back.value, args[0])
        ? null
        : { message: `target ${said(there)}; inverse ${said(back)}, not ${show(args[0])}` };
    }
    case 'differential': {
      if (!second) throw new Error('differential needs an oracle');
      const got = outcome(() => target(...copy()));
      const want = outcome(() => second(...copy()));
      if ('threw' in got && 'threw' in want) return null;
      if ('value' in got && 'value' in want && isDeepStrictEqual(got.value, want.value)) {
        return null;
      }
      return { message: `target ${said(got)}; oracle ${said(want)}` };
    }
    case 'order-independent': {
      if (!Array.isArray(args[0])) throw new Error('order-independent needs a list first argument');
      const base = outcome(() => target(...copy()));
      for (const order of reorderings(args[0])) {
        const variant = [order, ...args.slice(1)];
        const other = outcome(() => target(...structuredClone(variant)));
        const same =
          ('threw' in base && 'threw' in other) ||
          ('value' in base && 'value' in other && isDeepStrictEqual(base.value, other.value));
        if (!same) {
          return {
            message: `in order ${show(args[0])} target ${said(base)}; in order ${show(order)} it ${said(other)}`,
            variant,
          };
        }
      }
      return null;
    }
  }
  throw new Error(`unknown form ${JSON.stringify(inv.form)}`);
}
