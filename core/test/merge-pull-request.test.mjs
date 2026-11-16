// The merge queue through pull requests (merge.via pull-request), against a fake GitHub API whose
// repository is a bare git remote: green, a red check, a check that never completes, a conflict on
// update, and the owner's sign-off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fakeGitHub, repoFromRemote } from '../lib/merge/github.mjs';
import {
  approvePulls,
  emptyPullState,
  pullRequestWaits,
  runPullRequestQueue,
  squashMessage,
  validSignoff,
} from '../lib/merge/pull-request.mjs';
import { tempDir } from './helpers/tmp.mjs';

const ID = {
  GIT_AUTHOR_NAME: 'Agent',
  GIT_AUTHOR_EMAIL: 'agent@example.com',
  GIT_COMMITTER_NAME: 'Agent',
  GIT_COMMITTER_EMAIL: 'agent@example.com',
};

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...ID },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** @param {string} root @param {Record<string, string>} files */
function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** @param {string} id @param {string} state */
const itemText = (id, state) =>
  `---\nid: ${id}\ntitle: Item ${id}\nkind: work\nstate: ${state}\n---\n\n## Done when\n\n- ${id} works.\n`;

/** The item as a checked-out tree holds it, read the simple way. @param {string} dir @param {string} id */
function itemAt(dir, id) {
  try {
    const text = readFileSync(join(dir, `work/items/${id}.md`), 'utf8');
    return {
      state: /^state: (.*)$/m.exec(text)?.[1] ?? null,
      title: /^title: (.*)$/m.exec(text)?.[1] ?? id,
      release_note: null,
      body: text.split('---').slice(2).join('---'),
    };
  } catch {
    return null;
  }
}

/**
 * A clone of a bare remote standing in for GitHub, with W-1 to W-3 planned on main.
 * The clone has a git identity, as an orchestrator's checkout does, unless `identity` is false:
 * the queue's own commits (main merged in, rebuilt files) are made with it.
 * @param {{ checks?: Record<string, import('../lib/merge/github.mjs').Check[]>, identity?: boolean }} [o]
 */
