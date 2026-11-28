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
//
// The workload is what background work would disturb: one worker thread per core, each hashing a
// shared buffer larger than the processor's caches, so a run needs every core and memory
// bandwidth. The load is sampled after every timed run, so the background reading covers the runs
// and not only the moments around them. It is bounded: the workers end when the test ends,
// whatever happened, and a hard time cap stops it.

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
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

/** The fewest and the most timed runs a caller may ask for. */
export const MIN_RUNS = 3;
export const MAX_RUNS = 100;

/** The hard cap on the whole test, warm-up included, in milliseconds. */
export const TIME_CAP_MS = 120_000;

/** The shared buffer each worker hashes: larger than the caches of the machines hitld runs on. */
export const BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * @typedef {'quiet' | 'noisy' | 'inconclusive' | 'unknown'} Verdict
 * quiet: background work ran and the timings stayed close; noisy: they spread; inconclusive: no
 * background work ran, or the timings settle nothing; unknown: background priority is not
 * readable here (only on macOS)
 */

/**
 * @typedef {object} Workload what one timed run does; replaceable, for tests
 * @property {() => Promise<void>} run one run, resolved when every part of it is done
 * @property {() => Promise<void>} stop end it, whatever state it is in
 * @property {number} threads how many threads a run uses
 */

/**
 * @typedef {object} NoiseResult
 * @property {string} at
 * @property {Verdict} verdict
 * @property {string} why
 * @property {number} runs the timed runs that finished
 * @property {number} threads the worker threads each run used
 * @property {number} samples how many load samples the figures below come from
 * @property {boolean} [capped] the time cap stopped the test before every run finished
 * @property {number} median_ms
 * @property {number} spread the 10th to 90th percentile range over the median
 * @property {number} spread_max
 * @property {number} load_per_core the median over the samples, as are the figures below
 * @property {number} [background_per_core]
 * @property {number} [background_min_per_core] the lowest background reading of any sample
 * @property {number} [foreground_per_core]
 * @property {number} [gpu_busy]
 */

/** What each worker runs: on every message, hash the whole shared buffer from its own offset. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const view = new Uint8Array(workerData.buffer);
const at = workerData.offset;
parentPort.on('message', () => {
  const h = createHash('sha256').update(view.subarray(at)).update(view.subarray(0, at));
  parentPort.postMessage(h.digest().length);
});
`;

/**
 * The real workload: one worker per core over one shared buffer larger than the caches. Each
 * worker starts at its own offset, so they do not read the same lines at once.
 * @param {{ threads?: number, bytes?: number }} [options]
 * @returns {Workload}
 */
export function cpuMemoryWorkload(options = {}) {
  const threads = Math.max(1, options.threads ?? availableParallelism());
  const bytes = options.bytes ?? BUFFER_BYTES;
  const buffer = new SharedArrayBuffer(bytes);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bytes; i += 4096) view[i] = (i >>> 12) & 0xff;
  const workers = Array.from(
    { length: threads },
    (_, i) =>
      new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { buffer, offset: Math.floor((bytes / threads) * i) },
      }),
  );
  /** @param {Worker} w @returns {Promise<void>} */
  const one = (w) =>
    new Promise((resolve, reject) => {
      /** @param {Error} e */
      const failed = (e) => {
        w.off('message', done);
        reject(e);
      };
      const done = () => {
        w.off('error', failed);
        resolve();
      };
      w.once('message', done);
      w.once('error', failed);
      w.postMessage('run');
    });
  return {
    threads,
    run: async () => {
      await Promise.all(workers.map(one));
    },
    stop: async () => {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
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
  const usable = timings.every((t) => Number.isFinite(t) && t >= 0);
  const sorted = usable ? [...timings].sort((a, b) => a - b) : [];
  const median = sorted.length ? quantile(sorted, 0.5) : 0;
  const spread = median > 0 ? (quantile(sorted, 0.9) - quantile(sorted, 0.1)) / median : 0;
  const shown = `spread ${round(spread)} against ${NOISE_SPREAD_MAX}`;
  const background = load.background_per_core;
  /** @type {{ verdict: Verdict, why: string }} */
  let v;
  if (!usable || sorted.length < MIN_RUNS || !(median > 0)) {
    // A spread over a median of zero, or over too few runs, says nothing about noise.
    v = {
      verdict: 'inconclusive',
      why: !usable
        ? 'a timing is not a number; run it again'
        : sorted.length < MIN_RUNS
          ? `only ${sorted.length} timed run${sorted.length === 1 ? '' : 's'} finished, fewer than ${MIN_RUNS}; run it again`
          : 'the timings read zero, so their spread means nothing; run it again',
    };
  } else if (background === undefined || !Number.isFinite(background)) {
    v = {
      verdict: 'unknown',
      why: 'background priority is not readable on this machine (ps priorities are read on macOS only)',
    };
  } else if (background < BACKGROUND_PRESENT_MIN) {
    v = {
      verdict: 'inconclusive',
      why: `no background work ran (${round(background, 2)} per core); run it again while the system indexes or analyzes media`,
    };
  } else if (spread <= NOISE_SPREAD_MAX) {
    v = {
      verdict: 'quiet',
      why: `background work (${round(background, 2)} per core) left the timings alone: ${shown}`,
    };
  } else {
    v = {
      verdict: 'noisy',
      why: `the timings spread with background work running (${round(background, 2)} per core): ${shown}; leave load.ignore_background off`,
    };
  }
  return { ...v, median_ms: round(median), spread: round(spread) };
}

/** @param {number[]} values @returns {number | undefined} */
const medianOf = (values) => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length ? quantile(finite, 0.5) : undefined;
};

