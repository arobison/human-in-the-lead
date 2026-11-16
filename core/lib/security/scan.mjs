// Running a declared scanner (design parts 10.5 and 14.2). No scanner is built in: policy.json
// merge.scanners names each one's command and output format.

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShell } from '../merge/shell.mjs';
import { MAX_SARIF_BYTES, fingerprintRuns, readSarif } from './sarif.mjs';

/**
 * @typedef {{ name: string, command: string, format?: 'sarif' }} Scanner an entry of merge.scanners
 * @typedef {import('./sarif.mjs').Finding} Finding
 * @typedef {{ ok: true, scanner: string, tools: { tool: string, version: string }[], findings: Finding[] }
 *   | { ok: false, scanner: string, command: string, output: string }} ScanResult
 * @typedef {{ primaryRoot?: string, timeoutMs?: number }} ScanOptions
 * @typedef {(scanner: Scanner, cwd: string, options?: ScanOptions) => ScanResult} RunScanner
 */

const TAIL = 2000;
/** @param {string} s */
const tail = (s) => (s.length > TAIL ? `...${s.slice(-TAIL)}` : s);

/** @param {string} path @returns {string} the file's text, or '' when absent, empty or not a regular file */
function readOutput(path) {
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_SARIF_BYTES) return '';
    return readFileSync(fd, 'utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Run one scanner in a directory and read its findings. The scanner writes SARIF to the file
 * named by $HITLD_SARIF, or to its standard output. HITLD_SARIF is a fresh file outside the
 * directory under test, so a file the branch commits cannot stand in for the scanner's output.
 * The exit status is not the verdict: many scanners exit non-zero when they find something. A
 * scanner that writes no SARIF has failed.
 *
 * `primaryRoot` is the primary checkout the policy was read from. It is exported to the scanner
 * as $HITLD_PRIMARY_ROOT, so a command that runs a script kept in the repository can run the
 * primary checkout's copy (`node "$HITLD_PRIMARY_ROOT/scripts/scan.mjs"`) and never the copy in
 * the branch under test, which a branch could edit to report nothing. Without it the variable is
 * unset, whatever this process's environment holds.
 * @param {Scanner} scanner @param {string} cwd
 * @param {ScanOptions} [options]
 * @returns {ScanResult}
 */
export function runScanner(scanner, cwd, options = {}) {
  const out = mkdtempSync(join(tmpdir(), 'hitld-scan-'));
  const sarifPath = join(out, 'out.sarif');
  try {
    // Not this process's test-runner context: a project's own `node --test` would report to it.
    // HITLD_SARIF and HITLD_PRIMARY_ROOT come only from here, never from the inherited environment.
    const {
      NODE_TEST_CONTEXT: _context,
      HITLD_SARIF: _sarif,
      HITLD_PRIMARY_ROOT: _primary,
      ...inherited
    } = process.env;
    // Trust boundary (design parts 10 and 14.2): `scanner.command` is an entry of policy.json
    // merge.scanners, a key marked x-hitld-executes. The owner declares it as a shell command and
    // the queue runs it on purpose, so a shell is the declared contract. It reaches here only from
    // a policy that came through loadPolicy's trusted read (owner, mode, no link, inside the
    // repository root) in the primary checkout, never from the branch under test; this function
    // takes no command from anywhere else. The branch's code is what is scanned, as data. The
    // working directory is the branch, so a script the command names by a relative path is the
    // branch's copy, which the branch controls; $HITLD_PRIMARY_ROOT (the trusted primary checkout,
    // as given by the caller) is how a command names the owner's copy instead.
    // A POSIX shell command line, on Windows too: Git's sh there, never cmd.exe while it is found.
    const r = runShell(scanner.command, {
      cwd,
      env: {
        ...inherited,
        HITLD_SARIF: sarifPath,
        ...(options.primaryRoot ? { HITLD_PRIMARY_ROOT: options.primaryRoot } : {}),
      },
      maxBuffer: MAX_SARIF_BYTES,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
    });
    const text = readOutput(sarifPath) || r.stdout;
    const diagnostics = `${r.stderr}${r.error ? String(r.error) : ''}`;
    try {
      const runs = readSarif(text);
      return {
        ok: true,
        scanner: scanner.name,
        tools: runs.map((x) => ({ tool: x.tool, version: x.version })),
        findings: fingerprintRuns(runs, cwd),
      };
    } catch (e) {
      return {
        ok: false,
        scanner: scanner.name,
        command: scanner.command,
        output: tail(
          `scanner ${scanner.name} wrote no SARIF (exit ${r.status}): ${/** @type {Error} */ (e).message}\n${diagnostics}`,
        ),
      };
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