function setup(o = {}) {
  const base = realpathSync(tempDir('hitld-pr-'));
  const remote = join(base, 'remote.git');
  const root = join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'clone', '-q', remote, root);
  git(root, 'checkout', '-q', '-b', 'main');
  if (o.identity !== false) {
    git(root, 'config', 'user.name', 'Orchestrator');
    git(root, 'config', 'user.email', 'orchestrator@example.com');
  }
  put(root, {
    'shared.txt': 'one\n',
    'work/items/W-1.md': itemText('W-1', 'planned'),
    'work/items/W-2.md': itemText('W-2', 'planned'),
    'work/items/W-3.md': itemText('W-3', 'planned'),
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  git(root, 'push', '-q', 'origin', 'main');
  /** @type {Record<string, import('../lib/merge/github.mjs').Check[]>} */
  const checks = o.checks ?? {};
  const github = fakeGitHub({
    remote,
    checks: ({ branch }) => checks[branch] ?? [{ name: 'test', state: 'success' }],
  });
  /**
   * An executor's branch, pushed: its files and the item closed.
   * @param {string} id @param {Record<string, string>} files @param {{ close?: boolean }} [b]
   */
  const branch = (id, files, b = {}) => {
    const name = `hitld/${id}`;
    git(root, 'checkout', '-q', '-b', name, 'main');
    put(root, {
      ...files,
      [`work/items/${id}.md`]: itemText(id, b.close === false ? 'in-progress' : 'done'),
    });
    git(root, 'add', '-A');
    git(
      root,
      'commit',
      '-q',
      '-m',
      `${id}: the change`,
      '-m',
      `Work-Item: ${id}\nDispatch: D-${id.slice(2)}\nAgent-Role: executor\nAgent-Model: opus\nAgent-Effort: high`,
    );
    git(root, 'push', '-q', 'origin', name);
    git(root, 'checkout', '-q', 'main');
    return { item: id, branch: name, dispatch: `D-${id.slice(2)}` };
  };
  /** @param {string} ref */
  const remoteTip = (ref) => git(remote, 'rev-parse', `refs/heads/${ref}`);
  /** @param {import('../lib/merge/queue.mjs').Entry[]} entries @param {Record<string, any>} [x] */
  const pass = (entries, x = {}) =>
    runPullRequestQueue({
      repoRoot: root,
      entries,
      settings: {
        mainBranch: 'main',
        remote: 'origin',
        checks: ['test'],
        checkTimeoutMinutes: 60,
        generated: x.generated ?? [],
        itemAt,
      },
      policy: { merge: { mode: x.mode ?? 'queue' } },
      github,
      state: x.state ?? emptyPullState(),
      evidence: () => ['npm test: 3 passed'],
      ...(x.now ? { now: x.now } : {}),
    });
  const done = () => rmSync(base, { recursive: true, force: true });
  return { base, root, remote, github, checks, branch, remoteTip, pass, done };
}

test('green: the pull request is opened from the item and the report, and squash-merged with the trailers', async () => {
  const t = setup();
  try {
    const e = t.branch('W-1', { 'a.txt': 'a\n' });
    const r = await t.pass([e]);
    assert.equal(r.incident, null);
    assert.deepEqual(r.rejected, []);
    assert.equal(r.merged.length, 1);
    assert.equal(r.merged[0].item, 'W-1');
    assert.equal(r.merged[0].signed_off, false);
    const pr = t.github.pulls[0];
    assert.equal(pr.title, 'Item W-1 (W-1)');
    assert.match(pr.body, /## Done when\n\n- W-1 works\./);
    assert.match(pr.body, /- npm test: 3 passed/);
    assert.match(pr.body, /## Release note\n\nnone/);
    // Main moved by the squash merge, to one commit carrying the item's trailers and no sign-off.
    assert.equal(t.remoteTip('main'), r.merged[0].commit);
    const message = git(t.remote, 'log', '-1', '--format=%B', 'main');
    assert.match(message, /^Item W-1 \(W-1\) \(#1\)/);
    for (const line of [
      'Work-Item: W-1',
      'Dispatch: D-1',
      'Agent-Role: executor',
      'Agent-Effort: high',
    ]) {
      assert.ok(message.includes(line), `${line} in ${message}`);
    }
    assert.doesNotMatch(message, /Signed-off-by/);
    assert.equal(git(t.remote, 'show', 'main:a.txt'), 'a');
    assert.deepEqual(r.state.branches, {});
  } finally {
    t.done();
  }
});

test('a red named check sends the branch back with the check; nothing merges', async () => {
  const t = setup({
    checks: { 'hitld/W-1': [{ name: 'test', state: 'failure', url: 'https://ci.example/1' }] },
  });
  try {
    const before = t.remoteTip('main');
    const r = await t.pass([t.branch('W-1', { 'a.txt': 'a\n' })]);
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason, x.dispatch]),
      [['W-1', 'checks', 'D-1']],
    );
    assert.match(String(r.rejected[0].message), /"test" failed .*https:\/\/ci\.example\/1/);
    assert.deepEqual(r.merged, []);
    assert.equal(t.remoteTip('main'), before);
  } finally {
    t.done();
  }
});

test('a named check that never completes stalls only its own pull request; an unnamed one is not waited for', async () => {
  const t = setup({
    checks: {
      'hitld/W-1': [{ name: 'test', state: 'pending' }],
      // W-2's unnamed check never completes either; it is not waited for.
      'hitld/W-2': [
        { name: 'test', state: 'success' },
        { name: 'optional', state: 'pending' },
      ],
    },
  });
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const b = t.branch('W-2', { 'b.txt': 'b\n' });
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    // Within the timeout, W-1's running check holds what comes after it.
    const first = await t.pass([a, b], { now: () => new Date(t0) });
    assert.deepEqual(
      first.pending.map((x) => [x.item, x.checks]),
      [['W-1', ['test']]],
    );
    assert.deepEqual(first.merged, []);
    // Past it, W-1 is stalled and stays waiting, and the queue goes on to W-2.
    const later = await t.pass([a, b], {
      now: () => new Date(t0 + 61 * 60_000),
      state: first.state,
    });
    assert.deepEqual(
      later.stalled.map((x) => [x.item, x.checks, x.waited_ms]),
      [['W-1', ['test'], 61 * 60_000]],
    );
    assert.deepEqual(
      later.merged.map((x) => x.item),
      ['W-2'],
    );
    assert.deepEqual(later.rejected, []);
    assert.ok(later.state.branches['hitld/W-1'], 'the stalled pull request is still the queue’s');
  } finally {
    t.done();
  }
});

test('after a merge the next branch is brought up to date by a merge, rebuilt, pushed and checked again; a conflict goes back', async () => {
  const t = setup();
  try {
    const a = t.branch('W-1', { 'shared.txt': 'one from W-1\n' });
    const b = t.branch('W-2', { 'shared.txt': 'one from W-2\n' });
    const c = t.branch('W-3', { 'c.txt': 'c\n' });
    const cBefore = t.remoteTip('hitld/W-3');
    const generated = [{ globs: ['built.txt'], regenerate: 'ls *.txt | sort > built.txt' }];
    const r = await t.pass([a, b, c], { generated });
    assert.deepEqual(
      r.merged.map((x) => x.item),
      ['W-1'],
    );
    // W-2 conflicts with what merged: back to its executor, with the file.
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason, x.files]),
      [['W-2', 'conflict', ['shared.txt']]],
    );
    assert.match(String(r.rejected[0].message), /never rebase or force-push/);
    // W-3 is brought up to date: main merged in, never rewritten, and the rebuilt file committed.
    assert.equal(r.updated.length, 1);
    assert.equal(r.updated[0].item, 'W-3');
    assert.equal(r.updated[0].rebuilt, true);
    const cNow = t.remoteTip('hitld/W-3');
    assert.equal(cNow, r.updated[0].commit);
    git(t.remote, 'merge-base', '--is-ancestor', cBefore, cNow);
    git(t.remote, 'merge-base', '--is-ancestor', t.remoteTip('main'), cNow);
    assert.match(git(t.remote, 'show', `${cNow}:built.txt`), /c\.txt/);
    assert.deepEqual(r.merged.length, 1, 'W-3 waits for its checks on the new head');
    // Its checks pass on the new head: the next pass merges it.
    const next = await t.pass([c], { generated, state: r.state });
    assert.deepEqual(
      next.merged.map((x) => x.item),
      ['W-3'],
    );
    assert.equal(git(t.remote, 'show', 'main:shared.txt'), 'one from W-1');
    // The squash commit carries W-3's own trailers, not the queue's update commits.
    const message = git(t.remote, 'log', '-1', '--format=%B', 'main');
    assert.match(message, /Work-Item: W-3/);
    assert.doesNotMatch(message, /W-1/);
  } finally {
    t.done();
  }
});

