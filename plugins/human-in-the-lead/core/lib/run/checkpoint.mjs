// Run-state persistence: run-state.json at the store root, and the last `run.checkpoints_kept`
// checkpoints beside it (design part 13.1).
//
// The private store has no delete, so checkpoints live in a ring of slot files: checkpoint n goes
// to slot n mod kept, overwriting the checkpoint kept steps back. Each checkpoint is the whole
// state, valid against schemas/run-state.schema.json, and carries its number and the hash of the
// previous checkpoint's state.

import { schemas } from '../schema/registry.mjs';
import { hashState } from './state.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('./state.mjs').RunState} RunState
 */

export const STATE_KEY = 'run-state.json';
export const CHECKPOINT_PREFIX = 'run/checkpoints/';

/**
 * @param {string | null} text
 * @returns {{ state: RunState | null, problem: string | null }}
 */
function parseState(text) {
  if (text === null) return { state: null, problem: 'is missing' };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { state: null, problem: `is not JSON: ${/** @type {Error} */ (e).message}` };
  }
  data = fromLegacyState(data);
  const errors = schemas().validateEntity('run-state', data);
  if (errors.length) {
    return { state: null, problem: errors.map((e) => `${e.path} ${e.message}`).join('; ') };
  }
  return { state: data, problem: null };
}

/**
 * A run state of schema version 1 in the names of version 2 (HITLD-82), read until the next
 * minor release: open_questions → decisions_open (each held → held_for_digest),
 * decisions_this_run → decisions_answered, an in-flight entry's handle → harness_ref. The state
 * is derived, so the next checkpoint writes it in the new names.
 * @param {any} data
 */
export function fromLegacyState(data) {
  if (!data || typeof data !== 'object' || data.schema_version !== 1) return data;
  const { open_questions, decisions_this_run, ...rest } = data;
  return {
    ...rest,
    schema_version: schemas().currentVersion('run-state'),
    in_flight: Array.isArray(rest.in_flight)
      ? rest.in_flight.map((/** @type {any} */ { handle, ...d }) => ({
          ...d,
          harness_ref: handle ?? null,
        }))
      : rest.in_flight,
    decisions_open: Array.isArray(open_questions)
      ? open_questions.map((/** @type {any} */ { held, ...q }) =>
          held === undefined ? q : { ...q, held_for_digest: held },
        )
      : open_questions,
    decisions_answered: decisions_this_run,
  };
}

/**
 * The kept checkpoints, newest first.
 * @param {PrivateStore} store
 * @returns {{ key: string, state: RunState }[]}
 */
export function listCheckpoints(store) {
  return store
    .list(CHECKPOINT_PREFIX)
    .map((key) => ({ key, state: parseState(store.read(key)).state }))
    .filter((c) => c.state !== null)
    .map((c) => /** @type {{ key: string, state: RunState }} */ (c))
    .sort((a, b) => b.state.checkpoint.number - a.state.checkpoint.number);
}

/**
 * Load the run state: run-state.json, or if it is missing or damaged the newest valid checkpoint
 * (the state is derived, so an older one only means more ledger events to absorb).
 * @param {PrivateStore} store
 * @returns {{ state: RunState | null, source: string | null, problems: string[] }}
 */
export function loadState(store) {
  const main = parseState(store.read(STATE_KEY));
  if (main.state) return { state: main.state, source: STATE_KEY, problems: [] };
  const problems = [`${STATE_KEY} ${main.problem}`];
  const newest = listCheckpoints(store)[0];
  if (newest) return { state: newest.state, source: newest.key, problems };
  return { state: null, source: null, problems };
}

/**
 * Write a state as the next checkpoint: number and previous-hash filled in, validated, written to
 * its ring slot and then atomically over run-state.json. The ledger event the state absorbed was
 * appended before this is called.
 * @param {PrivateStore} store
 * @param {RunState | null} previous the state this one follows, for the hash; null for the first
 * @param {RunState} next
 * @param {{ kept: number }} options
 * @returns {RunState} the state as written
 */
export function saveCheckpoint(store, previous, next, options) {
  const written = {
    ...next,
    checkpoint: {
      number: (previous?.checkpoint.number ?? 0) + 1,
      prev_hash: previous ? hashState(previous) : null,
    },
  };
  const errors = schemas().validateEntity('run-state', written);
  if (errors.length) {
    throw new Error(
      `refusing to write an invalid run state: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  const text = JSON.stringify(written, null, 2) + '\n';
  const slot = written.checkpoint.number % Math.max(1, options.kept);
  store.write(`${CHECKPOINT_PREFIX}slot-${slot}.json`, text);
  store.write(STATE_KEY, text);
  return written;
}
