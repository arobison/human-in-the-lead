// HITLD-292 (GitHub issue #177): a project that sets the merge queue's checks but no
// env.worktree_setup passed every setup check, then the queue's fresh worktree could not run the
// checks, and the branch was refused as if its executor had broken it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { makeConsumer, put } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

/**
 * A repository with a policy.json and the given files, committed on main.
 * @param {Record<string, unknown>} policy @param {Record<string, string>} [files]
 */
function repo(policy, files = {}) {
  const root = realpathSync(tempDir('hitld-setup-gap-'));
  git(root, 'init', '-q', '-b', 'main');
  const all = {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'setup-gap', key: 'W' },
      ...policy,
    }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  return root;
}

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd,
    env: { PATH: process.env.PATH ?? '', XDG_DATA_HOME: join(cwd, '..', 'data') },
  });
  return { code, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
}

const CHECKS = { merge: { fast_checks: ['npx tsc --noEmit'], full_suite: ['npm test'] } };
const LOCK = { 'package-lock.json': '{ "lockfileVersion": 3, "packages": {} }\n' };

test('check policy warns when the queue has checks and env.worktree_setup is empty, naming the lockfile install', async () => {
  const root = repo(CHECKS, LOCK);
  const r = await hitld(['check', 'policy'], root);
  assert.equal(r.code, 0, 'a warning, not an error');
  assert.equal(r.result.ok, true);
  const warning = (r.result.warnings ?? []).find((/** @type {string} */ w) =>
    w.includes('env.worktree_setup'),
  );
  assert.ok(warning, JSON.stringify(r.result));
  assert.match(warning, /fresh worktree with nothing installed/);
  assert.match(warning, /package-lock\.json/);
  assert.match(warning, /"npm ci"/);
  assert.match(warning, /generated/);
});

test('check policy says nothing about the setup when it is set, when there are no checks, or when pull requests merge', async () => {
  for (const policy of [
    { ...CHECKS, env: { worktree_setup: ['npm ci'] } },
    {},
    { merge: { ...CHECKS.merge, via: 'pull-request' } },
  ]) {
    const r = await hitld(['check', 'policy'], repo(policy, LOCK));
    assert.equal(r.result.ok, true);
    assert.ok(
      !(r.result.warnings ?? []).some((/** @type {string} */ w) => w.includes('worktree_setup')),
      JSON.stringify({ policy, warnings: r.result.warnings }),
    );
  }
});

test('with no lockfile, the warning still names the gap, without a command to propose', async () => {
  const r = await hitld(['check', 'policy'], repo(CHECKS));
  const warning = (r.result.warnings ?? []).find((/** @type {string} */ w) =>
    w.includes('env.worktree_setup'),
  );
  assert.ok(warning, JSON.stringify(r.result));
  assert.doesNotMatch(warning, /lockfile|propose/);
});

test('config explain lists the gap among its warnings and in its text', async () => {
  const root = repo(CHECKS, LOCK);
  const json = await hitld(['config', 'explain', '--json'], root);
  assert.ok(
    json.result.warnings.some((/** @type {{ message: string }} */ w) =>
      w.message.includes('env.worktree_setup'),
    ),
    JSON.stringify(json.result.warnings),
  );
  const text = await hitld(['config', 'explain'], root);
  assert.match(text.result.text, /env\.worktree_setup/);
});

test('hitld install warns about a kept policy with checks and no worktree setup', async () => {
  const c = makeConsumer({
    policy: { merge: { mode: 'queue', full_suite: ['npm test'] } },
  });
  put(c.root, LOCK);
  const r = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.ok(
    r.result.warnings.some((/** @type {string} */ w) => w.includes('env.worktree_setup')),
    JSON.stringify(r.result.warnings),
  );
});

/** A branch W-1 off main in a repository whose full suite needs node_modules. */
function needsInstall(/** @type {Record<string, unknown>} */ policy = {}) {
  const root = repo(policy, {
    ...LOCK,
    '.gitignore': 'node_modules/\n',
    'check.sh': 'test -d node_modules\n',
  });
  git(root, 'switch', '-q', '-c', 'hitld/W-1');
  writeFileSync(join(root, 'a.txt'), 'a change\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'W-1: a change');
  git(root, 'switch', '-q', 'main');
  return root;
}

const queueSettings = (/** @type {string[]} */ setup) => ({
  mainBranch: 'main',
  batchMax: 4,
  fastChecks: ['sh check.sh'],
  fullSuite: ['sh check.sh'],
  generated: [],
  flakeReruns: 0,
  setup,
});

test('the merge queue stops before checking when its fresh worktree has nothing installed and there is no setup, and refuses no branch', async () => {
  const root = needsInstall();
  const before = git(root, 'rev-parse', 'main');
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-1', branch: 'hitld/W-1', dispatch: 'D-1' }],
    settings: queueSettings([]),
  });
  assert.deepEqual(result.rejected, [], 'the branch is not blamed');
  assert.equal(result.incident?.kind, 'setup');
  assert.match(String(result.incident?.message), /env\.worktree_setup/);
  assert.match(String(result.incident?.message), /node_modules/);
  assert.match(String(result.incident?.message), /"npm ci"/);
  assert.equal(git(root, 'rev-parse', 'main'), before, 'main did not move');
});

