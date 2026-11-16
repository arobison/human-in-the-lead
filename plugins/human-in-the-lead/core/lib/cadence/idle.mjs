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

import { availableParallelism, cpus, loadavg } from 'node:os';
import { liveExecutors } from '../registry/machine.mjs';

/** The load per core below which a machine counts as idle, when the machine file sets none. */
export const DEFAULT_IDLE_LOAD_PER_CORE = 0.25;

/**
 * @typedef {object} Idle
 * @property {boolean} idle
 * @property {number} load_per_core the one-minute load average divided by the cores (on Windows,
 *   the busy share of CPU time over a short sample)
 * @property {number} idle_below the threshold it is compared with
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
 *   loadPerCore?: number, liveCount?: number }} options
 *   loadPerCore and liveCount replace the readings, for tests and for a caller that knows better
 * @returns {Idle}
 */
export function readIdle(options) {
  const load_per_core = options.loadPerCore ?? machineLoadPerCore();
  const live_executors = options.liveCount ?? liveExecutors(options.machineRoot).length;
  const idle_below = idleThreshold(options.machine);
  /** @type {string[]} */
  const reasons = [];
  if (live_executors > 0) {
    reasons.push(
      `${live_executors} executor${live_executors === 1 ? '' : 's'} running on this machine`,
    );
  }
  if (load_per_core >= idle_below) {
    reasons.push(
      `load ${round(load_per_core)} per core is not below the idle threshold ${round(idle_below)}`,
    );
  }
  return {
    idle: reasons.length === 0,
    load_per_core: round(load_per_core),
    idle_below: round(idle_below),
    live_executors,
    reasons,
  };
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;
