// Whether this machine is idle (design part 13.3): no executor running from any project, and the
// load average per core below the machine's idle threshold. An idle machine is the moment for
// nightly baselines and offline evals, which are timing-sensitive or heavy, and for a report when
// nothing else is competing for the machine. Reads only.

import { availableParallelism, loadavg } from 'node:os';
import { liveExecutors } from '../registry/machine.mjs';

/** The load per core below which a machine counts as idle, when the machine file sets none. */
export const DEFAULT_IDLE_LOAD_PER_CORE = 0.25;

/**
 * @typedef {object} Idle
 * @property {boolean} idle
 * @property {number} load_per_core the one-minute load average divided by the cores
 * @property {number} idle_below the threshold it is compared with
 * @property {number} live_executors executors running now, from every project on this machine
 * @property {string[]} reasons why the machine is not idle; empty when it is
 */

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
  const load_per_core = options.loadPerCore ?? loadavg()[0] / Math.max(1, availableParallelism());
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
