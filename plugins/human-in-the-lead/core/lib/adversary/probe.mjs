// The probe: runs in its own Node process (attack.mjs starts it), so the code under attack never
// loads into hitld's process and each pass sees the files as they are now. It reads one job as
// JSON on stdin, attacks or checks each invariant, and prints the results as JSON on stdout.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluate } from './forms.mjs';
import { cases, shrink } from './generate.mjs';

/**
 * @typedef {object} ProbeInvariant
 * @property {string} id
 * @property {keyof typeof import('./forms.mjs').FORMS} form
 * @property {string} module absolute
 * @property {string} target
 * @property {string} [second_module] absolute: the inverse's or oracle's module
 * @property {string} [second] the inverse or oracle export
 * @property {import('./generate.mjs').Gen[]} args
 * @property {number} runs
 * @property {number} seed
 * @property {unknown[]} [check] check these arguments only, instead of attacking
 *
 * @typedef {{ id: string, runs: number, error?: string,
 *   break?: { args: unknown[], variant?: unknown[], message: string, found_at: number } }} ProbeResult
 */

/** What precedes the results on stdout. */
// attack.mjs holds the same string; importing this file would run it.
const MARK = '@@hitld-adversary-probe@@';

/** @type {Map<string, Record<string, unknown>>} */
const loaded = new Map();

/** @param {string} path @param {string} name @returns {Promise<Function>} */
async function exported(path, name) {
  if (!loaded.has(path)) loaded.set(path, await import(pathToFileURL(path).href));
  const f = /** @type {Record<string, unknown>} */ (loaded.get(path))[name];
  if (typeof f !== 'function') throw new Error(`${name} is not a function exported by the module`);
  return f;
}

/** @param {ProbeInvariant} inv @returns {Promise<ProbeResult>} */
async function probe(inv) {
  let fns;
  try {
    fns = {
      target: await exported(inv.module, inv.target),
      ...(inv.second
        ? { second: await exported(inv.second_module ?? inv.module, inv.second) }
        : {}),
    };
  } catch (e) {
    return { id: inv.id, runs: 0, error: `could not load: ${e instanceof Error ? e.message : e}` };
  }
  const fails = (/** @type {unknown[]} */ args) => evaluate(inv, fns, args) !== null;
  if (inv.check) {
    const b = evaluate(inv, fns, inv.check);
    return { id: inv.id, runs: 1, ...(b ? { break: { args: inv.check, ...b, found_at: 1 } } : {}) };
  }
  let n = 0;
  for (const args of cases(inv.args, inv.seed, inv.runs)) {
    n++;
    if (!fails(args)) continue;
    const small = shrink(inv.args, args, fails);
    const b = /** @type {import('./forms.mjs').Break} */ (evaluate(inv, fns, small));
    return { id: inv.id, runs: n, break: { args: small, ...b, found_at: n } };
  }
  return { id: inv.id, runs: n };
}

const job = JSON.parse(readFileSync(0, 'utf8'));
/** @type {ProbeResult[]} */
const results = [];
for (const inv of job.invariants) {
  try {
    results.push(await probe(inv));
  } catch (e) {
    results.push({ id: inv.id, runs: 0, error: e instanceof Error ? e.message : String(e) });
  }
}
// After a marker, so what the code under attack prints cannot be taken for the results.
process.stdout.write(`\n${MARK}${JSON.stringify({ results })}`);
