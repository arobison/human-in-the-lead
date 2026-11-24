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
// Usage: launch.mjs [--cwd <dir>] [--cleanup <file>]... [--credential claude-code
//   [--machine-dir <dir>]] --pid <file> --in <file> --out <file> [--err <file>] -- <command> [args...]
//
// With --credential claude-code, the run starts on a long-lived credential or not at all
// (HITLD-880): one the environment already gives Claude Code, else the token `claude setup-token`
// made, read at this start from the keychain or the machine directory's file (credential.mjs) into
// the child's environment only, as CLAUDE_CODE_OAUTH_TOKEN. It is never on a command line, in
// this process's environment or in any output, and this process exits once the child has started.
// With none, nothing starts: the launcher says why, without any value, and exits 1.
//
// A launch that fails (the directory missing, the command not found) writes no pid file. With
// --cleanup, it also removes each file named and the result and error files it opened: a
// follow-up's brief and pending record go with the run that never started (HITLD-935).

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_KIND,
  childEnv,
  credentialInEnv,
  readToken,
  setupSteps,
} from './credential.mjs';

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
 * The environment a run starts in when it needs a long-lived credential (HITLD-880): `env` as it
 * is when it already gives one, else a copy with the stored token added. Refuses, naming where it
 * looked and how to make one, never a value, when there is none.
 * @param {{ env: NodeJS.ProcessEnv, machineDir: string | null, platform?: NodeJS.Platform,
 *   run?: import('./credential.mjs').Runner }} o
 * @returns {{ env: NodeJS.ProcessEnv, credential: { kind: string, source: string, variable?: string } }}
 */
export function credentialEnv(o) {
  const given = credentialInEnv(o.env);
  if (given) {
    return {
      env: o.env,
      credential: { kind: given.kind, source: 'environment', variable: given.variable },
    };
  }
  const found = readToken(o);
  if (found.value === null) {
    throw new Error(
      `refused to start the executor: no long-lived credential for unattended runs, and on the interactive sign-in it would stop when that ends. Looked in ${found.looked_in.join(', ')}${found.problems.length ? ` (${found.problems.join('; ')})` : ''}. To make one: ${setupSteps(o.platform, o.machineDir).join('; ')}`,
    );
  }
  const env = childEnv(o.env, found.value);
  return { env, credential: { kind: 'oauth-token', source: found.source } };
}

/**
 * Remove what a launch that failed leaves: the files `cleanup` names, and the result and error
 * files it opened. A file already gone is no error. @param {string[]} files
 */
export function removeAfterFailure(files) {
  for (const f of files) rmSync(f, { force: true });
}

/**
 * Read the command line. @param {string[]} argv
 * @returns {{ pidFile: string, stdin: string, stdout: string, stderr: string | null, cwd: string | null, cleanup: string[], credential: string | null, machineDir: string | null, command: string, args: string[] }}
 */
export function parseLaunchArgs(argv) {
  const at = argv.indexOf('--');
  if (at < 0 || at === argv.length - 1) throw new Error('give the command after --');
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const cleanup = [];
  const own = argv.slice(0, at);
  for (let i = 0; i < own.length; i += 2) {
    const k = own[i];
    const v = own[i + 1];
    if (
      ![
        '--pid',
        '--in',
        '--out',
        '--err',
        '--cwd',
        '--cleanup',
        '--credential',
        '--machine-dir',
      ].includes(k) ||
      v === undefined
    ) {
      throw new Error(`unknown or incomplete option ${k}`);
    }
    if (k === '--cleanup') cleanup.push(v);
    else opts[k.slice(2)] = v;
  }
  for (const k of ['pid', 'in', 'out']) {
    if (!opts[k]) throw new Error(`--${k} <file> is required`);
  }
  if (opts.credential !== undefined && opts.credential !== CREDENTIAL_KIND) {
    throw new Error(`--credential takes ${CREDENTIAL_KIND}, not ${opts.credential}`);
  }
  const [command, ...args] = argv.slice(at + 1);
  return {
    pidFile: opts.pid,
    stdin: opts.in,
    stdout: opts.out,
    stderr: opts.err ?? null,
    cwd: opts.cwd ?? null,
    cleanup,
    credential: opts.credential ?? null,
    machineDir: opts['machine-dir'] ?? null,
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
  /** @type {ReturnType<typeof parseLaunchArgs> | null} */
  let a = null;
  try {
    a = parseLaunchArgs(process.argv.slice(2));
    const { cwd, cleanup: _c, credential: need, machineDir, ...rest } = a;
    // Read before anything is opened: a refusal leaves no file behind but those --cleanup names.
    const started = need ? credentialEnv({ env: process.env, machineDir }) : null;
    // The token is only ever in started.env, a copy made for the child (childEnv), never in this
    // process's environment, so nothing this process starts after inherits it; and this process
    // writes one line and exits once the child has started.
    const { pid } = await launchDurable({
      ...rest,
      ...(cwd ? { cwd } : {}),
      ...(started ? { env: started.env } : {}),
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, pid, pid_file: a.pidFile, result_file: a.stdout, ...(started ? { credential: started.credential } : {}) })}\n`,
    );
  } catch (e) {
    const removed = a?.cleanup.length
      ? [...a.cleanup, a.stdout, ...(a.stderr ? [a.stderr] : [])]
      : [];
    removeAfterFailure(removed);
    process.stderr.write(
      `launch: ${/** @type {Error} */ (e).message}${removed.length ? `; removed ${removed.length} files written for it` : ''}\n`,
    );
    process.exitCode = 1;
  }
}
