// A fresh worktree with nothing installed (HITLD-292). The merge queue runs merge.fast_checks and
// merge.full_suite in a fresh worktree of its own, which holds only what git tracks and what
// env.worktree_setup makes. A policy that sets those checks and no setup passes every check
// policy can make, then fails its first merge on a branch that did nothing wrong. Setup and check
// time (check policy, config explain, install) warn about it; the queue stops on it before it
// checks a branch, when a lockfile shows what the worktree lacks.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from '../precedent/glob.mjs';

/**
 * The lockfiles at a repository's root, in the order they are looked for, each with the install
 * command the adopt skill would propose for it and, when the install lands inside the worktree,
 * the directory it makes there (dependencies in a shared cache, as Go's and Cargo's, have none:
 * their checks fetch on demand).
 * @type {{ file: string, install: string, dir?: string }[]}
 */
export const LOCKFILES = [
  { file: 'package-lock.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'npm-shrinkwrap.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'pnpm-lock.yaml', install: 'pnpm install --frozen-lockfile', dir: 'node_modules' },
  { file: 'yarn.lock', install: 'yarn install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lock', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lockb', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'uv.lock', install: 'uv sync --frozen', dir: '.venv' },
  { file: 'poetry.lock', install: 'poetry install' },
  { file: 'Pipfile.lock', install: 'pipenv sync' },
  { file: 'Gemfile.lock', install: 'bundle install' },
  { file: 'Cargo.lock', install: 'cargo fetch' },
  { file: 'go.sum', install: 'go mod download' },
];

/** The first lockfile at `root`, if any. @param {string | null} root */
export const lockfileAt = (root) =>
  root ? (LOCKFILES.find((l) => existsSync(join(root, l.file))) ?? null) : null;

/** @param {{ file: string, install: string }} lock */
const propose = (lock) => `${lock.file} is here: propose "${lock.install}"`;

const ALSO =
  'and any command that makes the generated, uncommitted files the checks import, not only the install';

/**
 * The warning for a policy whose merge queue runs checks in a worktree its setup leaves empty, or
 * null. Only the local queue (merge.via push) runs them in its own worktree; with pull requests
 * the checks run where the pull request's checks do.
 * @param {{ merge?: { via?: string, fast_checks?: string[], full_suite?: string[] }, env?: { worktree_setup?: string[] } } | null} policy
 *   the effective policy
 * @param {string | null} root the repository's root, where a lockfile is looked for
 * @returns {string | null}
 */
export function worktreeSetupGap(policy, root) {
  if (!policy) return null;
  const merge = policy.merge ?? {};
  if ((merge.via ?? 'push') !== 'push') return null;
  if ((policy.env?.worktree_setup ?? []).length) return null;
  const set = [
    ...((merge.fast_checks ?? []).length ? ['merge.fast_checks'] : []),
    ...((merge.full_suite ?? []).length ? ['merge.full_suite'] : []),
  ];
  if (!set.length) return null;
  const lock = lockfileAt(root);
  return (
    `${set.join(' and ')} ${set.length > 1 ? 'are' : 'is'} set but env.worktree_setup is empty: ` +
    `the merge queue runs ${set.length > 1 ? 'these' : 'it'} in a fresh worktree with nothing installed; ` +
    `set env.worktree_setup in .human-in-the-lead/policy.json${lock ? ` (${propose(lock)})` : ''}, ${ALSO}`
  );
}

/**
 * Why the queue's fresh worktree cannot run the checks, or null: no setup, and a lockfile there
 * whose install directory is missing. Without a lockfile the queue cannot tell, and goes on.
 * @param {string} dir the fresh worktree @param {string[]} setup env.worktree_setup
 * @returns {string | null}
 */
export function emptyWorktree(dir, setup) {
  if (setup.length) return null;
  const lock = LOCKFILES.find((l) => l.dir && existsSync(join(dir, l.file)));
  if (!lock?.dir || existsSync(join(dir, lock.dir))) return null;
  return (
    `the merge queue's fresh worktree has no ${lock.dir} and env.worktree_setup is empty, so the checks cannot run there; ` +
    `nothing was checked or merged, and no branch is at fault. Set env.worktree_setup in .human-in-the-lead/policy.json ` +
    `(${propose(lock)}), ${ALSO}, then run hitld merge again`
  );
}

// What hitld install proposes for a fresh worktree and the merge queue (HITLD-976): the lockfile's
// install as env.worktree_setup, and the check scripts the project's packages declare as
// merge.full_suite and merge.fast_checks. Read as data: nothing in the repository runs, and the
// owner approves each command before it goes into policy.json.

/** The package manager that runs the scripts of a JavaScript lockfile's packages. */
const RUNNERS = /** @type {Record<string, string>} */ ({
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
});

/** The package.json scripts read as checks. */
const CHECK_SCRIPTS = ['check', 'lint', 'typecheck', 'test'];
/** Folders a workspace glob never reaches into. */
const SKIP = new Set(['node_modules', '.git']);
/** How deep a workspace glob is followed. */
const DEPTH = 4;

/** @param {string} path @returns {Record<string, any> | null} */
function readJsonObject(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The `packages` list of a pnpm-workspace.yaml: the block sequence under that top-level key, with
 * quotes and comments removed. Only that key is read, so no YAML library is needed.
 * @param {string} text @returns {string[]}
 */
export function pnpmWorkspaceGlobs(text) {
  /** @type {string[]} */
  const out = [];
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inside = /^packages\s*:\s*$/.test(line);
      continue;
    }
    const m = inside ? /^\s+-\s+(.+?)\s*$/.exec(line) : null;
    if (m) out.push(m[1].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

/**
 * The workspace globs of a repository: pnpm-workspace.yaml's for pnpm, package.json `workspaces`
 * otherwise.
 * @param {string} root @param {string} runner @param {Record<string, any> | null} rootPkg
 * @returns {string[]}
 */
function workspaceGlobs(root, runner, rootPkg) {
  if (runner === 'pnpm') {
    const file = join(root, 'pnpm-workspace.yaml');
    return existsSync(file) ? pnpmWorkspaceGlobs(readFileSync(file, 'utf8')) : [];
  }
  const w = rootPkg?.workspaces;
  const list = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : [];
  return list.filter((/** @type {unknown} */ g) => typeof g === 'string');
}

/** A workspace glob without a leading "./" or a trailing "/". @param {string} g */
const trimGlob = (g) => g.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * The folders under `root` that hold a package.json and match the workspace globs ("!" globs
 * exclude), repository-relative and sorted.
 * @param {string} root @param {string[]} globs @returns {string[]}
 */
export function workspacePackages(root, globs) {
  const include = globs.filter((g) => !g.startsWith('!')).map(trimGlob);
  const exclude = globs.filter((g) => g.startsWith('!')).map((g) => trimGlob(g.slice(1)));
  if (!include.length) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel @param {number} depth */
  const walk = (rel, depth) => {
    if (depth > DEPTH) return;
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (
        matchesAny(include, path) &&
        !matchesAny(exclude, path) &&
        existsSync(join(root, path, 'package.json'))
      ) {
        out.push(path);
      }
      walk(path, depth + 1);
    }
  };
  walk('', 1);
  return out.sort();
}

/** The test script npm init writes, which only fails. @param {unknown} s */
const placeholder = (s) => typeof s === 'string' && /no test specified/.test(s);

/**
 * The command that runs one script: at the root when the root declares it, else in every
 * workspace package that does (npm and pnpm; null for the others).
 * @param {string} runner @param {string} script @param {boolean} atRoot
 * @returns {string | null}
 */
function runScript(runner, script, atRoot) {
  if (atRoot) return runner === 'npm' && script === 'test' ? 'npm test' : `${runner} run ${script}`;
  if (runner === 'pnpm') return `pnpm -r --if-present run ${script}`;
  if (runner === 'npm') return `npm run ${script} --workspaces --if-present`;
  return null;
}

/**
 * @typedef {object} SetupProposal
 * @property {string} lockfile the lockfile it is read from
 * @property {string[]} worktree_setup for env.worktree_setup
 * @property {string[]} full_suite for merge.full_suite
 * @property {string[]} fast_checks for merge.fast_checks
 * @property {string[]} packages the workspace packages found, repository-relative
 * @property {string[]} sources where each check comes from, as `<file>: scripts.<name>`
 */

/** @param {Record<string, any> | null} pkg @returns {Record<string, unknown>} */
const scriptsOf = (pkg) =>
  pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {};

/**
 * What a fresh worktree and the merge queue need, read from the lockfile at `root` and the scripts
 * its packages declare, or null with no lockfile. A proposal for the owner, never applied.
 * @param {string | null} root @returns {SetupProposal | null}
 */
export function proposeSetup(root) {
  const lock = lockfileAt(root);
  if (!root || !lock) return null;
  /** @type {SetupProposal} */
  const out = {
    lockfile: lock.file,
    worktree_setup: [lock.install],
    full_suite: [],
    fast_checks: [],
    packages: [],
    sources: [],
  };
  const runner = RUNNERS[lock.file];
  if (!runner) return out;
  const rootPkg = readJsonObject(join(root, 'package.json'));
  out.packages = workspacePackages(root, workspaceGlobs(root, runner, rootPkg));
  const rootScripts = scriptsOf(rootPkg);
  const members = out.packages.map((dir) => ({
    file: `${dir}/package.json`,
    scripts: scriptsOf(readJsonObject(join(root, dir, 'package.json'))),
  }));
  /** @type {Record<string, string>} */
  const command = {};
  for (const script of CHECK_SCRIPTS) {
    /** @param {Record<string, unknown>} s */
    const declares = (s) => typeof s[script] === 'string' && !placeholder(s[script]);
    if (declares(rootScripts)) {
      command[script] = /** @type {string} */ (runScript(runner, script, true));
      out.sources.push(`package.json: scripts.${script}`);
      continue;
    }
    const declaring = members.filter((m) => declares(m.scripts));
    const cmd = declaring.length ? runScript(runner, script, false) : null;
    if (!cmd) continue;
    command[script] = cmd;
    out.sources.push(...declaring.map((m) => `${m.file}: scripts.${script}`));
  }
  // The fast checks run on each branch first, the full suite once per batch: `check` (or else
  // `test`) is the suite, lint and type check are fast. With neither, the fast ones are the suite.
  const fast = ['lint', 'typecheck'].filter((s) => command[s]).map((s) => command[s]);
  const suite = command.check ?? command.test;
  out.full_suite = suite ? [suite] : fast;
  out.fast_checks = suite ? fast : [];
  return out;
}