test('a merge of main that fails without a conflict is an incident, and nothing is sent back', async () => {
  // No identity anywhere git looks: the queue cannot commit main into the branch.
  const saved = { home: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const t = setup({ identity: false });
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const b = t.branch('W-2', { 'b.txt': 'b\n' });
    const bBefore = t.remoteTip('hitld/W-2');
    const r = await t.pass([a, b]);
    assert.deepEqual(
      r.merged.map((x) => x.item),
      ['W-1'],
    );
    assert.deepEqual(r.rejected, []);
    assert.equal(r.incident?.kind, 'update');
    assert.match(
      String(r.incident?.message),
      /merging main into hitld\/W-2 failed without a conflict/,
    );
    assert.equal(t.remoteTip('hitld/W-2'), bBefore, 'the branch is left as it was');
  } finally {
    if (saved.home === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.home;
    if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = saved.system;
    t.done();
  }
});

test('a branch that does not close its item goes back, so the close lands in the same pull request', async () => {
  const t = setup();
  try {
    const r = await t.pass([t.branch('W-1', { 'a.txt': 'a\n' }, { close: false })]);
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason]),
      [['W-1', 'not_closed']],
    );
    assert.match(String(r.rejected[0].message), /hitld work close W-1/);
    assert.equal(t.github.pulls.length, 0, 'no pull request is opened for it');
  } finally {
    t.done();
  }
});

