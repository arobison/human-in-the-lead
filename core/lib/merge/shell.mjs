// Running a policy command (merge.fast_checks, merge.full_suite, merge.scanners, the burn-in and
// regenerate commands) the way the owner wrote it: a POSIX shell command line.
//
// On macOS and Linux that is `/bin/sh -c`, as Node's `shell: true` runs it. On Windows, `shell: true`
// means cmd.exe, which does not read POSIX syntax (`"$HITLD_PRIMARY_ROOT/..."`, `VAR=1 cmd`,
// `'quoted'`). Git is a hard dependency, and Git for Windows ships a POSIX shell, so there the
// command runs in Git's `sh.exe`; only when none is found does it fall back to cmd.exe.
//
// Windows has no process groups that a timeout can kill: killing the shell leaves what it started
// running, holding the output pipes open. So on Windows a small supervisor (shell-supervise.mjs)
// runs the shell and, on the timeout or when the output passes its limit, kills the whole process
// tree with `taskkill /T /F`.
//
// The command text goes to the shell in an environment variable, not on the command line: Git's
// shell parses its Windows command line with its own rules, which collapse doubled backslashes.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitBash } from '../env/shell.mjs';

/** The variable that carries the command text to the shell; unset before the command runs. */
export const COMMAND_VAR = '__HITLD_SHELL_COMMAND';

/** What the shell runs: unset the carrier variable, then the command, parsed as `sh -c` would. */
export const SHELL_SCRIPT = `eval "unset ${COMMAND_VAR}; $${COMMAND_VAR}"`;

const SUPERVISOR = fileURLToPath(new URL('./shell-supervise.mjs', import.meta.url));

/**
 * Git for Windows' POSIX shell, as the environment manager finds it (env/shell.mjs `gitBash`):
 * next to the git on PATH, else from `git --exec-path`, else in Program Files. Null when there is
 * none. Read once per process.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function gitShell(env = process.env) {
  return gitBash(env)?.file ?? null;
}

/**
 * @typedef {{ cwd: string, env: NodeJS.ProcessEnv, timeout: number, maxBuffer?: number }} ShellOptions
 * @typedef {{ status: number | null, stdout: string, stderr: string, error?: Error }} ShellResult
 */

/**
 * Run a POSIX shell command line and wait for it, like `spawnSync(command, { shell: true })` on
 * macOS and Linux. The output is UTF-8 text.
 * @param {string} command @param {ShellOptions} o
 * @returns {ShellResult}
 */
export function runShell(command, o) {
  const maxBuffer = o.maxBuffer ?? 1024 * 1024;
  if (process.platform !== 'win32') {
    const r = spawnSync(command, {
      shell: true,
      cwd: o.cwd,
      env: o.env,
      encoding: 'utf8',
      maxBuffer,
      timeout: o.timeout,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
  }
  const shell = gitShell();
  const r = spawnSync(process.execPath, [SUPERVISOR, shell ?? ''], {
    cwd: o.cwd,
    env: {
      ...o.env,
      [COMMAND_VAR]: command,
      __HITLD_SHELL_TIMEOUT: String(o.timeout),
      __HITLD_SHELL_MAX_BUFFER: String(maxBuffer),
    },
    encoding: 'utf8',
    // The supervisor enforces both; these only catch a supervisor that itself goes wrong.
    maxBuffer: maxBuffer + 64 * 1024,
    timeout: o.timeout + 60 * 1000,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  /** @type {{ status?: number | null, error?: string, code?: string }} */
  let told = {};
  try {
    told = JSON.parse(String(r.output?.[3] ?? '') || '{}');
  } catch {
    told = {};
  }
  const error = r.error
    ? r.error
    : told.error
      ? Object.assign(new Error(told.error), told.code ? { code: told.code } : {})
      : undefined;
  return {
    status: r.error || told.status === undefined ? r.status : told.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ...(error ? { error } : {}),
  };
}
