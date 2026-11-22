// Progress signals (design part 5.2, the watchdog): what is observed about a running executor
// without the executor having to send it. Three sources write them to the private store:
//
//   worktree  hitld dispatch watch samples the executor's branch and worktree: commits, changes
//   harness   the harness adapter records tool calls (in Claude Code, a hook on each tool call)
//             and tokens where the harness reports them while the executor runs
//   process   hitld dispatch watch samples a headless run: its process and its output
//
// One file per dispatch, or per harness reference when the writer knows only that (a background
// agent's hook knows its agent ID, not its dispatch): dispatch/progress/<D-n>.jsonl and
// dispatch/progress/ref-<ref>.jsonl. A line that fails its schema is skipped, never trusted.
//
// What counts as progress is decided here, from the lines alone: a harness line always does; a
// worktree or process line does when it differs from the one before it from the same source (the
// first one does when it already shows work: commits, changes or output). Liveness alone is not
// progress: a process can be alive and hung.

import { createHash } from 'node:crypto';
import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} Signal a line valid against schemas/progress-signal.schema.json
 */

export const PROGRESS_DIR = 'dispatch/progress/';

/** The comparable part of a sampled line. @param {Signal} s */
const sample = (s) =>
  s.source === 'worktree'
    ? JSON.stringify([s.head ?? null, s.commits ?? 0, s.dirty ?? 0, s.changed ?? null])
    : JSON.stringify([s.alive ?? null, s.output_bytes ?? 0, s.result ?? null]);

/** Whether a first sampled line already shows work. @param {Signal} s */
const showsWork = (s) =>
  s.source === 'worktree' ? (s.commits ?? 0) > 0 || (s.dirty ?? 0) > 0 : (s.output_bytes ?? 0) > 0;

/**
 * The store key for a dispatch's signals, or for an agent's by its harness reference.
 * @param {{ dispatch?: string, harness_ref?: string }} who
 */
export function progressKey(who) {
  if (who.dispatch) return `${PROGRESS_DIR}${who.dispatch}.jsonl`;
  const ref = String(who.harness_ref ?? '');
  if (!ref) throw new Error('a progress signal names its dispatch or its harness reference');
  const safe = /^[A-Za-z0-9._-]{1,96}$/.test(ref)
    ? ref
    : createHash('sha256').update(ref).digest('hex').slice(0, 40);
  return `${PROGRESS_DIR}ref-${safe}.jsonl`;
}

/**
 * Record one signal. Its time and schema version are filled in.
 * @param {PrivateStore} store @param {Signal} signal @param {{ now?: () => Date }} [options]
 * @returns {Signal}
 */
export function recordProgress(store, signal, options = {}) {
  const now = options.now ?? (() => new Date());
  /** @type {Signal} */
  const line = {
    schema_version: schemas().currentVersion('progress-signal'),
    ...signal,
    at: signal.at ?? now().toISOString(),
  };
  const errors = schemas().validateEntity('progress-signal', line);
  if (!line.dispatch && !line.harness_ref) {
    errors.push({ path: 'dispatch', message: 'or harness_ref is required' });
  }
  if (errors.length) {
    throw new Error(
      `invalid progress signal: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  store.append(progressKey(line), JSON.stringify(line) + '\n');
  return line;
}

/** @param {string | null} text @returns {Signal[]} */
function parse(text) {
  /** @type {Signal[]} */
  const out = [];
  for (const raw of (text ?? '').split('\n')) {
    if (!raw.trim()) continue;
    try {
      const data = JSON.parse(raw);
      if (!schemas().validateEntity('progress-signal', data).length) out.push(data);
    } catch {
      // A torn or foreign line is skipped.
    }
  }
  return out;
}

/**
 * A dispatch's signals from its own file and its agent's, oldest first, from its start on: a
 * follow-up shares its agent (and so its harness reference) with the dispatch it continues.
 * @param {PrivateStore} store
 * @param {{ dispatch: string, harness_ref?: string | null, started_at?: string }} entry
 * @returns {Signal[]}
 */
export function readProgress(store, entry) {
  const own = parse(store.read(progressKey({ dispatch: entry.dispatch })));
  const agent = entry.harness_ref
    ? parse(store.read(progressKey({ harness_ref: entry.harness_ref })))
    : [];
  const from = entry.started_at ? Date.parse(entry.started_at) : -Infinity;
  return [...own, ...agent]
    .filter((s) => Date.parse(s.at) >= from)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The times at which the signals show progress, oldest first.
 * @param {Signal[]} signals oldest first
 * @returns {number[]} ms
 */
export function progressTimes(signals) {
  /** @type {Map<string, Signal>} last sampled line per source */
  const last = new Map();
  /** @type {number[]} */
  const out = [];
  for (const s of signals) {
    const at = Date.parse(s.at);
    if (s.source === 'harness') {
      out.push(at);
      continue;
    }
    const before = last.get(s.source);
    if (before ? sample(before) !== sample(s) : showsWork(s)) out.push(at);
    last.set(s.source, s);
  }
  return out;
}

/**
 * Whether a newly sampled line says anything the last one from its source did not: only then is
 * it written, so an idle executor adds nothing to its file.
 * @param {Signal[]} signals the dispatch's signals so far @param {Signal} next
 */
export function isNews(signals, next) {
  const before = signals.findLast((s) => s.source === next.source);
  return before ? sample(before) !== sample(next) : true;
}

/** The latest process line, for a headless run's liveness. @param {Signal[]} signals */
export const lastProcess = (signals) => signals.findLast((s) => s.source === 'process') ?? null;
