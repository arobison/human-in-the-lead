// Whether this machine is idle (design part 13.3): no executor running from any project, and the
// load average per core below the machine's idle threshold. An idle machine is the moment for
// nightly baselines and offline evals, which are timing-sensitive or heavy, and for a report when
// nothing else is competing for the machine. Reads only.
//
// Windows has no load average (os.loadavg() is always zero there, so every machine would look
// idle). There the load per core is the share of CPU time all cores spent busy over a short
// sample (half a second), which reads on the same scale: 0 is idle, 1 is every core busy. It is
// a snapshot, not a one-minute average, so it is noisier; a busy moment holds work back, which is
// the safe side.
//
// Only load that competes with the job (HITLD-1013). The load average counts every runnable
// thread at any priority, so the operating system's own indexing and media analysis, which run at
// background priority, can hold a measurement for an hour while the work that competes with it
// is a tenth of a core. On macOS, `ps` shows background-priority processes at priority 4; with
// `load.ignore_background` set in the machine file, the test leaves them out: the figure compared
// with the bar is the CPU the other processes use, per core, and never more than the load average
// per core. It is off until the owner sets it, because whether background work leaves a
// measurement alone is a fact about the machine, checked with `hitld machine noise`, not assumed.
// Background work can still use the GPU and memory bandwidth, so on macOS the GPU's busy share
// (IOAccelerator's Device Utilization, readable without sudo) is its own figure against its own
// bar, `load.idle_gpu_busy`, whether the filter is on or not. Elsewhere neither is read.

import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { liveExecutors } from '../registry/machine.mjs';

/** The load per core below which a machine counts as idle, when the machine file sets none. */
export const DEFAULT_IDLE_LOAD_PER_CORE = 0.25;

/** The GPU busy share (0 to 1) below which a machine counts as idle, when the machine file sets none. */
export const DEFAULT_IDLE_GPU_BUSY = 0.25;

/** The priority `ps` shows for a process at background priority on macOS. */
export const BACKGROUND_PRIORITY = 4;

/** How long a `ps` or `ioreg` reading may take, in milliseconds. */
const READ_TIMEOUT_MS = 5000;

/**
 * @typedef {object} Idle
 * @property {boolean} idle
 * @property {number} load_per_core the one-minute load average divided by the cores (on Windows,
 *   the busy share of CPU time over a short sample)
 * @property {number} idle_below the threshold it is compared with
 * @property {boolean} [ignore_background] whether the machine file's `load.ignore_background` is set
 * @property {number} [competing_per_core] with the filter on and `ps` readable: the load compared
 *   with the threshold, the CPU of processes not at background priority per core, never above
 *   load_per_core
 * @property {number} [background_per_core] the CPU of background-priority processes per core,
 *   where `ps` is readable (macOS)
 * @property {number} [gpu_busy] the GPU's busy share, 0 to 1, where readable (macOS)
 * @property {number} [gpu_idle_below] the threshold gpu_busy is compared with, when it is read
 * @property {number} live_executors executors running now, from every project on this machine
 * @property {string[]} reasons why the machine is not idle; empty when it is
 */

/** How long the Windows CPU sample runs, in milliseconds. */
const CPU_SAMPLE_MS = 500;

/** @returns {{ busy: number, total: number }} */
function cpuTimes() {
  let busy = 0;
  let total = 0;
  for (const { times } of cpus()) {
    const all = times.user + times.nice + times.sys + times.irq + times.idle;
    total += all;
    busy += all - times.idle;
  }
  return { busy, total };
}

/**
 * This machine's load per core: the one-minute load average over the cores, or on Windows, which
 * has no load average, the busy share of CPU time over a short sample (it blocks for that long).
 * @param {NodeJS.Platform} [platform]
 * @returns {number}
 */
export function machineLoadPerCore(platform = process.platform) {
  if (platform !== 'win32') return loadavg()[0] / Math.max(1, availableParallelism());
  const a = cpuTimes();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CPU_SAMPLE_MS);
  const b = cpuTimes();
  const total = b.total - a.total;
  return total > 0 ? Math.min(1, Math.max(0, (b.busy - a.busy) / total)) : 0;
}

/**
 * @typedef {object} LoadSample
 * @property {number} load_per_core
 * @property {number} [foreground_per_core] CPU of processes not at background priority, per core
 * @property {number} [background_per_core] CPU of processes at background priority, per core
 * @property {number} [gpu_busy] the GPU's busy share, 0 to 1
 */

/**
 * Run a program and return what it printed, or null when it fails or is not there.
 * @param {string} file @param {string[]} args @returns {string | null}
 */
function runProgram(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout: READ_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * The CPU that processes use, in cores, split by whether they are at background priority, from
 * `ps -A -o pri=,%cpu=` (macOS). Null when nothing parses.
 * @param {string | null} text
 * @returns {{ foreground: number, background: number } | null}
 */
export function parsePriorityCpu(text) {
  if (!text) return null;
  let foreground = 0;
  let background = 0;
  let rows = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+(?:[.,]\d+)?)\s*$/.exec(line);
    if (!m) continue;
    rows += 1;
    const cores = Number(m[2].replace(',', '.')) / 100;
    if (Number(m[1]) === BACKGROUND_PRIORITY) background += cores;
    else foreground += cores;
  }
  return rows ? { foreground, background } : null;
}

