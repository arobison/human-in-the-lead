// This session's identity on the run: its session ID and its host (design part 13.1). Every
// command that records as a session, or names the session that wrote an event, asks here once.
//
// The session, first that gives one:
//   1. --session;
//   2. $HITLD_SESSION;
//   3. the harness's own session ID, as its adapter under core/harness/<id>/ reads it;
//   4. the session recorded for this worktree, by the run start or run resume that took the lease;
//   5. at run start only, a new ID. Run start records it, and later calls read it back (4).
// With none, the caller refuses as before. An executor gets only 1 and 2: a subagent shares its
// orchestrator's harness variables and may work in its checkout, and must never pass as it.
//
// The host: --host, then the host recorded for this session, then this machine's host name. So a
// session that started with --host keeps it on every later call without passing it again.
//
// The record lives in the private store under run/, which is machine-local (store/git.mjs,
// MACHINE_LOCAL): it never leaves this machine, so a worktree at the same path on another machine
// never reads it. One record per worktree; a later run start or run resume there replaces it.

import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { findRepoRoot } from '../policy/policy.mjs';
import { executorSignal } from '../cli/executor.mjs';
import * as claudeCode from '../../harness/claude-code/session.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {'flag' | 'env' | 'harness' | 'recorded' | 'new'} SessionSource
 * @typedef {{ session: string | null, host: string, source: SessionSource | null }} Identity
 * @typedef {{ session: string, host: string, worktree: string, recorded_at: string }} SessionRecord
 * @typedef {{ id: string, sessionIdOf: (env: NodeJS.ProcessEnv | undefined) => string | null }} HarnessSession
 */

/** The harnesses asked for a session ID, in order. */
export const HARNESSES = Object.freeze([claudeCode]);

export const SESSIONS_PREFIX = 'run/sessions/';

export const NO_SESSION =
  'a session ID is needed: pass --session or set HITLD_SESSION, or run hitld run start in this worktree, which makes one';

/** @param {unknown} v @returns {v is string} */
const text = (v) => typeof v === 'string' && v.length > 0;

/**
 * The worktree a command runs in: the repository root above `cwd`, or `cwd` outside one.
 * @param {string} cwd
 */
export function worktreeOf(cwd) {
  const root = findRepoRoot(cwd) ?? resolve(cwd);
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** @param {string} worktree */
const keyOf = (worktree) =>
  `${SESSIONS_PREFIX}${createHash('sha256').update(worktree).digest('hex').slice(0, 16)}.json`;

/**
 * The session recorded for the worktree at `cwd`, or null.
 * @param {PrivateStore | null | undefined} store @param {string} cwd
 * @returns {SessionRecord | null}
 */
export function readSessionRecord(store, cwd) {
  if (!store) return null;
  const worktree = worktreeOf(cwd);
  let raw;
  try {
    raw = store.read(keyOf(worktree));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw);
    if (r && text(r.session) && text(r.host) && r.worktree === worktree) return r;
  } catch {
    // A damaged record is no record: the next run start writes a fresh one.
  }
  return null;
}

/**
 * Record the identity that took the lease, for later calls in this worktree to read back.
 * @param {PrivateStore} store @param {string} cwd
 * @param {{ session: string, host: string }} who @param {Date} [now]
 */
export function recordSession(store, cwd, who, now = new Date()) {
  const worktree = worktreeOf(cwd);
  /** @type {SessionRecord} */
  const record = { session: who.session, host: who.host, worktree, recorded_at: now.toISOString() };
  store.write(keyOf(worktree), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** A new session ID, for a run start that found none. */
export const newSessionId = () => `s-${randomBytes(6).toString('hex')}`;

/**
 * This session's identity. `session` is null when nothing gives one; the caller refuses.
 * @param {{
 *   input?: Record<string, unknown>,
 *   env?: NodeJS.ProcessEnv,
 *   cwd: string,
 *   store?: PrivateStore | null,
 *   start?: boolean,
 *   harnesses?: readonly HarnessSession[],
 * }} o start: this is run start, which may make a new ID
 * @returns {Identity}
 */
export function resolveIdentity(o) {
  const input = o.input ?? {};
  const env = o.env ?? {};
  /** @type {string | null} */
  let session = null;
  /** @type {SessionSource | null} */
  let source = null;
  /** @type {SessionRecord | null | undefined} */
  let record;
  const recorded = () =>
    record === undefined ? (record = readSessionRecord(o.store, o.cwd)) : record;

  if (text(input.session)) [session, source] = [input.session, 'flag'];
  else if (text(env.HITLD_SESSION)) [session, source] = [env.HITLD_SESSION, 'env'];
  else if (!executorSignal(env, o.cwd)) {
    for (const h of o.harnesses ?? HARNESSES) {
      const id = h.sessionIdOf(env);
      if (id) {
        [session, source] = [id, 'harness'];
        break;
      }
    }
    if (!session && recorded()) [session, source] = [recorded()?.session ?? null, 'recorded'];
    if (!session && o.start) [session, source] = [newSessionId(), 'new'];
  }

  const r = session ? recorded() : null;
  const host = text(input.host) ? input.host : r && r.session === session ? r.host : hostname();
  return { session, host, source };
}