test("owner mode: a green pull request waits; the recorded approval's sign-off goes on the squash commit and holds across the queue's update", async () => {
  const t = setup();
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const b = t.branch('W-2', { 'b.txt': 'b\n' });
    const first = await t.pass([a, b], { mode: 'owner' });
    assert.deepEqual(first.merged, []);
    assert.deepEqual(
      first.awaiting_owner.map((x) => x.item),
      ['W-1', 'W-2'],
    );
    assert.deepEqual(first.awaiting_owner[0].changed, ['a.txt', 'work/items/W-1.md']);
    const state = first.state;
    const refused = approvePulls({
      state,
      names: ['W-9'],
      signedOffBy: 'Owner Person <owner@example.com>',
      by: 'cos',
      at: '2026-11-16T10:00:00Z',
      heads: t.remoteTip,
    });
    assert.deepEqual(refused.refused, { unknown: ['W-9'], moved: [] });
    const ok = approvePulls({
      state,
      all: true,
      signedOffBy: 'Owner Person <owner@example.com>',
      by: 'cos',
      at: '2026-11-16T10:00:00Z',
      heads: t.remoteTip,
    });
    assert.equal(ok.refused, null);
    // W-1 merges with the sign-off; W-2, approved too, is brought up to date by the queue.
    const second = await t.pass([a, b], { mode: 'owner', state });
    assert.deepEqual(
      second.merged.map((x) => [x.item, x.signed_off]),
      [['W-1', true]],
    );
    assert.match(
      git(t.remote, 'log', '-1', '--format=%B', 'main'),
      /^Signed-off-by: Owner Person <owner@example\.com>$/m,
    );
    assert.deepEqual(
      second.updated.map((x) => x.item),
      ['W-2'],
    );
    // The update is the queue's own commit, so the approval still holds and W-2 merges, signed off.
    const third = await t.pass([b], { mode: 'owner', state: second.state });
    assert.deepEqual(
      third.merged.map((x) => [x.item, x.signed_off]),
      [['W-2', true]],
    );
  } finally {
    t.done();
  }
});

test('an approval does not hold once the branch gets a commit the queue did not make', async () => {
  const t = setup();
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const first = await t.pass([a], { mode: 'owner' });
    approvePulls({
      state: first.state,
      all: true,
      signedOffBy: 'O P <o@example.com>',
      by: 's',
      at: 'now',
      heads: t.remoteTip,
    });
    git(t.root, 'checkout', '-q', 'hitld/W-1');
    put(t.root, { 'a.txt': 'changed after the approval\n' });
    git(t.root, 'commit', '-q', '-am', 'more');
    git(t.root, 'push', '-q', 'origin', 'hitld/W-1');
    git(t.root, 'checkout', '-q', 'main');
    const second = await t.pass([a], { mode: 'owner', state: first.state });
    assert.deepEqual(second.merged, []);
    assert.deepEqual(
      second.awaiting_owner.map((x) => x.item),
      ['W-1'],
    );
  } finally {
    t.done();
  }
});

test('whether a pull request waits is one function of its changed paths and the policy', () => {
  assert.equal(pullRequestWaits(['src/a.js'], { merge: { mode: 'owner' } }), true);
  assert.equal(pullRequestWaits(['work/items/W-1.md'], { merge: { mode: 'queue' } }), false);
});

