// Loaded before every test file (`npm test` passes it with --import; HITLD-131). Each test file's
// process gets a fresh home and an isolated environment (core/lib/isolated-env.mjs), so a person
// file, a machine file, a git config or an HITLD_* variable on this machine cannot change a result.
// A file-system call that still reaches the real home throws, and the file's process exits non-zero
// naming the path, so the test fails even where the code under test swallows the error.
//
// The checkout, the temporary directory and the fresh home stay reachable when they sit under the
// real home (a checkout in ~/src, a runner's work directory).

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateProcessEnv } from '../../lib/isolated-env.mjs';

/** Where the real homes go, for a process a test file starts that loads this file too. */
const REAL_HOMES = 'TEST_GUARD_REAL_HOMES';

/** @returns {string[]} */
function realHomes() {
  const passed = process.env[REAL_HOMES];
  if (passed) return JSON.parse(passed);
  /** @type {string[]} */
  const homes = [os.homedir()];
  try {
    homes.push(os.userInfo().homedir);
  } catch {
    // no account entry for this user: HOME is the only home there is
  }
  // A home of "/" would put every path under it; the isolated environment covers that case alone.
  return [...new Set(homes.filter((h) => h && resolve(h) !== resolve('/')).map((h) => resolve(h)))];
}

export const REAL_HOME_DIRS = Object.freeze(realHomes());
const tmp = resolve(os.tmpdir());
export const ISOLATED_HOME = fs.mkdtempSync(resolve(tmp, 'hitld-test-home-'));
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The test runner's own variables tell this process how to report to the runner; they stay.
const runner = Object.entries(process.env).filter(([name]) => name.startsWith('NODE_TEST_'));
isolateProcessEnv(ISOLATED_HOME);
for (const [name, value] of runner) process.env[name] = value;
process.env[REAL_HOMES] = JSON.stringify(REAL_HOME_DIRS);

// Node's own directory stays on PATH (core/lib/isolated-env.mjs), so a lookup there is allowed.
const allowed = [checkout, tmp, safeRealpath(tmp), ISOLATED_HOME, dirname(process.execPath)];

/** @param {string} p */
function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** @param {string} p @param {string} root */
const inside = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** @type {string[]} */
export const reached = [];

/** @param {unknown} arg */
function check(arg) {
  /** @type {string | undefined} */
  let p;
  if (typeof arg === 'string') p = arg;
  else if (arg instanceof URL && arg.protocol === 'file:') p = fileURLToPath(arg);
  else if (Buffer.isBuffer(arg)) p = arg.toString();
  if (p === undefined) return;
  const abs = resolve(p);
  if (!REAL_HOME_DIRS.some((h) => inside(abs, h))) return;
  if (allowed.some((a) => inside(abs, a))) return;
  reached.push(abs);
  throw new Error(`a test reached the real home directory: ${abs}`);
}

// The calls that take a path first, and those that take two (from, to).
const ONE = [
  'access',
  'appendFile',
  'chmod',
  'chown',
  'createReadStream',
  'createWriteStream',
  'exists',
  'lchown',
  'lstat',
  'lutimes',
  'mkdir',
  'mkdtemp',
  'open',
  'opendir',
  'readdir',
  'readFile',
  'readlink',
  'realpath',
  'rm',
  'rmdir',
  'stat',
  'statfs',
  'truncate',
  'unlink',
  'utimes',
  'watch',
  'watchFile',
  'writeFile',
];
const TWO = ['copyFile', 'cp', 'link', 'rename', 'symlink'];

/** @param {Record<string, any>} target @param {string} name @param {boolean} two */
function guard(target, name, two) {
  const original = target[name];
  if (typeof original !== 'function') return;
  /** @this {unknown} @param {unknown[]} args */
  const guarded = function (...args) {
    check(args[0]);
    if (two) check(args[1]);
    return original.apply(this, args);
  };
  if (original.native) guarded.native = original.native;
  target[name] = guarded;
}

for (const [names, two] of /** @type {const} */ ([
  [ONE, false],
  [TWO, true],
])) {
  for (const name of names) {
    guard(fs, name, two);
    guard(fs, `${name}Sync`, two);
    guard(fs.promises, name, two);
  }
}
syncBuiltinESMExports();

process.on('exit', () => {
  if (reached.length) {
    process.stderr.write(
      `\nthe real home directory was reached ${reached.length} time(s), first at ${reached[0]}\n`,
    );
    process.exitCode = 1;
  }
  try {
    fs.rmSync(ISOLATED_HOME, { recursive: true, force: true });
  } catch {
    // a temporary directory: the system clears it
  }
});
