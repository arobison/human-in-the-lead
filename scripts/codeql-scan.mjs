#!/usr/bin/env node
// This repository's merge scanner (HITLD-73; design parts 10.5 and 14.2): the CodeQL CLI, pinned,
// run on the current directory, writing SARIF to $HITLD_SARIF. Declared in
// .human-in-the-lead/policy.json merge.scanners as
//   node "${HITLD_PRIMARY_ROOT:?...}/scripts/codeql-scan.mjs"
// so the merge queue runs the primary checkout's copy of this file, never the branch's.
//
// Not shipped in the plugin: it is this repository's choice of scanner, not part of the core.
// Install the pinned bundle on the merge machine and set HITLD_CODEQL_PATH (CONTRIBUTING.md).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CODEQL_VERSION = '2.27.4';
const BUNDLE_URL = `https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_VERSION}/codeql-bundle-linux64.tar.gz`;
const BUNDLE_SHA256 = '89ed56c8ec6bfccef6a0d2e7fe86da0469ca24b4db08b88016ec134b942c17a4';
// The suite GitHub's code scanning default setup runs, so the queue and CI agree.
const SUITE = 'codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls';

const INSTALL = `Install CodeQL ${CODEQL_VERSION} on the merge machine and point HITLD_CODEQL_PATH at its codeql executable:
  curl -fLO ${BUNDLE_URL}
  echo '${BUNDLE_SHA256}  codeql-bundle-linux64.tar.gz' | sha256sum -c
  mkdir -p ~/.cache/hitld-codeql/v${CODEQL_VERSION} && tar -xzf codeql-bundle-linux64.tar.gz -C ~/.cache/hitld-codeql/v${CODEQL_VERSION}
  export HITLD_CODEQL_PATH=~/.cache/hitld-codeql/v${CODEQL_VERSION}/codeql/codeql
(see CONTRIBUTING.md)`;

/** @param {string} message @returns {never} */
function refuse(message) {
  process.stderr.write(`codeql-scan: ${message}\n`);
  process.exit(2);
}

/**
 * Run the pinned CLI with fixed arguments.
 * @param {string} codeql @param {string[]} args @param {string} cwd
 */
function codeqlRun(codeql, args, cwd) {
  // Trust boundary: the executable is $HITLD_CODEQL_PATH, set by the merge machine's owner in the
  // queue's environment, never read from the repository; the arguments are fixed here; no shell.
  // The working directory is a fresh temporary directory, not the tree under test, so no CodeQL
  // workspace, pack or configuration file the branch commits is picked up. The tree under test
  // reaches CodeQL only as --source-root: data that is extracted, never run (JavaScript and
  // TypeScript need no build command).
  return spawnSync(codeql, args, {
    cwd,
    stdio: ['ignore', process.stderr, process.stderr],
    encoding: 'utf8',
  });
}

function main() {
  // HITLD_CODEQL is its name before HITLD-82, read with a warning until the next minor release.
  const codeql = process.env.HITLD_CODEQL_PATH ?? process.env.HITLD_CODEQL;
  if (!codeql) refuse(`HITLD_CODEQL_PATH is not set.\n${INSTALL}`);
  if (!process.env.HITLD_CODEQL_PATH) {
    process.stderr.write('HITLD_CODEQL is now HITLD_CODEQL_PATH; rename it in the merge shell\n');
  }
  const sarif = process.env.HITLD_SARIF;
  if (!sarif) refuse('HITLD_SARIF is not set: run this as a merge.scanners command');
  const source = realpathSync(process.cwd());

  const v = spawnSync(codeql, ['version', '--format=json'], { encoding: 'utf8' });
  let version = '';
  try {
    version = String(JSON.parse(v.stdout).version ?? '');
  } catch {
    // reported below
  }
  if (version !== CODEQL_VERSION) {
    refuse(
      `HITLD_CODEQL_PATH runs CodeQL ${version || '(unknown version)'}; this repository pins ${CODEQL_VERSION}.\n${INSTALL}`,
    );
  }

  const work = mkdtempSync(join(tmpdir(), 'hitld-codeql-'));
  try {
    const db = join(work, 'db');
    const create = codeqlRun(
      codeql,
      [
        'database',
        'create',
        db,
        '--language=javascript-typescript',
        '--build-mode=none',
        `--source-root=${source}`,
        '--threads=0',
        `--common-caches=${join(work, 'caches')}`,
      ],
      work,
    );
    if (create.status !== 0) refuse(`codeql database create failed (exit ${create.status})`);
    const analyze = codeqlRun(
      codeql,
      [
        'database',
        'analyze',
        db,
        SUITE,
        '--no-download',
        '--format=sarif-latest',
        `--output=${sarif}`,
        '--threads=0',
        `--common-caches=${join(work, 'caches')}`,
      ],
      work,
    );
    if (analyze.status !== 0) refuse(`codeql database analyze failed (exit ${analyze.status})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
