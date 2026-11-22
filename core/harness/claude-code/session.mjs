// The session ID Claude Code gives a session, for `hitld` to take as the session's identity on the
// run (core/lib/run/identity.mjs). The core never reads harness variables itself: it asks this.
//
// A cloud session (Claude Code on the web) carries CLAUDE_CODE_REMOTE_SESSION_ID, the ID it keeps
// when its container is replaced. Shell commands of a session also carry CLAUDE_CODE_SESSION_ID.
// Both were observed in a cloud session on 2026-11-16; neither is documented. A subagent shares
// its parent's variables, which is why identity.mjs never asks this for an executor.

export const ID = 'claude-code';

/** The variables read, most stable first. */
export const SESSION_VARIABLES = Object.freeze([
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID',
]);

/** The shape of a session ID: one word, no spaces or line breaks, at most 128 characters. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * This session's ID as Claude Code gives it, or null outside Claude Code.
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {string | null}
 */
export function sessionIdOf(env) {
  for (const name of SESSION_VARIABLES) {
    const v = env?.[name];
    if (typeof v === 'string' && SESSION_ID_PATTERN.test(v)) return v;
  }
  return null;
}

/**
 * The variable that holds the process ID of the Claude Code process a shell command runs under:
 * the session's own process, in which its background agents run. Observed in a cloud session on
 * 2026-11-22 (it matched the parent of the command's shell); not documented.
 */
export const PROCESS_VARIABLE = 'CLAUDE_PID';

/**
 * The process ID of the session that runs this command, or null outside Claude Code. The watchdog
 * marks the session's background agents stalled once it has exited (core/lib/dispatch/parent.mjs).
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {number | null}
 */
export function sessionProcessOf(env) {
  const v = env?.[PROCESS_VARIABLE];
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,9}$/.test(v)) return null;
  const pid = Number(v);
  return pid > 1 ? pid : null;
}
