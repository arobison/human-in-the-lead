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