/**
 * Whether a number of runs may be asked for; the refusal says why, or null when it may.
 * @param {unknown} runs @returns {string | null}
 */
export function runsRefusal(runs) {
  if (runs === undefined) return null;
  if (typeof runs !== 'number' || !Number.isInteger(runs)) return '--runs is a whole number';
  if (runs < MIN_RUNS || runs > MAX_RUNS) {
    return `--runs is from ${MIN_RUNS} to ${MAX_RUNS} (asked for ${runs}): fewer settle nothing, more only lengthen the test, which stops at ${TIME_CAP_MS / 1000} seconds anyway`;
  }
  return null;
}

/**
 * Run the noise test: one warm-up run, then `runs` timed runs of the workload, the load sampled
 * before the first and after each one, between runs so a sample never lands inside a timing. The
 * figures are the medians over the samples. The workload is stopped at the end, whatever happened,
 * and the whole test stops at the time cap: the runs that finished are judged, and fewer than three
 * settle nothing.
 * @param {{ runs?: number, now?: () => Date, clock?: () => number, workload?: () => Workload,
 *   sample?: () => import('../cadence/idle.mjs').LoadSample, capMs?: number }} [options]
 *   replaceable, for tests
 * @returns {Promise<NoiseResult>}
 */
export async function runNoiseTest(options = {}) {
  const refusal = runsRefusal(options.runs);
  if (refusal) throw new Error(refusal);
  const runs = options.runs ?? DEFAULT_RUNS;
  const clock = options.clock ?? (() => performance.now());
  const sample = options.sample ?? (() => sampleLoad());
  const capMs = options.capMs ?? TIME_CAP_MS;
  const began = clock();
  /** @type {import('../cadence/idle.mjs').LoadSample[]} */
  const samples = [sample()];
  /** @type {number[]} */
  const timings = [];
  let capped = false;
  const workload = (options.workload ?? (() => cpuMemoryWorkload()))();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    // Not unref'd: a hung run must still reach the cap. It is cleared once the test ends.
    timer = setTimeout(() => resolve('cap'), capMs);
  });
  try {
    /** @returns {Promise<boolean>} whether the run finished inside the cap */
    const timed = async () => {
      const running = workload.run();
      // A run that fails after the cap won the race is not left unhandled; one that fails first
      // still rejects the race.
      running.catch(() => {});
      return (await Promise.race([running, deadline])) !== 'cap';
    };
    if (await timed()) {
      for (let i = 0; i < runs; i += 1) {
        if (clock() - began >= capMs) {
          capped = true;
          break;
        }
        const start = clock();
        if (!(await timed())) {
          capped = true;
          break;
        }
        timings.push(clock() - start);
        samples.push(sample());
      }
    } else {
      capped = true;
    }
  } finally {
    clearTimeout(timer);
    await workload.stop();
  }
  /** @type {import('../cadence/idle.mjs').LoadSample} */
  const load = { load_per_core: medianOf(samples.map((s) => s.load_per_core)) ?? 0 };
  for (const k of /** @type {const} */ ([
    'background_per_core',
    'foreground_per_core',
    'gpu_busy',
  ])) {
    const v = medianOf(samples.flatMap((s) => (s[k] === undefined ? [] : [s[k]])));
    if (v !== undefined) load[k] = v;
  }
  const backgrounds = samples.flatMap((s) =>
    Number.isFinite(s.background_per_core) ? [/** @type {number} */ (s.background_per_core)] : [],
  );
  const v = noiseVerdict(timings, load);
  return {
    at: (options.now ?? (() => new Date()))().toISOString(),
    verdict: v.verdict,
    why: capped ? `stopped at the ${capMs / 1000} second cap; ${v.why}` : v.why,
    runs: timings.length,
    threads: workload.threads,
    samples: samples.length,
    ...(capped ? { capped: true } : {}),
    median_ms: v.median_ms,
    spread: v.spread,
    spread_max: NOISE_SPREAD_MAX,
    load_per_core: round(load.load_per_core, 2),
    ...(load.background_per_core !== undefined
      ? { background_per_core: round(load.background_per_core, 2) }
      : {}),
    ...(backgrounds.length ? { background_min_per_core: round(Math.min(...backgrounds), 2) } : {}),
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
