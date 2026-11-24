// HITLD-976: a pnpm workspace (a pnpm-workspace.yaml, a pnpm-lock.yaml, two packages) goes
// through HITLd end to end: install proposes its setup and checks, env setup runs the setup in a
// fresh worktree, the new-dependency trigger fires on its manifests, and each package is released
// with its own version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { proposeSetup, pnpmWorkspaceGlobs, workspacePackages } from '../lib/env/setup-gap.mjs';
import { evidenceFor } from '../lib/merge/owner.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { MERGE_SETTINGS } from '../lib/eval/orchestrator-fixtures.mjs';
import { makeConsumer } from './orchestrator-fixture.mjs';
import { commitAll, git, makeRepo, put } from './tracker-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));

/** A pnpm-lock.yaml for a workspace of two packages with no outside dependencies. */
const LOCK = [
  "lockfileVersion: '9.0'",
  '',
  'settings:',
  '  autoInstallPeers: true',
  '  excludeLinksFromLockfile: false',
  '',
  'importers:',
  '',
  '  .: {}',
  '',
  '  packages/a: {}',
  '',
  '  packages/b: {}',
  '',
].join('\n');

/** The workspace: a root, two packages, each with its own version and scripts. */
const WORKSPACE = {
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/scratch'\n",
  'pnpm-lock.yaml': LOCK,
  'package.json': '{ "name": "ws", "private": true, "type": "module" }\n',
  'packages/a/package.json': JSON.stringify(
    {
      name: '@ws/a',
      version: '0.1.0',
      scripts: { test: 'node --test', lint: 'node lint.js' },
    },
    null,
    2,
  ),
  'packages/a/index.js': 'export const a = 1;\n',
  'packages/b/package.json': JSON.stringify(
    {
      name: '@ws/b',
      version: '0.3.0',
      scripts: { test: 'node --test', typecheck: 'tsc --noEmit' },
    },
    null,
    2,
  ),
  'packages/b/index.js': 'export const b = 2;\n',
  'packages/scratch/package.json': '{ "name": "scratch", "scripts": { "test": "exit 1" } }\n',
};

test('pnpm-workspace.yaml: the packages list is read, quotes and comments removed, other keys ignored', () => {
  const text = [
    '# the workspace',
    'packages:',
    "  - 'packages/*'   # libraries",
    '  - "apps/**"',
    '  - tools/cli',
    "  - '!**/test/**'",
    'catalog:',
    '  react: ^18.3.1',
    '  - not-a-package',
    '',
  ].join('\n');
  assert.deepEqual(pnpmWorkspaceGlobs(text), ['packages/*', 'apps/**', 'tools/cli', '!**/test/**']);
  assert.equal(pnpmWorkspaceGlobs('catalog:\n  a: 1\n'), null, 'no packages key');
});

test('pnpm-workspace.yaml: a zero-indent sequence is read', () => {
  assert.deepEqual(pnpmWorkspaceGlobs('packages:\n- a/*\n- b\n'), ['a/*', 'b']);
  assert.deepEqual(pnpmWorkspaceGlobs('packages:\n- a/*\ncatalog:\n  x: 1\n- c\n'), ['a/*']);
});

test('pnpm-workspace.yaml: a flow sequence is read, on one line or several', () => {
  assert.deepEqual(pnpmWorkspaceGlobs("packages: ['a/*', 'b']\n"), ['a/*', 'b']);
  assert.deepEqual(pnpmWorkspaceGlobs('packages: [ "a/*",\n  b, # the b one\n  \'c, d\' ]\n'), [
    'a/*',
    'b',
    'c, d',
  ]);
  assert.deepEqual(pnpmWorkspaceGlobs('packages: []\n'), []);
});

test('pnpm-workspace.yaml: a leading byte-order mark is allowed', () => {
  assert.deepEqual(pnpmWorkspaceGlobs("\uFEFFpackages:\n  - 'packages/*'\n"), ['packages/*']);
});

test('pnpm-workspace.yaml: a quoted packages key is read', () => {
  assert.deepEqual(pnpmWorkspaceGlobs("'packages':\n  - a/*\n"), ['a/*']);
  assert.deepEqual(pnpmWorkspaceGlobs('"packages": [b]\n'), ['b']);
});

