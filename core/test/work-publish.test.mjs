// `hitld work publish` (HITLD-125): the tracker files a session changed reach main through one
// pull request, from a branch built on the remote's main, never main itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, main } from '../lib/cli/main.mjs';
import { item, makeConsumer } from './orchestrator-fixture.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { addTerm } from '../lib/store/private-terms.mjs';
import { commitAll, git, isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const POLICY = JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } });

/**
 * A project repository with a remote holding its main branch, and a checkout on a session branch
 * of its own, as a cloud session has.
 */
function session() {
  const root = makeRepo({ files: { '.human-in-the-lead/policy.json': `${POLICY}\n` } });
  const remote = realpathSync(tempDir('hitld-publish-remote-'));
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
  assert.deepEqual(r.working_tree, { branch: 'claude/session', action: 'left', staged: [] });

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

/** The blob at <rev>:<path> in a repository. @param {string} repo @param {string} rev @param {string} path */
const blobOf = (repo, rev, path) => git(repo, 'rev-parse', `${rev}:${path}`).trim();

/** A checkout on main with a remote, as a self-hosted session has. */
function onMain() {
  const s = session();
  git(s.root, 'checkout', '-q', 'main');
  return s;
}

/** git status, untracked files one by one. @param {string} root */
const status = (root) => git(root, 'status', '--porcelain', '--untracked-files=all');

/** Merge a pushed branch on the remote as the forge's squash does. @param {string} remote @param {string} branch */
function squashMerge(remote, branch) {
  const tree = git(remote, 'rev-parse', `${branch}^{tree}`).trim();
  const commit = git(
    remote,
    '-c',
    'user.name=Forge',
    '-c',
    'user.email=forge@example.invalid',
    'commit-tree',
    tree,
    '-p',
    'main',
    '-m',
    'squash',
  ).trim();
  git(remote, 'update-ref', 'refs/heads/main', commit);
  return commit;
}

test('publishing from main stages the published files, touches no working copy, and a later pull fast-forwards', async () => {
  const { root, remote, env } = onMain();
  // Two decisions filed (new files), one answered (a changed file), and a file outside the tracker.
  const files = {
    'work/items/W-6-which-way.md': decision('W-6', 'Which way?', 'done'),
    'work/items/W-7-which-color.md': decision('W-7', 'Which color?'),
    'work/items/W-8-which-size.md': decision('W-8', 'Which size?'),
  };
  put(root, { ...files, 'notes.txt': 'not tracker\n' });

  const r = await run(root, publish(), env);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.published, true);
  assert.deepEqual(r.working_tree, {
    branch: 'main',
    action: 'staged',
    staged: Object.keys(files),
  });
  assert.match(r.message, /staged as tracked changes/);
  assert.match(r.message, /git pull --ff-only origin main/);
  // Staged with exactly what was pushed; the working copies, and the file outside, untouched.
  assert.equal(
    status(root),
    'M  work/items/W-6-which-way.md\nA  work/items/W-7-which-color.md\nA  work/items/W-8-which-size.md\n?? notes.txt\n',
  );
  for (const [path, text] of Object.entries(files)) {
    assert.equal(readFileSync(join(root, path), 'utf8'), text);
  }
  const show = await run(root, ['work', 'show', 'W-7', '--json'], env);
  assert.equal(show.entity?.state, 'planned', JSON.stringify(show));

  // Run again before the merge: nothing new, the same pull request printed again, still staged.
  const again = await run(root, publish(), env);
  assert.equal(again.published, false);
  assert.equal(again.branch, r.branch);
  assert.deepEqual(again.pull_request, r.pull_request);
  assert.equal(again.working_tree.action, 'staged');
  assert.match(again.message, /already pushed/);

  // The pull request merges, and main is pulled: the staged copies are absorbed.
  rmSync(join(root, 'notes.txt'));
  const merged = squashMerge(remote, r.branch);
  git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), merged);
  assert.equal(status(root), '');
  const after = await run(root, publish(), env);
  assert.equal(after.published, false);
  assert.match(after.message, /changed no tracker file/);
});

