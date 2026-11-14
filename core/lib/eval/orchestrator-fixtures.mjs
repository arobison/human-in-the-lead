// Synthetic repositories for piece (h)'s scenarios and tests (design part 17.2): a consumer with a
// tracker and a full suite, and a repository whose branches exercise the merge queue. Public,
// generated, nothing from a real project.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @param {string} cwd @param {...string} args */
export const fixtureGit = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();

/** @param {string} root @param {Record<string, string>} files */
export function putFiles(root, files) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

/** @param {string} root */
function initRepo(root) {
  mkdirSync(root, { recursive: true });
  fixtureGit(root, 'init', '-q', '-b', 'main');
  fixtureGit(root, 'config', 'user.name', 'Fixture');
  fixtureGit(root, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(root, 'config', 'commit.gpgsign', 'false');
}

/** @param {string} root @param {string} message */
export function commitAll(root, message) {
  fixtureGit(root, 'add', '-A');
  fixtureGit(root, 'commit', '-q', '-m', message);
  return fixtureGit(root, 'rev-parse', 'HEAD');
}

const ITEM_BODY = '\n## Done when\n\n`node --test` passes.\n\n## Plan\n\nChange `src/calc.js`.\n';

/**
 * An item file in the reference format.
 * @param {Record<string, string | string[]>} fields @param {string} [body]
 */
export function itemFile(fields, body = ITEM_BODY) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`);
  }
  return `${lines.join('\n')}\n---\n${body}`;
}

/**
 * A consumer repository on main, committed: a tracker with three items (W-3 needs W-1), a tiny
 * source with a test, and a policy whose full suite runs it.
 * @param {string} root an absent or empty directory
 * @param {{ policy?: Record<string, unknown>, files?: Record<string, string> }} [options]
 */
export function buildConsumer(root, options = {}) {
  initRepo(root);
  putFiles(root, {
    '.human-in-the-lead/policy.json': JSON.stringify(
      {
        schema_version: 1,
        project: { id: 'orch-fixture', key: 'W' },
        merge: { mode: 'queue', full_suite: ["node --test 'test/*.test.js'"] },
        ...(options.policy ?? {}),
      },
      null,
      2,
    ),
    '.human-in-the-lead/tracker.json': JSON.stringify({
      schema_version: 1,
      optional_keys: ['touches', 'serial', 'tier_hint', 'estimate_tokens'],
    }),
    'package.json': '{ "type": "module" }\n',
    'src/calc.js': 'export const add = (a, b) => a + b;\n',
    'src/other.js': 'export const one = 1;\n',
    'test/calc.test.js':
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/calc.js';\ntest('add', () => assert.equal(add(1, 2), 3));\n",
    'work/items/W-1-add-numbers.md': itemFile({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      status: 'Planned',
      priority: 'medium',
      touches: ['src/calc.js'],
    }),
    'work/items/W-2-another-thing.md': itemFile({
      id: 'W-2',
      title: 'Another thing',
      kind: 'work',
      status: 'Planned',
      priority: 'high',
      touches: ['src/other.js'],
    }),
    'work/items/W-3-after-one.md': itemFile({
      id: 'W-3',
      title: 'After one',
      kind: 'work',
      status: 'Planned',
      priority: 'medium',
      needs: ['W-1'],
      touches: ['src/calc.js'],
    }),
    ...(options.files ?? {}),
  });
  commitAll(root, 'fixture');
  return root;
}

const TEST = (/** @type {string} */ name, /** @type {string} */ body) =>
  `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${body}\ntest('${name}', () => check());\n`;

/**
 * A repository for the merge queue: main with a generated file, and four waiting branches.
 *   W-1 adds src/b.js and touches the generated file
 *   W-2 changes a constant the suite checks: the batch fails, and bisection must name it
 *   W-3 adds src/c.js and touches the generated file differently: a generated conflict, resolved
 *   W-4 adds its own src/b.js: a semantic conflict with W-1, sent back
 * With `flaky`, main carries a test that fails once, the first time it runs anywhere.
 * @param {string} root @param {{ flaky?: boolean, marker?: string }} [options]
 */
export function buildMergeRepo(root, options = {}) {
  initRepo(root);
  putFiles(root, {
    'package.json': '{ "type": "module" }\n',
    'gen.mjs':
      "import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';\nmkdirSync('gen', { recursive: true });\nwriteFileSync('gen/files.txt', readdirSync('src').sort().join('\\n') + '\\n');\n",
    'gen/files.txt': 'a.js\n',
    'src/a.js': 'export const a = 1;\n',
    'test/a.test.js': TEST(
      'a is 1',
      "import { a } from '../src/a.js';\nconst check = () => assert.equal(a, 1);",
    ),
    ...(options.flaky
      ? {
          'test/flaky.test.js': TEST(
            'flaky once',
            `import { existsSync, writeFileSync } from 'node:fs';\nconst marker = ${JSON.stringify(options.marker ?? join(root, '..', 'flake-marker'))};\nconst check = () => { if (!existsSync(marker)) { writeFileSync(marker, 'x'); assert.fail('first run'); } };`,
          ),
        }
      : {}),
  });
  const base = commitAll(root, 'main');
  /** @param {string} branch @param {Record<string, string>} files */
  const branch = (branch, files) => {
    fixtureGit(root, 'switch', '-q', '-c', branch, base);
    putFiles(root, files);
    commitAll(root, branch);
    fixtureGit(root, 'switch', '-q', 'main');
  };
  if (options.flaky) {
    branch('hitld/W-1-b', {
      'src/b.js': 'export const b = 2;\n',
      'test/b.test.js': TEST(
        'b is 2',
        "import { b } from '../src/b.js';\nconst check = () => assert.equal(b, 2);",
      ),
    });
    return { root, entries: [{ item: 'W-1', branch: 'hitld/W-1-b' }] };
  }
  branch('hitld/W-1-b', {
    'src/b.js': 'export const b = 2;\n',
    'test/b.test.js': TEST(
      'b is 2',
      "import { b } from '../src/b.js';\nconst check = () => assert.equal(b, 2);",
    ),
    'gen/files.txt': 'a.js\nb.js\n',
  });
  branch('hitld/W-2-bad', { 'src/a.js': 'export const a = 2;\n' });
  branch('hitld/W-3-c', {
    'src/c.js': 'export const c = 3;\n',
    'test/c.test.js': TEST(
      'c is 3',
      "import { c } from '../src/c.js';\nconst check = () => assert.equal(c, 3);",
    ),
    'gen/files.txt': 'a.js\nc.js\n',
  });
  branch('hitld/W-4-b-again', { 'src/b.js': 'export const b = 20;\n' });
  return {
    root,
    entries: [
      { item: 'W-1', branch: 'hitld/W-1-b' },
      { item: 'W-2', branch: 'hitld/W-2-bad' },
      { item: 'W-3', branch: 'hitld/W-3-c', needs: [] },
      { item: 'W-4', branch: 'hitld/W-4-b-again' },
    ],
  };
}

/** The merge settings the fixture is built for. */
export const MERGE_SETTINGS = Object.freeze({
  mainBranch: 'main',
  batchMax: 4,
  fastChecks: ['node --check src/a.js'],
  fullSuite: ["node --test 'test/*.test.js'"],
  generated: [{ globs: ['gen/**'], regenerate: 'node gen.mjs' }],
  flakeReruns: 1,
});