test('pnpm-workspace.yaml: a " #" inside quotes is kept; a comment outside quotes is removed', () => {
  assert.deepEqual(
    pnpmWorkspaceGlobs(
      'packages:\n  - "c #d"\n  - \'e #f\'  # a comment\n  - g # another\n  - h#i\n',
    ),
    ['c #d', 'e #f', 'g', 'h#i'],
  );
});

test('pnpm-workspace.yaml: CRLF line ends are read like LF', () => {
  assert.deepEqual(
    pnpmWorkspaceGlobs("packages:\r\n  - 'a/*'\r\n  - b\r\ncatalog:\r\n  x: 1\r\n"),
    ['a/*', 'b'],
  );
});

test('pnpm-workspace.yaml: an empty file has no packages key, and an empty key no packages', () => {
  assert.equal(pnpmWorkspaceGlobs(''), null);
  assert.equal(pnpmWorkspaceGlobs('\uFEFF\n# nothing\n'), null);
  assert.deepEqual(pnpmWorkspaceGlobs('packages:\n'), []);
});

/** @param {Record<string, string>} files */
function scratch(files) {
  const root = tempDir('hitld-pnpm-ws-');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('no packages key: pnpm reads the root alone, and the proposal says plainly that no package was found', () => {
  const root = scratch({ ...WORKSPACE, 'pnpm-workspace.yaml': 'catalog:\n  react: ^18.3.1\n' });
  const p = /** @type {NonNullable<ReturnType<typeof proposeSetup>>} */ (proposeSetup(root));
  assert.deepEqual(p.packages, []);
  assert.deepEqual(p.full_suite, []);
  assert.deepEqual(p.worktree_setup, ['pnpm install --frozen-lockfile']);
  assert.equal(p.notes.length, 1);
  assert.match(p.notes[0], /no packages key, so pnpm reads the root project alone/);
  assert.match(p.notes[0], /no workspace package was found/);
});

test('a workspace whose globs match no package says so, instead of an empty list without a word', () => {
  for (const yaml of ['packages:\n  - nowhere/*\n', 'packages: []\n']) {
    const root = scratch({ ...WORKSPACE, 'pnpm-workspace.yaml': yaml });
    const p = /** @type {NonNullable<ReturnType<typeof proposeSetup>>} */ (proposeSetup(root));
    assert.deepEqual(p.packages, []);
    assert.deepEqual(p.full_suite, []);
    assert.equal(p.notes.length, 1, yaml);
    assert.match(p.notes[0], /pnpm-workspace\.yaml declares a workspace, but no folder/);
  }
});

test('an npm workspace: package.json workspaces are read and its checks run in each package', () => {
  const root = scratch({
    'package-lock.json': '{ "lockfileVersion": 3, "packages": {} }\n',
    'package.json': JSON.stringify({ name: 'ws', private: true, workspaces: ['packages/*'] }),
    'packages/a/package.json': WORKSPACE['packages/a/package.json'],
    'packages/b/package.json': WORKSPACE['packages/b/package.json'],
  });
  assert.deepEqual(proposeSetup(root), {
    lockfile: 'package-lock.json',
    worktree_setup: ['npm ci'],
    full_suite: ['npm run test --workspaces --if-present'],
    fast_checks: [
      'npm run lint --workspaces --if-present',
      'npm run typecheck --workspaces --if-present',
    ],
    packages: ['packages/a', 'packages/b'],
    sources: [
      'packages/a/package.json: scripts.lint',
      'packages/b/package.json: scripts.typecheck',
      'packages/a/package.json: scripts.test',
      'packages/b/package.json: scripts.test',
    ],
    notes: [],
  });
});

test('the workspace packages are the folders with a package.json that the globs match, less the "!" ones', () => {
  const root = tempDir('hitld-pnpm-ws-');
  for (const [path, text] of Object.entries(WORKSPACE)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'packages', 'a', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(root, 'packages', 'a', 'node_modules', 'dep', 'package.json'), '{}');
  mkdirSync(join(root, 'packages', 'empty'));
  assert.deepEqual(
    workspacePackages(root, pnpmWorkspaceGlobs(WORKSPACE['pnpm-workspace.yaml']) ?? []),
    ['packages/a', 'packages/b'],
  );
  const proposal = proposeSetup(root);
  assert.deepEqual(proposal, {
    lockfile: 'pnpm-lock.yaml',
    worktree_setup: ['pnpm install --frozen-lockfile'],
    full_suite: ['pnpm -r --if-present run test'],
    fast_checks: ['pnpm -r --if-present run lint', 'pnpm -r --if-present run typecheck'],
    packages: ['packages/a', 'packages/b'],
    sources: [
      'packages/a/package.json: scripts.lint',
      'packages/b/package.json: scripts.typecheck',
      'packages/a/package.json: scripts.test',
      'packages/b/package.json: scripts.test',
    ],
    notes: [],
  });
  // A root script runs at the root, and a check script is the whole suite.
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'ws', scripts: { check: 'pnpm -r run lint && pnpm -r test' } }),
  );
  const rooted = /** @type {NonNullable<ReturnType<typeof proposeSetup>>} */ (proposeSetup(root));
  assert.deepEqual(rooted.full_suite, ['pnpm run check']);
  assert.deepEqual(rooted.fast_checks, [
    'pnpm -r --if-present run lint',
    'pnpm -r --if-present run typecheck',
  ]);
  assert.equal(rooted.sources[0], 'package.json: scripts.check');
});

