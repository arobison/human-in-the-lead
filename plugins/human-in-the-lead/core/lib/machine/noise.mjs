// The noise test (HITLD-1013): does the background-priority work running on this machine now leave
// a measurement alone? The quiet test may leave background priority out (`load.ignore_background`
// in the machine file) only on evidence, so this times a fixed CPU-bound workload several times
// while that work runs and reports how far the timings spread. A small spread with background work
// running says it leaves measurements alone; a wide one says it does not; with no background work
// running, the test says nothing either way. The last result is kept in the machine directory, and
// `hitld env status` shows it beside the setting.
//
// It checks the spread, not a slowdown that stays the same from run to run: a steady slowdown
// moves every timing alike and leaves the comparison between two measurements alone.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleLoad } from '../cadence/idle.mjs';

/** The record of the last noise test, in the machine directory. */
export const NOISE_FILE = 'noise.json';

/** The relative spread at or below which the timings count as left alone. */
export const NOISE_SPREAD_MAX = 0.05;

/** The background CPU per core below which the test cannot speak to background work. */
export const BACKGROUND_PRESENT_MIN = 0.02;

/** How many timed runs, when the caller asks for none. */
export const DEFAULT_RUNS = 15;

/**
 * @typedef {'quiet' | 'noisy' | 'inconclusive' | 'unknown'} Verdict
 * quiet: background work ran and the timings stayed close; noisy: they spread; inconclusive: no
 * background work ran; unknown: background priority is not readable here (only on macOS)
 */

/**
 * @typedef {object} NoiseResult
 * @property {string} at
 * @property {Verdict} verdict
 * @property {string} why
 * @property {number} runs
 * @property {number} median_ms
 * @property {number} spread the 10th to 90th percentile range over the median
 * @property {number} spread_max
 * @property {number} load_per_core
 * @property {number} [background_per_core]
 * @property {number} [foreground_per_core]
 * @property {number} [gpu_busy]
 */

/** One fixed unit of CPU-bound work: hash a 1 MiB buffer 32 times. */
function work() {
  const buffer = Buffer.alloc(1024 * 1024, 7);
  let h = createHash('sha256');
  for (let i = 0; i < 32; i += 1) h = createHash('sha256').update(buffer).update(h.digest());
  return h.digest('hex');
}

/** @param {number[]} sorted @param {number} q */
const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))];

/** @param {number} n */
const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * The verdict from timings and the load during them; pure, for tests.
 * @param {number[]} timings milliseconds per run
 * @param {import('../cadence/idle.mjs').LoadSample} load
 * @returns {{ verdict: Verdict, why: string, median_ms: number, spread: number }}
 */
export function noiseVerdict(timings, load) {
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted.length ? quantile(sorted, 0.5) : 0;
  const spread = median > 0 ? (quantile(sorted, 0.9) - quantile(sorted, 0.1)) / median : 0;
  const shown = `spread ${round(spread)} against ${NOISE_SPREAD_MAX}`;
  /** @type {{ verdict: Verdict, why: string }} */
  let v;
  if (load.background_per_core === undefined) {
    v = {
      verdict: 'unknown',
      why: 'background priority is not readable on this machine (ps priorities are read on macOS only)',
    };
  } else if (load.background_per_core < BACKGROUND_PRESENT_MIN) {
    v = {
      verdict: 'inconclusive',
      why: `no background work ran (${round(load.background_per_core, 2)} per core); run it again while the system indexes or analyzes media`,
    };
  } else if (spread <= NOISE_SPREAD_MAX) {
    v = {
      verdict: 'quiet',
      why: `background work (${round(load.background_per_core, 2)} per core) left the timings alone: ${shown}`,
    };
  } else {
    v = {
      verdict: 'noisy',
      why: `the timings spread with background work running (${round(load.background_per_core, 2)} per core): ${shown}; leave load.ignore_background off`,
    };
  }
  return { ...v, median_ms: round(median), spread: round(spread) };
}

