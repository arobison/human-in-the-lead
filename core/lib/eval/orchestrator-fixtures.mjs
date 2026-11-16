// Synthetic repositories for piece (h)'s scenarios and tests (design part 17.2): a consumer with a
// tracker and a full suite, and a repository whose branches exercise the merge queue. Public,
// generated, nothing from a real project.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendEvent } from '../ledger/ledger.mjs';
import { writeSettingsFile } from '../settings/files.mjs';
import { openStore, privateStorePath } from '../store/store.mjs';

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

/**
 * Mark the first-run setup done for a sandbox home: empty (all-defaults) person and machine files.
 * Without them, autonomous dispatch waits (design part 13.4).
 * @param {NodeJS.ProcessEnv} env XDG_CONFIG_HOME and XDG_DATA_HOME of the sandbox
 */
export function writeSetupDone(env) {
  writeSettingsFile('person', { schema_version: 1 }, { env, cwd: tmpdir() });
  writeSettingsFile('machine', { schema_version: 1 }, { env, cwd: tmpdir() });
}

/**
 * Fake probe sources for `hitld machine detect`: a workstation with a desktop session, eight cores
 * and 16 GB, no GPU, one browser. Nothing is read from the machine the eval runs on.
 * @returns {import('../machine/detect.mjs').Sources}
 */
export function fakeWorkstation() {
  const files = /** @type {Record<string, string>} */ ({ '/usr/bin/firefox': '' });
  return {
    platform: 'linux',
    arch: 'x64',
    release: '6.1.0',
    cores: 8,
    memoryBytes: 16 * 1024 ** 3,
    env: { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', PATH: '/usr/bin' },
    readText: (p) => files[p] ?? null,
    exists: (p) => p in files,
    run: () => null,
  };
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
      optional_keys: ['touches', 'serial', 'tier_override', 'estimate_tokens'],
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
      state: 'planned',
      touches: ['src/calc.js'],
    }),
    'work/items/W-2-another-thing.md': itemFile({
      id: 'W-2',
      title: 'Another thing',
      kind: 'work',
      state: 'planned',
      touches: ['src/other.js'],
    }),
    'work/items/W-3-after-one.md': itemFile({
      id: 'W-3',
      title: 'After one',
      kind: 'work',
      state: 'planned',
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
 * With `flaky`, main carries a test that fails once, the first time it runs anywhere. With
 * `flaky: 'alternating'`, it fails on every other run, on main as on the branch: a flake that was
 * already there.
 * @param {string} root @param {{ flaky?: boolean | 'alternating', marker?: string }} [options]
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
            options.flaky === 'alternating'
              ? `import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nconst marker = ${JSON.stringify(options.marker ?? join(root, '..', 'flake-marker'))};\nconst check = () => { const n = (existsSync(marker) ? Number(readFileSync(marker, 'utf8')) : 0) + 1; writeFileSync(marker, String(n)); if (n % 2 === 1) assert.fail('odd run'); };`
              : `import { existsSync, writeFileSync } from 'node:fs';\nconst marker = ${JSON.stringify(options.marker ?? join(root, '..', 'flake-marker'))};\nconst check = () => { if (!existsSync(marker)) { writeFileSync(marker, 'x'); assert.fail('first run'); } };`,
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
  flake: { compareRuns: 3, compareRunsMax: 3, burnInRuns: 2, testGlobs: ['test/**'] },
});

/**
 * A consumer for the stale-item sweep (design part 13.3), committed on main, with one case of each
 * finding kind and one beside it that is not a finding:
 *   orphaned-claim         W-1 claimed by D-1 on hitld/W-1-claim, D-1 reported; W-2 claimed by
 *                          D-2, still in flight
 *   proposed-too-old       W-3 proposed on 2026-09-01; W-4 on 2026-11-10 (sweep.proposed_max_age 30)
 *   blockers-resolved      W-6 needs W-5, dropped; W-7 needs W-6, open
 *   merged-but-open        W-8 has a merged commit with its Work-Item and Dispatch trailers, and
 *                          W-10 a ledger merged event, both still planned; W-9 likewise, but done
 *   release-needs-overlap  W-11 (0.1.0) and W-13 (0.2.0) both need W-12
 *   missing-release-note   W-14 changed a schema with no release_note; W-15 did, with one
 * The ledger goes in the private store under dataHome (XDG_DATA_HOME). Judge it at 2026-11-16.
 * @param {string} root an absent or empty directory @param {string} dataHome
 * @returns {{ root: string, project: string, now: string }}
 */
