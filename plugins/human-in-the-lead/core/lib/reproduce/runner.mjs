// The sandboxed test run (design part 2.2, step 3): run by sandbox.mjs as its own process, with an
// isolated environment, in the directory that holds the tests. It runs one test file with node:test
// in a child process under the permission model, and prints one JSON summary line.
//
// The child's output never reaches this process's stdout: node:test hands it over as test:stdout
// and test:stderr events, so a test cannot print a result of its own and have it counted.
//
//   node runner.mjs <json>   json: { root, test, scratch, timeout_ms }

import { run } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER = 'hitld-reproduce: network denied';
const guard = fileURLToPath(new URL('./deny-network.mjs', import.meta.url));

const { root, test, scratch, timeout_ms: timeout } = JSON.parse(process.argv[2]);
const file = join(root, test);

/** @type {{ name: string, nesting: number, passed: boolean, failure?: { type: string, name: string, code: string | null, message: string } }[]} */
const tests = [];
/** @type {string[]} */
const stderr = [];
/** @type {ReturnType<typeof failureOf> | null} */
let loadFailure = null;

/** @param {any} error */
function failureOf(error) {
  const cause = error?.cause ?? error;
  return {
    type: String(error?.failureType ?? 'unknown'),
    name: String(cause?.name ?? 'Error'),
    code: cause?.code === undefined ? null : String(cause.code),
    message: String(cause?.message ?? cause ?? '').slice(0, 2000),
  };
}

const stream = run({
  files: [file],
  concurrency: 1,
  timeout,
  execArgv: [
    '--permission',
    `--allow-fs-read=${root}`,
    `--allow-fs-read=${guard}`,
    `--allow-fs-write=${scratch}`,
    `--import=${pathToFileURL(guard).href}`,
  ],
});

stream.on('test:stderr', (e) => stderr.push(String(e.message)));
stream.on('test:pass', (e) => {
  if (e.details?.type === 'suite') return;
  tests.push({ name: e.name, nesting: e.nesting, passed: true });
});
stream.on('test:fail', (e) => {
  // The file itself fails when it does not load or exits non-zero: no test of its own ran.
  if (e.name === file || e.file === undefined) {
    loadFailure = failureOf(e.details?.error);
    return;
  }
  if (e.details?.type === 'suite') return;
  tests.push({
    name: e.name,
    nesting: e.nesting,
    passed: false,
    failure: failureOf(e.details?.error),
  });
});
// Drain the reporter stream; the events above are all this needs.
stream.on('data', () => {});
stream.on('end', () => {
  const text = stderr.join('');
  const network = text.split('\n').filter((l) => l.startsWith(MARKER)).length;
  process.stdout.write(
    `${JSON.stringify({ tests, load_failure: loadFailure, network_attempts: network, stderr: text.slice(-4000) })}\n`,
  );
});
