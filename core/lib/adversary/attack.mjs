// The adversarial pass (design 6.3, step 2): attack every invariant in an area's registry with
// generated inputs, in a separate Node process with no secrets in its environment, and report each
// break with its smallest counterexample. A break whose invariant already has a regression test
// still marked todo is known: its fix item is open, and the pass reports it without failing.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSeed } from '../eval/util.mjs';
import { FORMS } from './forms.mjs';

const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));
/** The marker probe.mjs prints before its results. */
const MARK = '@@hitld-adversary-probe@@';
export const DEFAULT_RUNS = 300;
export const DEFAULT_SEED = 1;

/**
 * @typedef {import('./registry.mjs').Registry} Registry
 * @typedef {import('./registry.mjs').Invariant} Invariant
 * @typedef {{ area: string, invariant: string, statement: string, form: string, args: unknown[],
 *   variant?: unknown[], message: string, found_at: number, seed: number }} Break
 * @typedef {{ area: string, registry: string, invariants: number, seed: number,
 *   checked: { id: string, runs: number }[], breaks: Break[], known: (Break & { tests: string[] })[],
 *   errors: string[] }} AreaResult
 */

/** The regression test file name prefix for an invariant. @param {string} id */
export const testPrefix = (id) => `adversary-${id}-`;

/**
 * The regression tests of an invariant that are still marked todo: their fix is not done.
 * @param {string} root @param {string} testsDir @param {string} id
 * @returns {string[]} repository-relative
 */
export function openRegressions(root, testsDir, id) {
  const dir = join(root, testsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(testPrefix(id)) && /\.test\.m?js$/.test(f))
    .filter((f) => /\btodo:\s/.test(readFileSync(join(dir, f), 'utf8')))
    .sort()
    .map((f) => `${testsDir.replace(/\/$/, '')}/${f}`);
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
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: root,
    input: JSON.stringify({ invariants }),
    encoding: 'utf8',
    // Only what Node needs to start: no tokens, no HITLD_ settings, no NODE_OPTIONS.
    env: { PATH: process.env.PATH ?? '' },
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { error: `the probe did not finish: ${r.error.message}` };
  const at = (r.stdout ?? '').lastIndexOf(MARK);
  if (r.status !== 0 || at < 0) {
    const why = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ');
    return { error: `the probe failed (exit ${r.status}): ${why}` };
  }
  return JSON.parse(r.stdout.slice(at + MARK.length));
}

/**
 * The probe's view of an invariant.
 * @param {string} root @param {string} area @param {Invariant} inv @param {number} seed
 * @param {unknown[]} [check]
 */
function probeInvariant(root, area, inv, seed, check) {
  const second = inv.form === 'round-trip' ? inv.inverse : inv.oracle;
  return {
    id: inv.id,
    form: inv.form,
    module: join(root, inv.module),
    target: inv.target,
    ...(second ? { second, second_module: join(root, inv.oracle_module ?? inv.module) } : {}),
    args: inv.args,
    runs: inv.runs ?? DEFAULT_RUNS,
    seed: invariantSeed(seed, area, inv.id),
    ...(check ? { check } : {}),
  };
}

/**
 * Attack an area's invariants, or check given arguments against one of them.
 * @param {string} root
 * @param {Registry} registry
 * @param {{ seed?: number, invariants?: string[], check?: unknown[], timeoutMs?: number }} [options]
 *   invariants: only these; check: these arguments only (with one invariant)
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
  const out = runProbe(
    root,
    chosen.map((i) => probeInvariant(root, registry.area, i, seed, options.check)),
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
    const open = openRegressions(root, data.tests_dir, inv.id);
    if (open.length) result.known.push({ ...b, tests: open });
    else result.breaks.push(b);
  }
  return result;
}