/**
 * The GPU's busy share, 0 to 1, from `ioreg -r -d 1 -w 0 -c IOAccelerator` (macOS): the highest
 * Device Utilization figure of any accelerator. Null when none is shown.
 * @param {string | null} text @returns {number | null}
 */
export function parseGpuBusy(text) {
  if (!text) return null;
  const all = [...text.matchAll(/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]),
  );
  return all.length ? Math.min(1, Math.max(0, Math.max(...all) / 100)) : null;
}

/**
 * Sample this machine's load: the load per core, and on macOS the CPU split by priority and the
 * GPU's busy share. A reading that fails is left out, never guessed.
 * @param {{ platform?: NodeJS.Platform, run?: (file: string, args: string[]) => string | null,
 *   loadPerCore?: number, cores?: number }} [options] each part replaceable, for tests
 * @returns {LoadSample}
 */
export function sampleLoad(options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runProgram;
  const cores = Math.max(1, options.cores ?? availableParallelism());
  /** @type {LoadSample} */
  const sample = { load_per_core: options.loadPerCore ?? machineLoadPerCore(platform) };
  if (platform !== 'darwin') return sample;
  const cpu = parsePriorityCpu(run('ps', ['-A', '-o', 'pri=,%cpu=']));
  if (cpu) {
    sample.foreground_per_core = cpu.foreground / cores;
    sample.background_per_core = cpu.background / cores;
  }
  const gpu = parseGpuBusy(run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']));
  if (gpu !== null) sample.gpu_busy = gpu;
  return sample;
}

/** @param {Record<string, any> | null | undefined} machine */
export const ignoresBackground = (machine) => machine?.load?.ignore_background === true;

/**
 * The GPU busy threshold: the machine file's `load.idle_gpu_busy`, or 0.25.
 * @param {Record<string, any> | null | undefined} machine
 */
export function gpuIdleThreshold(machine) {
  const set = machine?.load?.idle_gpu_busy;
  return typeof set === 'number' ? set : DEFAULT_IDLE_GPU_BUSY;
}

/**
 * The idle threshold: the machine file's `load.idle_per_core`, but never above its `load.max_per_core`
 * (a machine that defers heavy work at a lower load is not idle at a higher one).
 * @param {Record<string, any> | null | undefined} machine the machine file's data
 */
export function idleThreshold(machine) {
  const idle = machine?.load?.idle_per_core;
  const max = machine?.load?.max_per_core;
  const base = typeof idle === 'number' ? idle : DEFAULT_IDLE_LOAD_PER_CORE;
  return typeof max === 'number' ? Math.min(base, max) : base;
}

/**
 * Read the machine's state.
 * @param {{ machineRoot: string, machine?: Record<string, any> | null,
 *   loadPerCore?: number, sample?: LoadSample, liveCount?: number }} options
 *   loadPerCore, sample and liveCount replace the readings, for tests and for a caller that knows
 *   better; a loadPerCore alone reads nothing else (no priority split, no GPU)
 * @returns {Idle}
 */
export function readIdle(options) {
  const sample =
    options.sample ??
    (options.loadPerCore !== undefined ? { load_per_core: options.loadPerCore } : sampleLoad());
  const load_per_core = sample.load_per_core;
  const live_executors = options.liveCount ?? liveExecutors(options.machineRoot).length;
  const idle_below = idleThreshold(options.machine);
  const ignore_background = ignoresBackground(options.machine);
  const competing =
    ignore_background && sample.foreground_per_core !== undefined
      ? Math.min(load_per_core, sample.foreground_per_core)
      : null;
  /** @type {string[]} */
  const reasons = [];
  if (live_executors > 0) {
    reasons.push(
      `${live_executors} executor${live_executors === 1 ? '' : 's'} running on this machine`,
    );
  }
  if (competing !== null) {
    if (competing >= idle_below) {
      reasons.push(
        `competing load ${round(competing)} per core (background priority left out) is not below the idle threshold ${round(idle_below)}`,
      );
    }
  } else if (load_per_core >= idle_below) {
    reasons.push(
      `load ${round(load_per_core)} per core is not below the idle threshold ${round(idle_below)}`,
    );
  }
  const gpu_idle_below = gpuIdleThreshold(options.machine);
  if (sample.gpu_busy !== undefined && sample.gpu_busy >= gpu_idle_below) {
    reasons.push(
      `GPU busy ${round(sample.gpu_busy)} is not below the GPU idle threshold ${round(gpu_idle_below)}`,
    );
  }
  return {
    idle: reasons.length === 0,
    load_per_core: round(load_per_core),
    idle_below: round(idle_below),
    ignore_background,
    ...(competing !== null ? { competing_per_core: round(competing) } : {}),
    ...(sample.background_per_core !== undefined
      ? { background_per_core: round(sample.background_per_core) }
      : {}),
    ...(sample.gpu_busy !== undefined
      ? { gpu_busy: round(sample.gpu_busy), gpu_idle_below: round(gpu_idle_below) }
      : {}),
    live_executors,
    reasons,
  };
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;
