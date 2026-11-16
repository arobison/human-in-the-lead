// An isolated home and environment, shared by the test suite and the offline eval runner
// (HITLD-131). A person file, a machine file, a git config or an HITLD_* variable on the machine
// running them must not change what they find: each gets a fresh home of its own, and from the
// environment only what a process needs to start programs and handle text.
//
//   isolatedEnv(home)        the environment for a home: the kept variables, with HOME, the XDG
//                            directories and git's global config pointed into it, and PATH without
//                            the directories under the old home (~/.local/bin and the like), which
//                            hold the person's own programs; node's own directory stays first
//   isolateProcessEnv(home)  the same, put in place of process.env; returns the function that puts
//                            the old one back

import { mkdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

/** The variables kept from the environment: programs on PATH, temporary files, text, time. */
export const KEPT_VARIABLES = Object.freeze([
  'PATH',
  'Path',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'WINDIR',
  // Coverage tools collect through it; it reads nothing of the person's or machine's.
  'NODE_V8_COVERAGE',
]);

/**
 * @param {string} home an absolute directory, which need not exist yet
 * @param {NodeJS.ProcessEnv} [base] where the kept variables come from
 * @returns {Record<string, string>}
 */
export function isolatedEnv(home, base = process.env) {
  /** @type {Record<string, string>} */
  const env = {};
  const homes = [base.HOME, base.USERPROFILE]
    .filter((h) => h && resolve(h) !== resolve('/'))
    .map((h) => resolve(/** @type {string} */ (h)));
  for (const name of KEPT_VARIABLES) {
    const value = base[name];
    if (value === undefined) continue;
    env[name] = name === 'PATH' || name === 'Path' ? isolatedPath(value, homes) : value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/**
 * PATH without the directories under one of `homes`, with node's own directory first.
 * @param {string} path @param {string[]} homes
 */
function isolatedPath(path, homes) {
  const node = dirname(process.execPath);
  const kept = path
    .split(delimiter)
    .filter((d) => d && d !== node && !homes.some((h) => inside(resolve(d), h)));
  return [node, ...kept].join(delimiter);
}

/** @param {string} p @param {string} root */
const inside = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * Put an isolated environment for `home` in place of process.env, in the same object, so code that
 * holds process.env sees it too. The home is made if it is missing.
 * @param {string} home
 * @returns {() => void} puts the environment from before back
 */
export function isolateProcessEnv(home) {
  mkdirSync(home, { recursive: true });
  const saved = { ...process.env };
  replaceEnv(isolatedEnv(home, saved));
  return () => replaceEnv(saved);
}

/** @param {NodeJS.ProcessEnv} next */
function replaceEnv(next) {
  for (const name of Object.keys(process.env)) {
    if (!Object.hasOwn(next, name)) delete process.env[name];
  }
  for (const [name, value] of Object.entries(next)) {
    if (value !== undefined) process.env[name] = value;
  }
}