/**
 * Run the noise test: two warm-up runs, then `runs` timed runs of the fixed workload, with the
 * load sampled before and after (the higher background reading is kept, the lower is not trusted
 * to show what ran).
 * @param {{ runs?: number, now?: () => Date, clock?: () => number, unit?: () => unknown,
 *   sample?: () => import('../cadence/idle.mjs').LoadSample }} [options] replaceable, for tests
 * @returns {NoiseResult}
 */
export function runNoiseTest(options = {}) {
  const runs = Math.max(3, options.runs ?? DEFAULT_RUNS);
  const clock = options.clock ?? (() => performance.now());
  const unit = options.unit ?? work;
  const sample = options.sample ?? (() => sampleLoad());
  const before = sample();
  unit();
  unit();
  /** @type {number[]} */
  const timings = [];
  for (let i = 0; i < runs; i += 1) {
    const start = clock();
    unit();
    timings.push(clock() - start);
  }
  const after = sample();
  const pick = /** @param {keyof import('../cadence/idle.mjs').LoadSample} k */ (k) => {
    const a = before[k];
    const b = after[k];
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Math.max(a, b);
  };
  /** @type {import('../cadence/idle.mjs').LoadSample} */
  const load = { load_per_core: pick('load_per_core') ?? 0 };
  for (const k of /** @type {const} */ ([
    'background_per_core',
    'foreground_per_core',
    'gpu_busy',
  ])) {
    const v = pick(k);
    if (v !== undefined) load[k] = v;
  }
  const v = noiseVerdict(timings, load);
  return {
    at: (options.now ?? (() => new Date()))().toISOString(),
    verdict: v.verdict,
    why: v.why,
    runs,
    median_ms: v.median_ms,
    spread: v.spread,
    spread_max: NOISE_SPREAD_MAX,
    load_per_core: round(load.load_per_core, 2),
    ...(load.background_per_core !== undefined
      ? { background_per_core: round(load.background_per_core, 2) }
      : {}),
    ...(load.foreground_per_core !== undefined
      ? { foreground_per_core: round(load.foreground_per_core, 2) }
      : {}),
    ...(load.gpu_busy !== undefined ? { gpu_busy: round(load.gpu_busy, 2) } : {}),
  };
}

/**
 * Keep the result as the machine's last noise test (written whole, then moved into place).
 * @param {string} machineDir @param {NoiseResult} result @returns {string} the path
 */
export function writeNoiseResult(machineDir, result) {
  mkdirSync(machineDir, { recursive: true });
  const path = join(machineDir, NOISE_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}

/**
 * The machine's last noise test, or null when none was run or the record does not read.
 * @param {string} machineDir @returns {NoiseResult | null}
 */
export function readNoiseResult(machineDir) {
  const path = join(machineDir, NOISE_FILE);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data.verdict === 'string' && typeof data.at === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * What `env status` says about the quiet test's background filter: whether the setting turns it
 * on, and the noise test that checks it.
 * @param {Record<string, any> | null | undefined} machine the machine layer
 * @param {string} machineDir
 * @returns {{ quiet_test: Record<string, any>, warnings: string[] }}
 */
export function quietTestStatus(machine, machineDir) {
  const on = machine?.load?.ignore_background === true;
  const noise = readNoiseResult(machineDir);
  /** @type {string[]} */
  const warnings = [];
  const says = on
    ? 'load.ignore_background is on in the machine file: the idle test leaves out background-priority processes (macOS), on the evidence of the noise test below'
    : 'load.ignore_background is off: the idle test counts load at every priority; turn it on only after hitld machine noise reports quiet while background work runs';
  if (on && noise?.verdict !== 'quiet') {
    warnings.push(
      noise
        ? `load.ignore_background is on, but the last noise test (${noise.at}) reported ${noise.verdict}: ${noise.why}`
        : 'load.ignore_background is on, but no noise test backs it: run hitld machine noise while background work runs',
    );
  }
  return {
    quiet_test: {
      ignore_background: on,
      says,
      noise_test: noise
        ? {
            at: noise.at,
            verdict: noise.verdict,
            spread: noise.spread,
            ...(noise.background_per_core !== undefined
              ? { background_per_core: noise.background_per_core }
              : {}),
          }
        : null,
    },
    warnings,
  };
}