test('hitld install on a pnpm workspace proposes pnpm install --frozen-lockfile and the checks its packages declare', async () => {
  const c = makeConsumer({ files: WORKSPACE });
  const r = await c.hitld(['install', '--key', 'W', '--marketplace', CHECKOUT]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.deepEqual(r.result.proposed.worktree_setup, ['pnpm install --frozen-lockfile']);
  assert.deepEqual(r.result.proposed.full_suite, ['pnpm -r --if-present run test']);
  assert.deepEqual(r.result.proposed.fast_checks, [
    'pnpm -r --if-present run lint',
    'pnpm -r --if-present run typecheck',
  ]);
  assert.deepEqual(r.result.proposed.packages, ['packages/a', 'packages/b']);
  // The queue has a suite and no setup: the warning names the pnpm install too.
  assert.ok(
    r.result.warnings.some((/** @type {string} */ w) =>
      w.includes('pnpm-lock.yaml is here: propose "pnpm install --frozen-lockfile"'),
    ),
    JSON.stringify(r.result.warnings),
  );
  // A proposal only: the policy is not changed.
  const policy = JSON.parse(readFileSync(join(c.root, '.human-in-the-lead/policy.json'), 'utf8'));
  assert.equal(policy.env?.worktree_setup, undefined);
});

test('hitld env setup runs pnpm install --frozen-lockfile in a fresh worktree of the workspace', async () => {
  const c = makeConsumer({
    policy: { env: { worktree_setup: ['pnpm install --frozen-lockfile'] } },
    files: { ...WORKSPACE, '.gitignore': 'node_modules/\npnpm-ran.txt\n' },
  });
  // A stand-in pnpm on PATH: it records where and how it ran and makes node_modules, as the real
  // one does, without reaching a registry.
  const bin = join(c.base, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'pnpm'),
    '#!/bin/sh\nprintf "%s\\n" "$*" > pnpm-ran.txt\ntest -f pnpm-lock.yaml || exit 9\nmkdir -p node_modules\n',
  );
  chmodSync(join(bin, 'pnpm'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const r = await c.hitld(['env', 'setup', '--dispatch', 'D-1', '--item', 'W-1'], { env });
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.setup.ok, true, JSON.stringify(r.result.setup));
  const wt = r.result.path;
  assert.notEqual(wt, c.root, 'a fresh worktree, not the checkout');
  assert.equal(readFileSync(join(wt, 'pnpm-ran.txt'), 'utf8'), 'install --frozen-lockfile\n');
  assert.ok(existsSync(join(wt, 'node_modules')));
  assert.equal(existsSync(join(c.root, 'node_modules')), false);
});

test('the new-dependency trigger fires when a branch changes pnpm-lock.yaml, a package’s package.json or pnpm-workspace.yaml', () => {
  const root = makeRepo({ files: WORKSPACE });
  const parent = git(root, 'rev-parse', 'HEAD').trim();
  const { policy } = resolvePolicy({ schema_version: 1, project: { id: 'ws', key: 'W' } });
  /** @param {string[]} changed */
  const reads = (changed) =>
    evidenceFor({
      repoRoot: root,
      tested: { item: 'W-3', branch: 'b', commit: parent, parent, changed },
      branchSha: parent,
      touches: ['**'],
      settings: { ...MERGE_SETTINGS, generated: [] },
      policy: /** @type {any} */ (policy),
    }).reads.filter((r) => r.trigger === 'new dependency');
  for (const file of ['pnpm-lock.yaml', 'packages/a/package.json', 'pnpm-workspace.yaml']) {
    const fired = reads([file, 'packages/a/index.js']);
    assert.equal(fired.length, 1, file);
    assert.deepEqual(fired[0].files, [file]);
  }
  assert.deepEqual(reads(['packages/a/index.js']), [], 'a source change is no new dependency');
});

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
  return { code, json: JSON.parse(out) };
}