export function buildSweepConsumer(root, dataHome) {
  const project = 'sweep-fixture';
  initRepo(root);
  /** @param {string} id @param {string} title @param {Record<string, string | string[]>} [extra] */
  const item = (id, title, extra = {}) => ({
    [`work/items/${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`]: itemFile({
      id,
      title,
      kind: 'work',
      state: 'planned',
      ...extra,
    }),
  });
  putFiles(root, {
    '.human-in-the-lead/policy.json': JSON.stringify(
      {
        schema_version: 1,
        project: { id: project, key: 'W' },
        sweep: { proposed_max_age: 30 },
      },
      null,
      2,
    ),
    '.human-in-the-lead/tracker.json': JSON.stringify({
      schema_version: 1,
      optional_keys: ['release_note'],
    }),
    'package.json': '{ "type": "module" }\n',
    ...item('W-1', 'Claimed then abandoned'),
    ...item('W-2', 'Claimed and running'),
    ...item('W-3', 'An old proposal', { state: 'proposed', created: '2026-09-01' }),
    ...item('W-4', 'A new proposal', { state: 'proposed', created: '2026-11-10' }),
    ...item('W-5', 'Given up', { state: 'dropped' }),
    ...item('W-6', 'Waits on what was given up', { needs: ['W-5'] }),
    ...item('W-7', 'Waits on open work', { needs: ['W-6'] }),
    ...item('W-8', 'Merged but left open'),
    ...item('W-9', 'Merged and closed', { state: 'done' }),
    ...item('W-10', 'Merged by the queue but left open'),
    ...item('W-11', 'Release 0.1.0', { release: '0.1.0', needs: ['W-9', 'W-12'] }),
    ...item('W-12', 'Shared by two releases'),
    ...item('W-13', 'Release 0.2.0', { release: '0.2.0', needs: ['W-12'] }),
    ...item('W-14', 'Changed a schema without a note', { state: 'done' }),
    ...item('W-15', 'Changed a schema with a note', {
      state: 'done',
      release_note: 'Adds a field to the thing schema',
    }),
  });
  commitAll(root, 'fixture');
  /** @param {string} subject @param {string} trailers @param {Record<string, string>} files */
  const commit = (subject, trailers, files) => {
    putFiles(root, files);
    fixtureGit(root, 'add', '-A');
    fixtureGit(root, 'commit', '-q', '-m', subject, '-m', trailers);
  };
  commit('Merged work (W-8)', 'Work-Item: W-8\nDispatch: D-3', { 'src/eight.js': 'export {};\n' });
  commit('Merged work (W-9)', 'Work-Item: W-9\nDispatch: D-4', { 'src/nine.js': 'export {};\n' });
  commit('A schema field (W-14)', 'Work-Item: W-14', {
    'schemas/thing.schema.json': '{ "$id": "thing", "type": "object" }\n',
  });
  commit('Another schema field (W-15)', 'Work-Item: W-15', {
    'schemas/other.schema.json': '{ "$id": "other", "type": "object" }\n',
  });
  // Claims live on branches: W-1 by D-1, which has reported; W-2 by D-2, still in flight.
  for (const [id, dispatch] of [
    ['W-1', 'D-1'],
    ['W-2', 'D-2'],
  ]) {
    const file = `work/items/${id}-claimed-${id === 'W-1' ? 'then-abandoned' : 'and-running'}.md`;
    fixtureGit(root, 'switch', '-q', '-c', `hitld/${id}-claim`);
    putFiles(root, {
      [file]: itemFile({
        id,
        title: id === 'W-1' ? 'Claimed then abandoned' : 'Claimed and running',
        kind: 'work',
        state: 'in-progress',
        claimed_by: dispatch,
      }),
    });
    fixtureGit(root, 'add', '-A');
    fixtureGit(
      root,
      'commit',
      '-q',
      '-m',
      `claim: ${id}`,
      '-m',
      `Work-Item: ${id}\nDispatch: ${dispatch}`,
    );
    fixtureGit(root, 'switch', '-q', 'main');
  }
  const store = openStore(privateStorePath(project, { env: { XDG_DATA_HOME: dataHome } }));
  const at = '2026-11-15T12:00:00.000Z';
  for (const e of [
    { event: 'dispatched', dispatch: 'D-1', item: 'W-1', branch: 'hitld/W-1-claim' },
    { event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'partial' },
    { event: 'dispatched', dispatch: 'D-2', item: 'W-2', branch: 'hitld/W-2-claim' },
    { event: 'merged', item: 'W-10' },
  ]) {
    appendEvent(store, { ...e, at });
  }
  return { root, project, now: '2026-11-16T12:00:00Z' };
}
