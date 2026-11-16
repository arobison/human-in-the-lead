// `hitld work publish` (HITLD-125): the tracker files a session changed reach main through one
// pull request, from a branch built on the remote's main, never main itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { addTerm } from '../lib/store/private-terms.mjs';
import { commitAll, git, isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';

const POLICY = JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } });

/**
 * A project repository with a remote holding its main branch, and a checkout on a session branch
 * of its own, as a cloud session has.
 */
function session() {
  const root = makeRepo({ files: { '.human-in-the-lead/policy.json': `${POLICY}\n` } });
  const remote = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-publish-remote-')));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'checkout', '-q', '-b', 'claude/session');
  return { root, remote, env: isolatedEnv() };
}

/** @param {string} cwd @param {string[]} argv @param {NodeJS.ProcessEnv} env */
async function run(cwd, argv, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, ...JSON.parse(out) };
}

/** @param {string[]} extra */
const publish = (...extra) => [
  'work',
  'publish',
  '--title',
  'the owner answers W-6 and W-7 asks which color',
  '--role',
  'orchestrator',
  ...extra,
];

const decision = (/** @type {string} */ id, /** @type {string} */ title, state = 'planned') =>
  itemText({ id, title, kind: 'decision', state, project: 'W-2', decider: 'owner' });

/** The branches on the remote. @param {string} remote */
const branches = (remote) =>
  git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
    .split('\n')
    .filter(Boolean);

test('a session with decisions filed and answered publishes them as one commit on a new branch from main', async () => {
  const { root, remote, env } = session();
  // Answered, and committed on the session branch.
  put(root, { 'work/items/W-6-which-way.md': decision('W-6', 'Which way?', 'done') });
  commitAll(root, 'answer W-6');
  // Filed, not committed; a view, and a file outside the tracker, changed too.
  put(root, {
    'work/items/W-7-which-color.md': decision('W-7', 'Which color?'),
    'work/views/ready.md': 'stale\n',
    'notes.txt': 'not tracker\n',
  });
  const head = git(root, 'rev-parse', 'HEAD');
  const status = git(root, 'status', '--porcelain');

  const r = await run(
    root,
    publish(
      '--body',
      'W-6 records the answer.',
      '--trailer',
      'Co-Authored-By: A <a@example.invalid>',
    ),
    env,
  );
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.published, true);
  assert.deepEqual(r.items, ['W-6', 'W-7']);
  assert.deepEqual(r.files, [
    { path: 'work/items/W-6-which-way.md', change: 'changed' },
    { path: 'work/items/W-7-which-color.md', change: 'added' },
  ]);
  assert.deepEqual(r.left_out, ['notes.txt', 'work/views/ready.md']);
  assert.match(r.branch, /^hitld\/tracker-W-6-[0-9a-f]{8}$/);
  assert.equal(r.opened, false);
  assert.equal(r.pull_request.head, r.branch);
  assert.equal(r.pull_request.base, 'main');
  assert.equal(r.pull_request.title, 'Tracker: the owner answers W-6 and W-7 asks which color');
  assert.match(r.pull_request.body, /^W-6 records the answer\.\n\nTracker files:/);

  // One commit on the remote's main, with the project's trailers, on the new branch only.
  assert.deepEqual(branches(remote).sort(), [r.branch, 'main'].sort());
  assert.equal(git(remote, 'rev-parse', `${r.branch}^`), git(remote, 'rev-parse', 'main'));
  assert.equal(git(remote, 'rev-parse', 'main').trim(), git(root, 'rev-parse', 'main').trim());
  const message = git(remote, 'log', '-1', '--format=%B', r.branch);
  assert.match(message, /^Tracker: the owner answers W-6/);
  assert.match(
    message,
    /\n\nWork-Item: W-6\nWork-Item: W-7\nAgent-Role: orchestrator\nCo-Authored-By: A <a@example.invalid>\n/,
  );
  assert.deepEqual(
    git(remote, 'diff', '--name-only', 'main', r.branch).split('\n').filter(Boolean),
    ['work/items/W-6-which-way.md', 'work/items/W-7-which-color.md'],
  );

  // The session's own checkout did not move.
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD').trim(), 'claude/session');
  assert.equal(git(root, 'status', '--porcelain'), status);

  // Publishing again before main moves pushes nothing new.
  const again = await run(root, publish(), env);
  assert.equal(again.ok, true);
  assert.equal(again.published, false);
  assert.equal(again.branch, r.branch);
  assert.deepEqual(branches(remote).sort(), [r.branch, 'main'].sort());

  // The pull request merges: main has every change, so there is nothing to publish.
  git(remote, 'update-ref', 'refs/heads/main', r.commit);
  const merged = await run(root, publish(), env);
  assert.equal(merged.ok, true);
  assert.equal(merged.published, false);
  assert.match(merged.message, /already has every tracker change/);

  // The same session then answers W-7: main's copy is the one it published, so it is published.
  put(root, { 'work/items/W-7-which-color.md': decision('W-7', 'Which color?', 'done') });
  const answered = await run(root, publish(), env);
  assert.equal(answered.published, true, JSON.stringify(answered));
  assert.deepEqual(answered.files, [{ path: 'work/items/W-7-which-color.md', change: 'changed' }]);
  assert.equal(git(remote, 'rev-parse', `${answered.branch}^`), git(remote, 'rev-parse', 'main'));
});