test('on main, a decision asked and published can still be answered before the merge', async () => {
  const c = makeConsumer({
    files: {
      'work/projects/W-7-dependencies.md': item(
        { id: 'W-7', title: 'Dependencies', kind: 'project', state: 'planned', owner: 'owner' },
        '\n## Summary\n\n',
      ),
    },
  });
  const remote = realpathSync(tempDir('hitld-publish-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(c.root, 'remote', 'add', 'origin', remote);
  git(c.root, 'push', '-q', 'origin', 'main');
  const question = {
    title: 'Which color?',
    question: 'Which color should the badge be?',
    context: 'The badge has no color yet.',
    options: [
      { label: 'Blue', what_happens: 'the badge is blue' },
      { label: 'Green', what_happens: 'the badge is green' },
    ],
    recommendation: { option: 'A', why: 'It matches the rest.' },
    triggers: [{ basis: 'public-commitment', reason: 'it is visible' }],
    tags: ['badge'],
    item_kind: 'work',
    classification: 'public',
    parent: 'W-7',
  };
  const asked = await c.hitld(['rights', 'ask', '--question', JSON.stringify(question)]);
  assert.equal(asked.result.outcome, 'asked', JSON.stringify(asked.result));
  const id = asked.result.decision;
  const published = await c.hitld(publish());
  assert.equal(published.result.published, true, JSON.stringify(published.result));
  assert.equal(published.result.working_tree.action, 'staged');

  const shown = await c.hitld(['work', 'show', id, '--json']);
  assert.equal(shown.result.entity?.state, 'planned', JSON.stringify(shown.result));
  const answered = await c.hitld(['rights', 'answer', id, '--answer', 'A']);
  assert.equal(answered.exit, EXIT.ok, JSON.stringify(answered.result));
  assert.equal((await c.hitld(['work', 'show', id, '--json'])).result.entity.state, 'done');
  // The answer is published on a branch of its own.
  const answer = await c.hitld(publish());
  assert.equal(answer.result.published, true, JSON.stringify(answer.result));
  assert.notEqual(answer.result.branch, published.result.branch);
});

test('on main, an item published at v1 and edited to v2 keeps v2; staging v2 stops the pull until it is settled', async () => {
  const { root, remote, env } = onMain();
  const path = 'work/items/W-7-which-color.md';
  put(root, { [path]: decision('W-7', 'Which color?') });
  const r = await run(root, publish(), env);
  assert.equal(r.working_tree.action, 'staged');

  const v2 = decision('W-7', 'Which color, now?');
  put(root, { [path]: v2 });
  assert.equal(status(root), `AM ${path}\n`);
  assert.equal(readFileSync(join(root, path), 'utf8'), v2);
  const show = await run(root, ['work', 'show', 'W-7', '--json'], env);
  assert.equal(show.entity?.title, 'Which color, now?', JSON.stringify(show));

  // Staged, v2 differs from what the merge brings: the pull stops, and nothing is lost.
  git(root, 'add', '--', path);
  squashMerge(remote, r.branch);
  assert.throws(() => git(root, 'pull', '-q', '--ff-only', 'origin', 'main'));
  assert.equal(readFileSync(join(root, path), 'utf8'), v2);
  // With the pushed copy staged again (the edit stays in the working tree), the pull goes through.
  git(root, 'update-index', '--cacheinfo', `100644,${blobOf(remote, r.branch, path)},${path}`);
  git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
  assert.equal(status(root), ` M ${path}\n`);
  assert.equal(readFileSync(join(root, path), 'utf8'), v2);
});

test('on main, odd names, a design, a removal and a CRLF copy are staged exactly as pushed', async () => {
  const { root, remote, env } = onMain();
  git(root, 'config', 'core.autocrlf', 'true');
  const odd = 'work/items/W-9-a b*[c]?.md';
  put(root, {
    [odd]: decision('W-9', 'Odd?'),
    'work/items/W-10-crlf.md': decision('W-10', 'Line ends?').replaceAll('\n', '\r\n'),
    'docs/design/0009-colors.md': '# 0009: Colors\n',
  });
  rmSync(join(root, 'work/items/W-5-third-step.md'));
  const r = await run(root, publish('--design', 'docs/design/0009-colors.md'), env);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.deepEqual(r.working_tree.staged, [
    'docs/design/0009-colors.md',
    'work/items/W-10-crlf.md',
    'work/items/W-5-third-step.md',
    odd,
  ]);
  // Every staged entry is the pushed blob, and nothing in the working tree differs from it.
  for (const path of r.working_tree.staged.filter(
    (/** @type {string} */ p) => !p.includes('W-5'),
  )) {
    assert.equal(git(root, 'rev-parse', `:${path}`).trim(), blobOf(remote, r.branch, path), path);
  }
  assert.equal(git(root, 'diff', '--name-only'), '');
  assert.equal(
    git(root, 'diff', '--cached', '--name-status', '--', 'work/items/W-5-third-step.md'),
    'D\twork/items/W-5-third-step.md\n',
  );
  assert.ok(readFileSync(join(root, 'work/items/W-10-crlf.md'), 'utf8').includes('\r\n'));

  squashMerge(remote, r.branch);
  git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
  assert.equal(status(root), '');
});

test('off main and on a detached HEAD nothing is staged; a staging failure keeps the push and the pull request', async () => {
  const { root, env } = onMain();
  git(root, 'checkout', '-q', '--detach');
  put(root, { 'work/items/W-7-which-color.md': decision('W-7', 'Which color?') });
  const detached = await run(root, publish(), env);
  assert.equal(detached.published, true, JSON.stringify(detached));
  assert.deepEqual(detached.working_tree, { branch: null, action: 'left', staged: [] });
  assert.equal(status(root), '?? work/items/W-7-which-color.md\n');

  git(root, 'checkout', '-q', 'main');
  put(root, { 'work/items/W-8-which-size.md': decision('W-8', 'Which size?') });
  const lock = join(root, '.git', 'index.lock');
  writeFileSync(lock, '');
  try {
    const r = await run(root, publish('--branch', 'hitld/tracker-locked'), env);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.published, true);
    assert.equal(r.branch, 'hitld/tracker-locked');
    assert.equal(r.pull_request.head, 'hitld/tracker-locked');
    assert.equal(r.working_tree.action, 'failed');
    assert.match(r.working_tree.error, /git update-index failed: .*index\.lock/s);
    assert.match(r.message, /the push stands/);
    assert.doesNotMatch(r.message, /\n|Another git process/);
  } finally {
    rmSync(lock, { force: true });
  }
});

test('on main, copies the remote already has are not staged, and the message says how to update', async () => {
  const { root, remote, env } = onMain();
  const path = 'work/items/W-7-which-color.md';
  const other = realpathSync(tempDir('hitld-publish-other-'));
  git(other, 'clone', '-q', remote, '.');
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.invalid');
  writeFileSync(join(other, path), decision('W-7', 'Which color?'));
  commitAll(other, 'file W-7');
  git(other, 'push', '-q', 'origin', 'main');
  rmSync(other, { recursive: true, force: true });

  put(root, { [path]: decision('W-7', 'Which color?') });
  const r = await run(root, publish(), env);
  assert.equal(r.published, false, JSON.stringify(r));
  assert.deepEqual(r.skipped, [path]);
  assert.match(r.message, /nothing was staged\. To update, stage the files listed under skipped/);
  assert.equal(status(root), `?? ${path}\n`);
  git(root, 'add', '--', path);
  git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
  assert.equal(status(root), '');
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

test('with no private term list here, work publish says the list was not checked; with one, it does not', async () => {
  const { root, remote, env } = session();
  put(root, { 'work/items/W-7-which-color.md': decision('W-7', 'Which color?') });
  const bare = await run(root, publish('--dry-run'), env);
  assert.equal(bare.code, 0, JSON.stringify(bare));
  assert.equal(bare.list_found, false);
  // One warning, though the message, the text and the files were each checked against no list.
  assert.equal(bare.warnings.length, 1, JSON.stringify(bare.warnings));
  assert.match(
    bare.warnings[0],
    /^the private term list was not checked: there is no private store here/,
  );
  addTerm(openStore(privateStorePath('fixture', { env })), {
    term: 'orchid-fox-7',
    kind: 'device',
  });
  const listed = await run(root, publish('--dry-run'), env);
  assert.equal(listed.code, 0, JSON.stringify(listed));
  assert.equal(listed.list_found, true);
  assert.equal(listed.warnings, undefined);
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
  const other = realpathSync(tempDir('hitld-publish-other-'));
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