test('the pieces: no checks named refuses, sign-offs, remote URLs', async () => {
  assert.equal(validSignoff('Owner Person <owner@example.com>'), true);
  assert.equal(validSignoff('owner@example.com'), false);
  assert.equal(repoFromRemote('https://github.com/acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('http://proxy@127.0.0.1:1234/git/acme/app'), 'acme/app');
  const t = setup();
  try {
    await assert.rejects(
      runPullRequestQueue({
        repoRoot: t.root,
        entries: [],
        settings: {
          mainBranch: 'main',
          remote: 'origin',
          checks: [],
          checkTimeoutMinutes: 60,
          generated: [],
          itemAt,
        },
        policy: {},
        github: t.github,
        state: emptyPullState(),
      }),
      /merge\.pull_request\.checks is empty/,
    );
    const e = t.branch('W-1', { 'a.txt': 'a\n' });
    const head = t.remoteTip(e.branch);
    assert.match(
      squashMessage({ dir: t.root, base: 'main', head, item: 'W-1', signedOffBy: 'A B <a@b.c>' }),
      /Work-Item: W-1\n[^]*Signed-off-by: A B <a@b\.c>$/,
    );
  } finally {
    t.done();
  }
});

test('hitld merge with merge.via pull-request: presented to the owner, approved with the sign-off, squash-merged, recorded', async () => {
  const { main } = await import('../lib/cli/main.mjs');
  const { makeConsumer, item, report, STATUS_INPUT } = await import('./orchestrator-fixture.mjs');
  const { recordStatusLine } = await import('../harness/claude-code/statusline.mjs');
  const { openStore } = await import('../lib/store/store.mjs');
  const { readLedger } = await import('../lib/ledger/ledger.mjs');
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'owner',
        via: 'pull-request',
        pull_request: { checks: ['test'] },
        full_suite: ["node --test 'test/*.test.js'"],
      },
    },
  });
  try {
    const remote = join(c.base, 'remote.git');
    git(c.base, 'init', '-q', '--bare', '-b', 'main', remote);
    git(c.root, 'remote', 'add', 'origin', remote);
    git(c.root, 'push', '-q', 'origin', 'main');
    const github = fakeGitHub({ remote, checks: () => [{ name: 'test', state: 'success' }] });
    /** @param {string[]} argv */
    const hitld = async (argv) => {
      let out = '';
      const exit = await main(argv, {
        out: (t) => (out += t),
        err: () => {},
        cwd: c.root,
        env: c.env,
        github: () => github,
      });
      return { exit, result: JSON.parse(out) };
    };
    recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
    assert.equal((await hitld(['run', 'start'])).exit, 0);
    const start = await hitld(['dispatch', 'start', 'W-1']);
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    await hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1']);
    const branch = start.result.branch;
    git(c.root, 'switch', '-q', '-c', branch);
    put(c.root, {
      'work/items/W-1-add-numbers.md': item({
        id: 'W-1',
        title: 'Add numbers',
        kind: 'work',
        state: 'done',
        touches: ['src/calc.js'],
      }),
      'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    });
    git(c.root, 'add', '-A');
    git(
      c.root,
      'commit',
      '-q',
      '-m',
      'W-1',
      '-m',
      'Work-Item: W-1\nDispatch: D-1\nAgent-Role: executor',
    );
    const sha = git(c.root, 'rev-parse', 'HEAD');
    git(c.root, 'push', '-q', 'origin', branch);
    git(c.root, 'switch', '-q', 'main');
    const note = join(c.base, 'note.txt');
    writeFileSync(note, report({ item: 'W-1', sha, branch }));
    const done = await hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
    assert.equal(done.result.queued_to_merge, branch);

    const shown = await hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    assert.equal(shown.result.via, 'pull-request');
    assert.deepEqual(shown.result.merged, []);
    assert.deepEqual(
      shown.result.presented.map((/** @type {any} */ b) => b.item),
      ['W-1'],
    );
    assert.match(shown.result.question, /^Merge https:\/\/github\.com\/.*\/pull\/1\? yes, or no$/);
    // The body carries the report's evidence.
    assert.match(github.pulls[0].body, /- node --test test\/: 1 passed/);

    const noSign = await hitld(['merge', 'approve', '--all']);
    assert.equal(noSign.result.error, 'usage');
    const approved = await hitld([
      'merge',
      'approve',
      '--all',
      '--signoff',
      'Owner Person <owner@example.com>',
    ]);
    assert.equal(approved.exit, 0, JSON.stringify(approved.result));
    assert.deepEqual(approved.result.approved, [branch]);

    const merged = await hitld(['merge']);
    assert.equal(merged.exit, 0, JSON.stringify(merged.result));
    assert.deepEqual(merged.result.merged, ['W-1']);
    const message = git(remote, 'log', '-1', '--format=%B', 'main');
    assert.match(message, /^Signed-off-by: Owner Person <owner@example\.com>$/m);
    assert.match(message, /^Work-Item: W-1$/m);
    const store = openStore(join(c.data, 'human-in-the-lead', 'orch-fixture'));
    const events = readLedger(store).events;
    assert.ok(events.some((e) => e.event === 'merge-approved' && e.branches?.includes(branch)));
    assert.ok(
      events.some(
        (e) =>
          e.event === 'merged' && e.item === 'W-1' && e.commit === git(remote, 'rev-parse', 'main'),
      ),
    );
    // Nothing waits any more.
    assert.equal((await hitld(['merge'])).result.message, 'nothing is waiting to merge');
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});