test('release propose and release make cut each workspace package with its own version from its package.json', async () => {
  const pkg = (/** @type {string} */ name) => ({
    name,
    paths: [`packages/${name}/**`],
    surface: `packages/${name}/surface.txt`,
    version_source: `packages/${name}/package.json`,
  });
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'ws', key: 'W' },
        release: { packages: [pkg('a'), pkg('b')] },
      }),
      ...WORKSPACE,
      'packages/a/surface.txt': 'fn a\n',
      'packages/b/surface.txt': 'fn b\n',
    },
    commit: false,
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'workspace');

  const a = await hitld(['release', 'propose', '--package', 'a'], root);
  assert.equal(a.code, 0, JSON.stringify(a.json));
  assert.equal(a.json.version, '0.1.0');
  assert.equal(a.json.tag, 'a@0.1.0');
  assert.equal(a.json.releases[0].package_version, '0.1.0', 'read from packages/a/package.json');
  assert.ok(!a.json.warnings.some((/** @type {string} */ w) => w.includes('package.json says')));
  const b = await hitld(['release', 'propose', '--package', 'b'], root);
  assert.equal(b.json.releases[0].package_version, '0.3.0', 'b keeps its own version');
  assert.ok(
    b.json.warnings.includes(
      'packages/b/package.json says 0.3.0; set it to 0.1.0 before b is released',
    ),
    JSON.stringify(b.json.warnings),
  );

  const madeA = await hitld(['release', 'make', '--package', 'a'], root);
  assert.equal(madeA.code, 0, JSON.stringify(madeA.json));
  assert.equal(madeA.json.tag, 'a@0.1.0');
  assert.equal(madeA.json.record, 'work/releases/a/0.1.0.md');
  const madeB = await hitld(['release', 'make', '--package', 'b', '--version', '0.3.0'], root);
  assert.equal(madeB.code, 0, JSON.stringify(madeB.json));
  assert.equal(madeB.json.tag, 'b@0.3.0');
  assert.deepEqual(git(root, 'tag', '--list').trim().split('\n').sort(), ['a@0.1.0', 'b@0.3.0']);

  // b grows its surface and bumps its package.json; a is untouched and proposes nothing new of b's.
  put(root, {
    'packages/b/surface.txt': 'fn b\nfn b2\n',
    'packages/b/package.json': WORKSPACE['packages/b/package.json'].replace('0.3.0', '0.4.0'),
  });
  commitAll(root, 'b grows');
  const next = await hitld(['release', 'propose', '--package', 'b'], root);
  assert.equal(next.json.base, 'b@0.3.0');
  assert.equal(next.json.version, '0.4.0');
  assert.equal(next.json.releases[0].package_version, '0.4.0');
  assert.deepEqual((await hitld(['work', 'check'], root)).json.problems, []);
});
