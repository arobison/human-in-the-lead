#!/usr/bin/env node
// Start a print-mode executor as a durable process (HITLD-746, owner decisions HITLD-768 and
// HITLD-779). A background shell of the orchestrator's dies with the orchestrator's turn, and
// anything it was running with it. So the orchestrator's call runs this launcher in the
// foreground: it starts the executor in a session and process group of its own (detached), with
// its standard input read from the brief file and its output written to the result file, writes
// the executor's process ID to the pid file, prints that ID and exits at once. The executor is then
// no child of the orchestrator or of its shell: ending the orchestrator's turn, or killing the
// shell's process group, does not reach it.
//
// Nothing waits for it. Its completion is observed (`hitld dispatch reconcile`, HITLD-780): its
// process has ended (the pid file), its output holds a result event (the result file) and its
// branch head is its closing commit with the report. No timer stops it: its budget is its cap.
//
// Usage: launch.mjs --pid <file> --in <file> --out <file> [--err <file>] -- <command> [args...]

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file, for the command line the adapter writes. */
export const LAUNCHER = fileURLToPath(import.meta.url);

/**
 * Start `command` detached, its input, output and errors on files, and write its process ID.
 * Resolves once the process has started; rejects when it cannot start (the pid file is then not
 * written, so nothing looks alive).
 * @param {{ command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv,
 *   stdin: string, stdout: string, stderr?: string | null, pidFile: string }} r
 * @returns {Promise<{ pid: number }>}
 */
export async function launchDurable(r) {
  for (const f of [r.stdout, r.pidFile, ...(r.stderr ? [r.stderr] : [])]) {
    mkdirSync(dirname(resolve(f)), { recursive: true });
  }
  const fds = [openSync(r.stdin, 'r'), openSync(r.stdout, 'w')];
  if (r.stderr) fds.push(openSync(r.stderr, 'w'));
  try {
    const child = spawn(r.command, r.args ?? [], {
      cwd: r.cwd,
      env: r.env ?? process.env,
      detached: true,
      stdio: [fds[0], fds[1], r.stderr ? fds[2] : 'ignore'],
      windowsHide: true,
    });
    await new Promise((ok, fail) => {
      child.once('spawn', ok);
      child.once('error', fail);
    });
    const pid = /** @type {number} */ (child.pid);
    writeFileSync(r.pidFile, `${pid}\n`);
    child.unref();
    return { pid };
  } finally {
    for (const fd of fds) closeSync(fd);
  }
}

/**
 * Read the command line. @param {string[]} argv
 * @returns {{ pidFile: string, stdin: string, stdout: string, stderr: string | null, command: string, args: string[] }}
 */
export function parseLaunchArgs(argv) {
  const at = argv.indexOf('--');
  if (at < 0 || at === argv.length - 1) throw new Error('give the command after --');
  /** @type {Record<string, string>} */
  const opts = {};
  const own = argv.slice(0, at);
  for (let i = 0; i < own.length; i += 2) {
    const k = own[i];
    const v = own[i + 1];
    if (!['--pid', '--in', '--out', '--err'].includes(k) || v === undefined) {
      throw new Error(`unknown or incomplete option ${k}`);
    }
    opts[k.slice(2)] = v;
  }
  for (const k of ['pid', 'in', 'out']) {
    if (!opts[k]) throw new Error(`--${k} <file> is required`);
  }
  const [command, ...args] = argv.slice(at + 1);
  return {
    pidFile: opts.pid,
    stdin: opts.in,
    stdout: opts.out,
    stderr: opts.err ?? null,
    command,
    args,
  };
}

/** Whether this file is the program being run, not a module imported. */
const isMain = () => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === LAUNCHER;
  } catch {
    return false;
  }
};

if (isMain()) {
  try {
    const a = parseLaunchArgs(process.argv.slice(2));
    const { pid } = await launchDurable(a);
    process.stdout.write(
      `${JSON.stringify({ ok: true, pid, pid_file: a.pidFile, result_file: a.stdout })}\n`,
    );
  } catch (e) {
    process.stderr.write(`launch: ${/** @type {Error} */ (e).message}\n`);
    process.exitCode = 1;
  }
}
