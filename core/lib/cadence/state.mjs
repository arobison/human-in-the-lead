// What each recurring job last read (design part 13.3): cadence/state.json in the private store.
// `hitld cadence done` writes it after the chief of staff has run a job; `hitld cadence due` only
// reads it, so asking what is due changes nothing.

import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {{ at: string, through?: string | null, trust_through?: number, files?: Record<string, number> }} JobMark
 * @typedef {{ schema_version: number, jobs: Record<string, JobMark> }} CadenceState
 */

/** The private store key of the cadence state. */
export const CADENCE_KEY = 'cadence/state.json';

/** @returns {CadenceState} */
const blank = () => ({ schema_version: schemas().currentVersion('cadence-state') ?? 1, jobs: {} });

/**
 * The state, or an empty one when none was written. A file that does not parse or validate is an
 * error: it would otherwise make every job look never run.
 * @param {PrivateStore} store @returns {CadenceState}
 */
export function readCadenceState(store) {
  const text = store.read(CADENCE_KEY);
  if (text === null || text === undefined) return blank();
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `${CADENCE_KEY} in the private store is not JSON; move it aside to start fresh`,
    );
  }
  const errors = schemas().validateEntity('cadence-state', data);
  if (errors.length) throw new Error(`${CADENCE_KEY} is invalid: ${formatErrors(errors)}`);
  return /** @type {CadenceState} */ (data);
}

/**
 * Record that a job ran, and how far into the ledger and the trust record it had read.
 * @param {PrivateStore} store @param {string} job
 * @param {JobMark} mark
 * @returns {CadenceState}
 */
export function markJobDone(store, job, mark) {
  const state = readCadenceState(store);
  state.jobs[job] = mark;
  const errors = schemas().validateEntity('cadence-state', state);
  if (errors.length) throw new Error(`cadence state is invalid: ${formatErrors(errors)}`);
  store.write(CADENCE_KEY, JSON.stringify(state, null, 2) + '\n');
  return state;
}