test('with a setup that installs, the same branch merges', async () => {
  const root = needsInstall();
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-1', branch: 'hitld/W-1', dispatch: 'D-1' }],
    settings: queueSettings(['mkdir node_modules']),
  });
  assert.equal(result.incident, null);
  assert.deepEqual(
    result.merged.map((/** @type {any} */ m) => m.item),
    ['W-1'],
  );
});

// HITLD-1054 (GitHub issue 667): the queue ran env.worktree_setup on main's tip and only then
// checked out the branch under test, so a branch that adds a package failed in the queue's
// worktree. The lockfile here lists the packages, one a line; the install makes a folder for each,
// and refuses one named "unpublished"; the check needs a folder for each.
const INSTALL = [
  'rm -rf node_modules && mkdir node_modules',
  'while read -r p; do',
  '  [ -n "$p" ] || continue',
  '  if [ "$p" = unpublished ]; then echo "404: $p is not in the registry" >&2; exit 1; fi',
  '  mkdir "node_modules/$p"',
  'done < package-lock.json',
  '',
].join('\n');
const NEEDS = [
  'while read -r p; do',
  '  [ -n "$p" ] || continue',
  '  test -d "node_modules/$p" || { echo "cannot find module $p" >&2; exit 1; }',
  'done < package-lock.json',
  '',
].join('\n');

/**
 * Main with one package installed by setup, and branches stacked on it, each with its files.
 * @param {[string, Record<string, string>][]} branches
 */
function withPackages(branches) {
  const root = repo(
    {},
    {
      '.gitignore': 'node_modules/\n',
      'package-lock.json': 'is-even\n',
      'install.sh': INSTALL,
      'check.sh': NEEDS,
    },
  );
  let from = 'main';
  for (const [id, files] of branches) {
    git(root, 'switch', '-q', '-c', `hitld/${id}`, from);
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', `${id}: a change`);
    from = `hitld/${id}`;
  }
  git(root, 'switch', '-q', 'main');
  return root;
}

/** @param {string} root @param {string[]} ids */
const queue = (root, ids) =>
  runMergeQueue({
    repoRoot: root,
    entries: ids.map((id, i) => ({ item: id, branch: `hitld/${id}`, dispatch: `D-${i + 1}` })),
    settings: queueSettings(['sh install.sh']),
  });

test('a branch that adds a package passes its checks in the queue: setup runs again on the branch, recorded as the batch', async () => {
  const root = withPackages([['W-1', { 'package-lock.json': 'is-even\nleft-pad\n' }]]);
  const result = await queue(root, ['W-1']);
  assert.equal(result.incident, null);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(
    result.merged.map((/** @type {any} */ m) => m.item),
    ['W-1'],
  );
  assert.deepEqual(
    result.setup.runs.map((x) => [x.kind, x.files]),
    [
      ['base', []],
      ['batch', ['package-lock.json']],
    ],
  );
  assert.equal(result.setup.runs[0].commit, result.main.before);
  assert.equal(result.setup.runs[1].commit, result.merged[0].commit);
});

test('setup is reused on a commit that changes no dependency file, and runs again only where one changes', async () => {
  const none = withPackages([['W-1', { 'a.txt': 'a\n' }]]);
  const plain = await queue(none, ['W-1']);
  assert.deepEqual(
    plain.merged.map((/** @type {any} */ m) => m.item),
    ['W-1'],
  );
  assert.deepEqual(
    plain.setup.runs.map((x) => x.kind),
    ['base'],
  );
  assert.ok(plain.setup.reused >= 1, 'the branch reused the base run');

  const mixed = withPackages([
    ['W-1', { 'a.txt': 'a\n' }],
    ['W-2', { 'package-lock.json': 'is-even\nleft-pad\n' }],
    ['W-3', { 'b.txt': 'b\n' }],
  ]);
  const r = await queue(mixed, ['W-1', 'W-2', 'W-3']);
  assert.equal(r.incident, null);
  assert.deepEqual(
    r.merged.map((/** @type {any} */ m) => m.item),
    ['W-1', 'W-2', 'W-3'],
  );
  assert.deepEqual(
    r.setup.runs.map((x) => [x.kind, x.files]),
    [
      ['base', []],
      ['batch', ['package-lock.json']],
    ],
    'one run for the base, one for the branch that changes the lockfile',
  );
});

test('a branch whose dependencies cannot be installed is sent back saying it changes them, not as a failing build', async () => {
  const root = withPackages([['W-1', { 'package-lock.json': 'is-even\nunpublished\n' }]]);
  const before = git(root, 'rev-parse', 'main');
  const result = await queue(root, ['W-1']);
  assert.equal(result.incident, null, 'not an incident: the branch is the cause');
  assert.deepEqual(result.merged, []);
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason, x.files, x.command]),
    [['W-1', 'setup', ['package-lock.json'], 'sh install.sh']],
  );
  const message = String(result.rejected[0].message);
  assert.match(message, /changes dependencies \(package-lock\.json\)/);
  assert.match(message, /not a failing build/);
  assert.match(String(result.rejected[0].output), /unpublished is not in the registry/);
  assert.equal(git(root, 'rev-parse', 'main'), before, 'main did not move');
});