test('a session with nothing to publish says so and pushes nothing', async () => {
  const { root, remote, env } = session();
  put(root, { 'notes.txt': 'not tracker\n' });
  const r = await run(root, publish(), env);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.published, false);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.left_out, ['notes.txt']);
  assert.match(r.message, /nothing to publish: this session changed no tracker file/);
  assert.deepEqual(branches(remote), ['main']);
});

test('a design a walk-through decided is published with its decisions; a file outside docs/design is not', async () => {
  const { root, remote, env } = session();
  put(root, {
    'work/items/W-7-which-color.md': decision('W-7', 'Which color?', 'done'),
    'docs/design/0009-colors.md': '# 0009: Colors\n',
    'docs/other.md': 'not a design\n',
  });
  const r = await run(root, publish('--design', 'docs/design/0009-colors.md'), env);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.deepEqual(r.files, [
    { path: 'docs/design/0009-colors.md', change: 'added' },
    { path: 'work/items/W-7-which-color.md', change: 'added' },
  ]);
  assert.deepEqual(r.left_out, ['docs/other.md']);
  assert.deepEqual(
    git(remote, 'diff', '--name-only', 'main', r.branch).split('\n').filter(Boolean),
    ['docs/design/0009-colors.md', 'work/items/W-7-which-color.md'],
  );

  for (const given of ['docs/other.md', 'docs/design/../other.md', '../docs/design/x.md']) {
    const refused = await run(root, publish('--design', given), env);
    assert.equal(refused.error, 'usage', given);
  }
});

test('a private term in a would-be commit message or tracker file is refused before anything is pushed, never named', async () => {
  const { root, remote, env } = session();
  const term = 'orchid-fox-7';
  addTerm(openStore(privateStorePath('fixture', { env })), { term, kind: 'device' });
  put(root, { 'work/items/W-7-which-color.md': decision('W-7', 'Which color?') });

  const inMessage = await run(
    root,
    ['work', 'publish', '--title', `W-7 asks which color on ${term}`, '--role', 'chief-of-staff'],
    env,
  );
  assert.equal(inMessage.code, 1);
  assert.equal(inMessage.error, 'private-term');
  assert.equal(inMessage.step, 'commit-message');
  assert.match(inMessage.problems.join('\n'), /line 1: holds a private device/);
  assert.match(inMessage.message, /nothing was published/);
  assert.doesNotMatch(JSON.stringify(inMessage), new RegExp(term));

  const inBody = await run(root, publish('--body', `Asked from ${term}.`), env);
  assert.equal(inBody.error, 'private-term');
  assert.equal(inBody.step, 'commit-message');

  put(root, {
    'work/items/W-7-which-color.md': decision('W-7', 'Which color?', 'planned').replace(
      'Body.',
      `Seen on ${term}.`,
    ),
  });
  const inFile = await run(root, publish(), env);
  assert.equal(inFile.error, 'private-term', JSON.stringify(inFile));
  assert.equal(inFile.step, 'files');
  assert.deepEqual(
    inFile.refused.map((/** @type {{ path: string }} */ x) => x.path),
    ['work/items/W-7-which-color.md'],
  );
  assert.doesNotMatch(JSON.stringify(inFile), new RegExp(term));

  assert.deepEqual(branches(remote), ['main']);
});

test('executors are refused, main is never the branch, and a change main made unseen is not overwritten', async () => {
  const { root, remote, env } = session();
  put(root, { 'work/items/W-7-which-color.md': decision('W-7', 'Which color?') });

  for (const extra of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-4' }]) {
    const r = await run(root, publish(), { ...env, ...extra });
    assert.equal(r.error, 'not-permitted', JSON.stringify(extra));
  }
  const noRole = await run(root, ['work', 'publish', '--title', 'x'], env);
  assert.equal(noRole.error, 'usage');
  const ownTrailer = await run(root, publish('--trailer', 'Dispatch: D-4'), env);
  assert.equal(ownTrailer.error, 'usage');

  const toMain = await run(root, publish('--branch', 'main'), env);
  assert.equal(toMain.error, 'not-permitted');
  assert.deepEqual(branches(remote), ['main']);

  // Someone else changes W-6 on main; this session changes it too, without having seen that.
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-publish-other-')));
  git(other, 'clone', '-q', remote, '.');
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.invalid');
  writeFileSync(join(other, 'work/items/W-6-which-way.md'), decision('W-6', 'Which way now?'));
  commitAll(other, 'retitle W-6');
  git(other, 'push', '-q', 'origin', 'main');
  rmSync(other, { recursive: true, force: true });

  put(root, { 'work/items/W-6-which-way.md': decision('W-6', 'Which way?', 'done') });
  const r = await run(root, publish(), env);
  assert.equal(r.error, 'main-changed', JSON.stringify(r));
  assert.deepEqual(r.conflicts, ['work/items/W-6-which-way.md']);
  assert.deepEqual(branches(remote), ['main']);

  // Brought into the branch, the change is publishable.
  git(root, 'stash', '-q', '--include-untracked');
  git(root, 'merge', '-q', '--no-edit', 'origin/main');
  git(root, 'stash', 'pop', '-q');
  put(root, { 'work/items/W-6-which-way.md': decision('W-6', 'Which way now?', 'done') });
  const after = await run(root, publish('--dry-run'), env);
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.published, false);
  assert.equal(after.dry_run, true);
  assert.deepEqual(after.items, ['W-6', 'W-7']);
  assert.deepEqual(branches(remote), ['main'], 'a dry run pushes nothing');
});
