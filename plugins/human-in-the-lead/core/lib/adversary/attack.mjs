// The adversarial pass (design 6.3, step 2): attack every invariant in an area's registry with
// generated inputs, in a separate Node process with no secrets in its environment, and report each
// break with its smallest counterexample. The probe's environment holds only PATH: it is not a
// sandbox, and the code under attack can read files and reach the network like any test.
//
// A break is known when a regression test still marked todo holds the same counterexample: its
// fix is open, so the pass passes over it and keeps looking for another break of the same
// invariant. The pass also runs those open tests, and fails when one no longer fails: its fix
// landed, and its todo mark must go.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSeed } from '../eval/util.mjs';
import { counterexampleDigest, FORMS } from './forms.mjs';
import { readRegression, regressionFails } from './regression.mjs';

const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));
/** The marker probe.mjs prints before its results. */
const MARK = '@@hitld-adversary-probe@@';
export const DEFAULT_RUNS = 300;
export const DEFAULT_SEED = 1;
/** How many seeds a pass tries, from its seed on: a break one seed misses, the next may find. */
export const SEEDS_PER_PASS = 4;

/**
 * @typedef {import('./registry.mjs').Registry} Registry
 * @typedef {import('./registry.mjs').Invariant} Invariant
 * @typedef {{ area: string, invariant: string, statement: string, form: string, args: unknown[],
 *   variant?: unknown[], message: string, found_at: number, seed: number }} Break
 * @typedef {{ area: string, registry: string, invariants: number, seed: number,
 *   checked: { id: string, runs: number }[], breaks: Break[], known: (Break & { tests: string[] })[],
 *   errors: string[] }} AreaResult
 */

/**
 * The regression tests in a tests directory still marked todo (their fix is not done), with the
 * counterexample each holds; for one invariant, or all.
 * @param {string} root @param {string} testsDir @param {string} [id]
 * @returns {(import('./regression.mjs').Regression & { test: string })[]}
 */
export function openRegressions(root, testsDir, id) {
  const dir = join(root, testsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('adversary-') && /\.test\.m?js$/.test(f))
    .sort()
    .flatMap((f) => {
      const r = readRegression(readFileSync(join(dir, f), 'utf8'));
      if (!r || !r.marked || (id !== undefined && r.invariant !== id)) return [];
      return [{ ...r, test: `${testsDir.replace(/\/$/, '')}/${f}` }];
    });
}

/**
 * The probe's seed for one invariant: from the pass's seed, the area and the invariant.
 * @param {number} seed @param {string} area @param {string} id
 */
export const invariantSeed = (seed, area, id) => hashSeed(`${area}:${id}`, seed);

/**
 * Run the probe on a job.
 * @param {string} root @param {Record<string, unknown>[]} invariants @param {number} timeoutMs
 * @returns {{ results: import('./probe.mjs').ProbeResult[] } | { error: string }}
 */
function runProbe(root, invariants, timeoutMs) {
  // A marker the code under attack cannot know, so it cannot print results of its own.
  const nonce = randomBytes(12).toString('hex');
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: root,
    input: JSON.stringify({ invariants, nonce }),
    encoding: 'utf8',
    // Only what Node needs to start: no tokens, no HITLD_ settings, no NODE_OPTIONS.
    env: { PATH: process.env.PATH ?? '' },
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { error: `the probe did not finish: ${r.error.message}` };
  const mark = `${MARK}${nonce}`;
  const at = (r.stdout ?? '').lastIndexOf(mark);
  if (r.status !== 0 || at < 0) {
    const why = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ');
    return { error: `the probe failed (exit ${r.status}): ${why}` };
  }
  return JSON.parse(r.stdout.slice(at + mark.length));
}

/**
 * The probe's view of an invariant.
 * @param {string} root @param {string} area @param {Invariant} inv @param {number} seed
 * @param {string[]} known @param {unknown[]} [check]
 */
