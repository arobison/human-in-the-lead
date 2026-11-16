#!/usr/bin/env node
// `npm run check:fast` (HITLD-131): what an executor runs while it works. The full `npm run check`
// stays the gate before a report, and CI runs that.
//
//   1. the typecheck, whole (it takes about a second)
//   2. the format check on the files the branch changes
//   3. the tests of the areas the branch touches:
//      - a changed module (core/, scripts/): every test that imports, directly or through other
//        modules, a module in the same directory
//      - a changed test file: that file; a changed test helper: every test that imports it
//      - another changed file under a directory (schemas/, skills/, evals/, work/, .github/ ...):
//        every test whose own source, or a module it imports, names that directory
//      - a changed file at the top of the repository (package.json, tsconfig.json ...): every test
//      - any change outside work/ and docs/: the plugin build test too, since the plugin copies it
//
// The branch's changes are those since it left main (the merge base with origin/main, or main),
// with uncommitted and untracked files. --base <ref> names another base; --list prints the plan as
// JSON and runs nothing.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The node --test arguments `npm test` uses (a test keeps package.json in step with this). */
export const TEST_ARGS = [
  '--test',
  '--import',
  './core/test/helpers/isolated-home.mjs',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=./core/test/helpers/slowest-reporter.mjs',
  '--test-reporter-destination=stdout',
];

const BUILD_MODULE = 'core/lib/packaging/build.mjs';
const IMPORT =
  /(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * Every repository-relative module a file imports, directly or not, itself included.
 * @param {string} file repository-relative
 * @param {(file: string) => string | null} read
 * @param {Map<string, Set<string>>} [memo]
 * @returns {Set<string>}
 */
export function importGraph(file, read, memo = new Map()) {
  const seen = new Set();
  const stack = [file];
  while (stack.length) {
    const f = /** @type {string} */ (stack.pop());
    if (seen.has(f)) continue;
    seen.add(f);
    const known = memo.get(f);
    if (known) {
      for (const k of known) seen.add(k);
      continue;
    }
    const text = read(f);
    if (text === null) continue;
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      stack.push(posix.normalize(posix.join(posix.dirname(f), spec)));
    }
  }
  memo.set(file, seen);
  return seen;
}

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which tests to run for a set of changed paths.
 * @param {string[]} changed repository-relative, forward slashes
 * @param {string[]} tests every test file, repository-relative
 * @param {(file: string) => string | null} read a file's text, or null when it is missing
 * @returns {{ tests: string[], all: boolean, reasons: string[] }}
 */
export function selectTests(changed, tests, read) {
  const memo = new Map();
  const graphs = new Map(tests.map((t) => [t, importGraph(t, read, memo)]));
  /** @type {Set<string>} */
  const chosen = new Set();
  /** @type {string[]} */
  const reasons = [];
  /** @param {string} why @param {(t: string) => boolean} pick */
  const add = (why, pick) => {
    const hits = tests.filter(pick);
    for (const t of hits) chosen.add(t);
    reasons.push(`${why}: ${hits.length} test file(s)`);
  };
  for (const path of changed) {
    if (!path.includes('/')) {
      if (/\.md$/i.test(path)) continue;
      reasons.push(`${path} is at the top of the repository: every test`);
      return { tests: [...tests], all: true, reasons };
    }
    if (path.endsWith('.test.mjs') && path.startsWith('core/test/')) {
      if (tests.includes(path)) {
        chosen.add(path);
        reasons.push(`${path}: itself`);
      }
      continue;
    }
    if (path.startsWith('core/test/') && path.endsWith('.mjs')) {
      add(`${path} (a test helper)`, (t) => /** @type {Set<string>} */ (graphs.get(t)).has(path));
      continue;
    }
    if (/^(core|scripts)\//.test(path) && path.endsWith('.mjs')) {
      const area = posix.dirname(path);
      add(`${path} (area ${area})`, (t) =>
        [.../** @type {Set<string>} */ (graphs.get(t))].some((f) => posix.dirname(f) === area),
      );
      continue;
    }
    const top = path.split('/')[0];
    const named = new RegExp(`['"\`/]${escape(top)}['"\`/]`);
    add(`${path} (directory ${top}/)`, (t) =>
      [.../** @type {Set<string>} */ (graphs.get(t))].some((f) => named.test(read(f) ?? '')),
    );
  }
  if (changed.some((p) => p.includes('/') && !/^(work|docs)\//.test(p))) {
    add('the plugin copies it', (t) =>
      /** @type {Set<string>} */ (graphs.get(t)).has(BUILD_MODULE),
    );
  }
  return { tests: tests.filter((t) => chosen.has(t)), all: false, reasons };
}

/** @param {string[]} args @returns {{ status: number | null, stdout: string }} */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '' };
}

/** @param {string | undefined} base @returns {string} */
function baseOf(base) {
  if (base) return base;
  for (const ref of ['origin/main', 'main']) {
    const r = git(['merge-base', 'HEAD', ref]);
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error('no merge base with origin/main or main; pass --base <ref>');
}

/** @param {string} base @returns {string[]} */
function changedSince(base) {
  const diff = git(['diff', '--name-only', '--no-renames', base]);
  if (diff.status !== 0) throw new Error(`git diff ${base} failed`);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...diff.stdout.split('\n'), ...untracked.stdout.split('\n')])]
    .filter(Boolean)
    .sort();
}

/** @returns {string[]} */
function testFiles() {
  return readdirSync(join(ROOT, 'core', 'test'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => posix.join('core/test', f.split(/[\\/]/).join('/')))
    .sort();
}

/** @param {string} file @returns {string | null} */
function read(file) {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} label @param {string} command @param {string[]} args */
function step(label, command, args) {
  process.stdout.write(`\n== ${label}\n`);
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0;
}

/** @param {string[]} argv */
function main(argv) {
  const at = argv.indexOf('--base');
  const base = baseOf(at >= 0 ? argv[at + 1] : undefined);
  const changed = changedSince(base);
  const plan = selectTests(changed, testFiles(), read);
  const format = changed.filter((p) => existsSync(join(ROOT, p)));
  if (argv.includes('--list')) {
    process.stdout.write(
      `${JSON.stringify({ base, changed, format, tests: plan.tests, reasons: plan.reasons }, null, 2)}\n`,
    );
    return 0;
  }
  const bin = (/** @type {string} */ name) => join(ROOT, 'node_modules', '.bin', name);
  let ok = step('typecheck', bin('tsc'), ['-p', 'tsconfig.json']);
  if (format.length) {
    ok =
      step(`format check (${format.length} changed file(s))`, bin('prettier'), [
        '--check',
        '--cache',
        '--ignore-unknown',
        ...format,
      ]) && ok;
  } else process.stdout.write('\n== format check: no changed files\n');
  process.stdout.write(`\n== tests\n${plan.reasons.map((r) => `  ${r}`).join('\n')}\n`);
  if (plan.tests.length) {
    ok =
      step(`tests (${plan.tests.length} file(s))`, process.execPath, [
        ...TEST_ARGS,
        ...plan.tests,
      ]) && ok;
  } else process.stdout.write('no test file covers the changes\n');
  process.stdout.write(
    `\ncheck:fast ${ok ? 'passed' : 'failed'} (base ${base.slice(0, 12)}); run the full \`npm run check\` before you report\n`,
  );
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`check:fast: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
