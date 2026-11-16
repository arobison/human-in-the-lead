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
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The variable that carries the command text to the shell; unset before the command runs. */
export const COMMAND_VAR = '__HITLD_SHELL_COMMAND';

/** What the shell runs: unset the carrier variable, then the command, parsed as `sh -c` would. */
export const SHELL_SCRIPT = `eval "unset ${COMMAND_VAR}; $${COMMAND_VAR}"`;

const SUPERVISOR = fileURLToPath(new URL('./shell-supervise.mjs', import.meta.url));

/** @type {string | null | undefined} */
let found;

/**
 * Git for Windows' POSIX shell (`<Git>\bin\sh.exe`, else `bash.exe`), found from where git.exe is
 * on PATH (`<Git>\cmd`, `<Git>\bin` or `<Git>\mingw64\bin`), else from `git --exec-path`
 * (`<Git>\mingw64\libexec\git-core`). Null when there is none. Read once per process.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function gitShell(env = process.env) {
  if (found !== undefined) return found;
  /** @param {string} root */
  const shellIn = (root) =>
    ['sh.exe', 'bash.exe'].map((n) => join(root, 'bin', n)).find((p) => existsSync(p)) ?? null;
  /** @type {string[]} */
  const roots = [];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    const d = dir.replace(/^"(.*)"$/, '$1');
    if (existsSync(join(d, 'git.exe'))) roots.push(dirname(d), dirname(dirname(d)));
  }
  for (const root of roots) {
    const sh = shellIn(root);
    if (sh) return (found = sh);
  }
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
  const exec = r.status === 0 ? r.stdout.trim() : '';
  found = exec ? shellIn(join(exec, '..', '..', '..')) : null;
  return found;
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