function probeInvariant(root, area, inv, seed, known, check) {
  const second = inv.form === 'round-trip' ? inv.inverse : inv.oracle;
  return {
    id: inv.id,
    form: inv.form,
    module: join(root, inv.module),
    target: inv.target,
    ...(second ? { second, second_module: join(root, inv.oracle_module ?? inv.module) } : {}),
    args: inv.args,
    runs: inv.runs ?? DEFAULT_RUNS,
    seeds: Array.from({ length: SEEDS_PER_PASS }, (_, i) => invariantSeed(seed + i, area, inv.id)),
    known,
    ...(check ? { check } : {}),
  };
}

/**
 * Attack an area's invariants, or check given arguments against one of them.
 * @param {string} root
 * @param {Registry} registry
 * @param {{ seed?: number, invariants?: string[], check?: unknown[], timeoutMs?: number }} [options]
 *   invariants: only these; check: these arguments only (with one invariant), and the open
 *   regression tests are not run
 * @returns {AreaResult}
 */
export function attackArea(root, registry, options = {}) {
  const seed = options.seed ?? DEFAULT_SEED;
  /** @type {AreaResult} */
  const result = {
    area: registry.area,
    registry: registry.path,
    invariants: 0,
    seed,
    checked: [],
    breaks: [],
    known: [],
    errors: [...registry.errors],
  };
  if (!registry.data) return result;
  const data = registry.data;
  const chosen = data.invariants.filter(
    (i) => !options.invariants || options.invariants.includes(i.id),
  );
  for (const id of options.invariants ?? []) {
    if (!data.invariants.some((i) => i.id === id)) result.errors.push(`no invariant ${id}`);
  }
  result.invariants = chosen.length;
  if (!chosen.length) return result;
  const open = openRegressions(root, data.tests_dir).filter((r) =>
    chosen.some((i) => i.id === r.invariant),
  );
  if (!options.check) {
    for (const r of open) {
      if (!regressionFails(root, r.test).fails) {
        result.errors.push(
          `${r.test} passes now: its fix landed, so remove its todo mark (it stays as a regression test)`,
        );
      }
    }
  }
  const knownOf = (/** @type {string} */ id) =>
    open.filter((r) => r.invariant === id).map((r) => r.digest);
  const out = runProbe(
    root,
    chosen.map((i) =>
      probeInvariant(
        root,
        registry.area,
        i,
        seed,
        options.check ? [] : knownOf(i.id),
        options.check,
      ),
    ),
    options.timeoutMs ?? 120_000,
  );
  if ('error' in out) {
    result.errors.push(out.error);
    return result;
  }
  for (const r of out.results) {
    const inv = /** @type {Invariant} */ (chosen.find((i) => i.id === r.id));
    if (r.error) result.errors.push(`invariant ${r.id}: ${r.error}`);
    else result.checked.push({ id: r.id, runs: r.runs });
    if (!r.break) continue;
    /** @type {Break} */
    const b = {
      area: registry.area,
      invariant: inv.id,
      statement: inv.statement,
      form: `${inv.form}: ${FORMS[inv.form]}`,
      ...r.break,
      seed,
    };
    const same = open.filter(
      (o) => o.invariant === inv.id && o.digest === counterexampleDigest(r.break ?? { args: [] }),
    );
    if (same.length) result.known.push({ ...b, tests: same.map((o) => o.test) });
    else result.breaks.push(b);
  }
  for (const o of open) {
    if (result.known.some((k) => k.tests.includes(o.test))) continue;
    const inv = /** @type {Invariant} */ (chosen.find((i) => i.id === o.invariant));
    result.known.push({
      area: registry.area,
      invariant: o.invariant,
      statement: inv.statement,
      form: `${inv.form}: ${FORMS[inv.form]}`,
      args: o.args,
      ...(o.variant ? { variant: o.variant } : {}),
      message: o.message,
      found_at: 0,
      seed,
      tests: [o.test],
    });
  }
  return result;
}
