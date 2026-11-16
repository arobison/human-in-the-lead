// The Windows supervisor for runShell (shell.mjs): runs one shell command, relays its output,
// and on the timeout, or once either output stream passes the limit, kills the whole process tree
// with `taskkill /T /F`, which killing the shell alone would not. It writes how the command ended,
// as JSON, to file descriptor 3.
//
//   node shell-supervise.mjs <sh.exe, or "" for cmd.exe>
//
// The command, the timeout and the limit come in the environment (shell.mjs), and are removed from
// it before the command runs.

import { spawn, spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { COMMAND_VAR, SHELL_SCRIPT } from './shell.mjs';

const shell = process.argv[2] ?? '';
const {
  [COMMAND_VAR]: command = '',
  __HITLD_SHELL_TIMEOUT: timeoutText,
  __HITLD_SHELL_MAX_BUFFER: maxText,
  ...env
} = process.env;
const timeout = Number(timeoutText) || 0;
const maxBuffer = Number(maxText) || 1024 * 1024;

/** @param {{ status: number | null, error?: string, code?: string }} r */
function finish(r) {
  try {
    writeSync(3, JSON.stringify(r));
  } catch {
    // No descriptor 3: run by hand.
  }
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

const child = shell
  ? spawn(shell, ['-c', SHELL_SCRIPT], {
      env: { ...env, [COMMAND_VAR]: command },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  : spawn(command, { shell: true, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stdin?.end();

/** @type {{ error: string, code: string } | null} */
let stopped = null;
/** @param {string} code @param {string} why */
function stop(code, why) {
  if (stopped) return;
  stopped = { code, error: `${why} (${code}); the process tree was killed` };
  if (child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}

/** @param {NodeJS.ReadableStream | null} from @param {NodeJS.WriteStream} to */
function relay(from, to) {
  let bytes = 0;
  from?.on('data', (/** @type {Buffer} */ chunk) => {
    if (stopped) return;
    const room = maxBuffer - bytes;
    bytes += chunk.length;
    if (bytes > maxBuffer) {
      if (room > 0) to.write(chunk.subarray(0, room));
      stop('ENOBUFS', `the output passed ${maxBuffer} bytes`);
      return;
    }
    to.write(chunk);
  });
}
relay(child.stdout, process.stdout);
relay(child.stderr, process.stderr);

const timer =
  timeout > 0
    ? setTimeout(() => stop('ETIMEDOUT', `timed out after ${timeout} ms`), timeout)
    : null;

child.on('error', (e) => {
  if (timer) clearTimeout(timer);
  finish({ status: null, error: String(e), code: /** @type {any} */ (e).code });
});
child.on('close', (status) => {
  if (timer) clearTimeout(timer);
  // Let the relayed output drain before exiting.
  const done = () => finish(stopped ? { status: null, ...stopped } : { status: status ?? null });
  let pending = 2;
  const one = () => --pending === 0 && done();
  process.stdout.write('', one);
  process.stderr.write('', one);
});
