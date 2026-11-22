// The merge queue through pull requests (merge.via pull-request), against a fake GitHub API whose
// repository is a bare git remote: green, a red check, a check that never completes, a conflict on
// update, and the owner's sign-off; and who decides (HITLD-150): a pull request outside
// merge.owner_paths merged without asking under the owner's delegation, one inside left waiting,
// one touching both, decided from the diff alone, the queue proposed after a clean run, and a
// revert starting the run again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mergeErrors } from '../lib/kb/kb.mjs';
import { fakeGitHub, repoFromRemote } from '../lib/merge/github.mjs';
import { stageAll } from '../lib/merge/queue.mjs';
import {
  approvePulls,
  emptyPullState,
  pullRequestWaits,
  pullTrustEvents,
  revertCommand,
  runPullRequestQueue,
  squashMessage,
  validSignoff,
} from '../lib/merge/pull-request.mjs';
import { approvalSummary, areasOf, queueProposals, revertEvents } from '../lib/merge/owner.mjs';
import { checksFor } from '../lib/merge/pull-request.mjs';
import { classify } from '../../scripts/ci-changes.mjs';
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
   * An executor's branch, pushed: its files and the item closed. `move` renames files with git mv
   * first; `message` and `author` replace the commit's message and author.
   * @param {string} id @param {Record<string, string>} files
   * @param {{ close?: boolean, move?: Record<string, string>, message?: string, author?: string }} [b]
   */
  const branch = (id, files, b = {}) => {
    const name = `hitld/${id}`;
    git(root, 'checkout', '-q', '-b', name, 'main');
    for (const [from, to] of Object.entries(b.move ?? {})) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      git(root, 'mv', from, to);
    }
    put(root, {
      ...files,
      [`work/items/${id}.md`]: itemText(id, b.close === false ? 'in-progress' : 'done'),
    });
    git(root, 'add', '-A');
    git(
      root,
      'commit',
      '-q',
      ...(b.author ? [`--author=${b.author}`] : []),
      '-m',
      b.message ?? `${id}: the change`,
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
        ...(x.delegatedBy ? { delegatedBy: x.delegatedBy } : {}),
        ...(x.answers ? { answers: x.answers } : {}),
        ...(x.conditionalChecks ? { conditionalChecks: x.conditionalChecks } : {}),
        ...(x.kbCheck ? { kbCheck: x.kbCheck } : {}),
      },
      policy: { merge: { mode: x.mode ?? 'queue', ...(x.merge ?? {}) } },
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
  // user.useConfigOnly too: without it git guesses one from the system where it can (Git for
  // Windows reads the signed-in account's name and email), and the merge would succeed.
  const vars = /** @type {const} */ ([
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_NOSYSTEM',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ]);
  const saved = Object.fromEntries(vars.map((v) => [v, process.env[v]]));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
  });
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
    for (const v of vars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
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

test('a branch whose knowledge base fails kb check goes back before a pull request is opened (HITLD-55)', async () => {
  const t = setup();
  try {
    const r = await t.pass(
      [
        t.branch('W-1', {
          'kb/note.md': '---\nsummary: A note.\n---\n\nSee [gone](gone.md).\n',
        }),
      ],
      {
        kbCheck: (/** @type {string} */ dir) => mergeErrors(dir, null, 'public'),
      },
    );
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason, x.output]),
      [['W-1', 'knowledge_base', 'kb/note.md gone.md: no such file']],
    );
    assert.match(String(r.rejected[0].message), /fails hitld kb check/);
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

/**
 * A tracker change merged on main out of band from the queue, as the owner merges one.
 * @param {ReturnType<typeof setup>} t @param {Record<string, string>} files
 */
function trackerMerge(t, files) {
  git(t.root, 'fetch', '-q', 'origin', 'main');
  git(t.root, 'merge', '-q', '--ff-only', 'origin/main');
  put(t.root, files);
  git(t.root, 'add', '-A');
  git(t.root, 'commit', '-q', '-m', 'Tracker: file and reword items');
  git(t.root, 'push', '-q', 'origin', 'main');
}

/**
 * Branches presented to the owner in owner mode and approved, all of them.
 * @param {ReturnType<typeof setup>} t @param {import('../lib/merge/queue.mjs').Entry[]} entries
 */
async function presentedAndApproved(t, entries) {
  const first = await t.pass(entries, { mode: 'owner' });
  assert.deepEqual(
    first.awaiting_owner.map((x) => x.item),
    entries.map((e) => e.item),
  );
  const ok = approvePulls({
    state: first.state,
    all: true,
    signedOffBy: OWNER,
    by: 'cos',
    at: '2026-11-22T10:00:00Z',
    heads: t.remoteTip,
  });
  assert.equal(ok.refused, null);
  return first.state;
}

test('a presented branch merges while tracker-only merges land on main, not updated or checked again; a code change landing updates the next (HITLD-777)', async () => {
  const t = setup();
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const b = t.branch('W-2', { 'b.txt': 'b\n' });
    const aHead = t.remoteTip(a.branch);
    const bHead = t.remoteTip(b.branch);
    const state = await presentedAndApproved(t, [a, b]);
    // Tracker merges land on main while the approved pull requests wait, one after another.
    trackerMerge(t, { 'work/notes.md': 'a note\n' });
    trackerMerge(t, {
      'work/items/W-4.md': itemText('W-4', 'planned'),
      'work/notes.md': 'a note, reworded\n',
    });
    // W-1 merges as it is, with the owner's sign-off: its head the one approved and checked.
    const second = await t.pass([a, b], { mode: 'owner', state });
    assert.equal(second.incident, null);
    assert.deepEqual(
      second.merged.map((x) => [x.item, x.signed_off]),
      [['W-1', true]],
    );
    assert.equal(t.remoteTip(a.branch), aHead, 'W-1 was not brought up to date');
    assert.equal(git(t.remote, 'show', 'main:a.txt'), 'a');
    assert.equal(git(t.remote, 'show', 'main:work/notes.md'), 'a note, reworded');
    // W-1 changed code: W-2, now behind main outside work/, is brought up to date and checked again.
    assert.deepEqual(
      second.updated.map((x) => x.item),
      ['W-2'],
    );
    assert.notEqual(t.remoteTip(b.branch), bHead);
    // Another tracker merge lands while its checks run: W-2 merges on the head the queue made,
    // without a second update.
    const updated = t.remoteTip(b.branch);
    trackerMerge(t, { 'work/notes.md': 'a third note\n' });
    const third = await t.pass([b], { mode: 'owner', state: second.state });
    assert.deepEqual(
      third.merged.map((x) => [x.item, x.signed_off]),
      [['W-2', true]],
    );
    assert.deepEqual(third.updated, []);
    assert.equal(t.remoteTip(b.branch), updated);
    assert.equal(git(t.remote, 'show', 'main:work/notes.md'), 'a third note');
    assert.equal(git(t.remote, 'show', 'main:b.txt'), 'b');
  } finally {
    t.done();
  }
});

test('a tracker merge that changes a work/ file the branch also changes still brings the branch up to date (HITLD-777)', async () => {
  const t = setup();
  try {
    const c = t.branch('W-3', { 'c.txt': 'c\n' });
    const cHead = t.remoteTip(c.branch);
    const state = await presentedAndApproved(t, [c]);
    // The branch closes W-3; main rewords it, apart from the state line.
    trackerMerge(t, { 'work/items/W-3.md': `${itemText('W-3', 'planned')}- W-3 is reworded.\n` });
    const second = await t.pass([c], { mode: 'owner', state });
    assert.deepEqual(second.merged, []);
    assert.deepEqual(
      second.updated.map((x) => x.item),
      ['W-3'],
    );
    const now = t.remoteTip(c.branch);
    assert.notEqual(now, cHead);
    git(t.remote, 'merge-base', '--is-ancestor', t.remoteTip('main'), now);
    // The approval holds across the queue's own update: the next pass merges it, signed off.
    const third = await t.pass([c], { mode: 'owner', state: second.state });
    assert.deepEqual(
      third.merged.map((x) => [x.item, x.signed_off]),
      [['W-3', true]],
    );
    assert.match(git(t.remote, 'show', 'main:work/items/W-3.md'), /state: done[^]*reworded/);
  } finally {
    t.done();
  }
});

test('a branch left behind main by tracker changes that GitHub will not merge is brought up to date on the next pass (HITLD-777)', async () => {
  const t = setup();
  try {
    const a = t.branch('W-1', { 'a.txt': 'a\n' });
    const aHead = t.remoteTip(a.branch);
    trackerMerge(t, { 'work/notes.md': 'a note\n' });
    // A protected main that requires a branch up to date refuses the merge of one behind it.
    const strict = {
      ...t.github,
      /** @type {typeof t.github.mergePull} */
      mergePull(number, p) {
        const main = t.remoteTip('main');
        const behind = git(t.remote, 'merge-base', main, p.sha) !== main;
        return behind
          ? { merged: false, message: 'Head branch is not up to date with the base branch' }
          : t.github.mergePull(number, p);
      },
    };
    const pass = (/** @type {any} */ state) =>
      runPullRequestQueue({
        repoRoot: t.root,
        entries: [a],
        settings: {
          mainBranch: 'main',
          remote: 'origin',
          checks: ['test'],
          checkTimeoutMinutes: 60,
          generated: [],
          itemAt,
        },
        policy: { merge: { mode: 'queue' } },
        github: strict,
        state,
      });
    const first = await pass(emptyPullState());
    assert.deepEqual(first.merged, []);
    assert.deepEqual(first.updated, []);
    assert.deepEqual(
      first.pending.map((x) => x.item),
      ['W-1'],
    );
    assert.equal(first.state.branches[a.branch].refused_behind, aHead);
    // Refused once for this head: brought up to date as before, then merged.
    const second = await pass(first.state);
    assert.deepEqual(
      second.updated.map((x) => x.item),
      ['W-1'],
    );
    assert.equal(second.state.branches[a.branch].refused_behind, undefined);
    const third = await pass(second.state);
    assert.deepEqual(
      third.merged.map((x) => x.item),
      ['W-1'],
    );
  } finally {
    t.done();
  }
});

test('stageAll: a file that differs only in line endings is no change to commit', () => {
  const root = realpathSync(tempDir('hitld-stage-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'core.autocrlf', 'true');
  put(root, { 'views/ready.md': 'a\nb\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  // The checkout has CRLF (core.autocrlf); a generator writes the same text with LF.
  rmSync(join(root, 'views/ready.md'));
  git(root, 'checkout', '--', 'views/ready.md');
  put(root, { 'views/ready.md': 'a\nb\n' });
  assert.equal(stageAll(root), false);
  put(root, { 'views/ready.md': 'a\nc\n' });
  assert.equal(stageAll(root), true);
});

test('whether a pull request waits is one function of its changed paths and the policy', () => {
  assert.equal(pullRequestWaits(['src/a.js'], { merge: { mode: 'owner' } }), true);
  assert.equal(pullRequestWaits(['work/items/W-1.md'], { merge: { mode: 'queue' } }), false);
  // Owner mode with both settings empty: every pull request waits, a tracker-only one too.
  assert.equal(pullRequestWaits(['work/items/W-1.md'], { merge: { mode: 'owner' } }), true);
  // This repository's scope (HITLD-158): everything but work/ waits. Paths are read in order, the
  // last glob a file matches deciding; "!" takes files back out.
  const policy = { merge: { mode: 'owner', owner_paths: ['**', '!work/**'] } };
  /** @type {[string[], boolean][]} */
  const table = [
    [['work/items/W-1.md'], false],
    [['work/items/W-1.md', 'work/views/ready.md', 'work/releases/v1.md'], false],
    [['work/items/W-1.md', 'core/lib/merge/pull-request.mjs'], true],
    [['core/lib/merge/pull-request.mjs'], true],
    [['.github/workflows/ci.yml'], true],
    [['.human-in-the-lead/policy.json'], true],
    [['schemas/policy/merge.schema.json'], true],
    [['skills/execute/SKILL.md'], true],
    [['plugins/human-in-the-lead/core/lib/merge/owner.mjs'], true],
    [['package.json'], true],
    [['README.md'], true],
    [['a-new-directory/x.mjs'], true],
    [['work'], true],
    [['workers/x.mjs'], true],
    [[' work/x.md'], true],
    [['docs/work/x.md'], true],
    [[], true],
  ];
  for (const [paths, waits] of table) {
    assert.equal(pullRequestWaits(paths, policy), waits, JSON.stringify(paths));
  }
  // Order matters: a later glob takes a path back in.
  const releases = {
    merge: { mode: 'owner', owner_paths: ['**', '!work/**', 'work/releases/**'] },
  };
  assert.equal(pullRequestWaits(['work/items/W-1.md'], releases), false);
  assert.equal(pullRequestWaits(['work/releases/v1.md'], releases), true);
  // By area: the files in an area named in owner_areas wait.
  const areas = {
    merge: { mode: 'owner', owner_areas: ['core'] },
    rights: { areas: [{ name: 'core', paths: ['core/**'] }] },
  };
  assert.equal(pullRequestWaits(['core/x.mjs'], areas), true);
  assert.equal(pullRequestWaits(['work/items/W-1.md'], areas), false);
  // Nothing but the paths and the policy is an input: no author, no title, no description.
  assert.equal(pullRequestWaits.length, 2);
});

/** The owner's delegation and scope as this repository sets them, with W-159 as the decision. */
const DELEGATED = {
  mode: 'owner',
  merge: { owner_paths: ['**', '!work/**'] },
  delegatedBy: 'W-159',
};
const OWNER = 'Owner Person <owner@example.com>';

test('owner paths: a tracker-only pull request merges without asking, with the delegated sign-off; one outside work/, or touching both, waits', async () => {
  const t = setup();
  try {
    const tracker = t.branch('W-1', { 'work/notes.md': 'a note\n' });
    const code = t.branch('W-2', { 'a.txt': 'a\n' });
    const both = t.branch('W-3', { 'work/more.md': 'more\n', 'b.txt': 'b\n' });
    // No sign-off of the owner's is known yet: the tracker-only one waits for them too, marked so.
    const first = await t.pass([tracker, code, both], DELEGATED);
    assert.deepEqual(first.merged, []);
    assert.deepEqual(
      first.awaiting_owner.map((x) => [x.item, x.no_signoff ?? false]),
      [
        ['W-1', true],
        ['W-2', false],
        ['W-3', false],
      ],
    );
    // The owner approves the code pull request only; that records their sign-off.
    const ok = approvePulls({
      state: first.state,
      names: ['W-2'],
      signedOffBy: OWNER,
      by: 'cos',
      at: '2026-11-16T10:00:00Z',
      heads: t.remoteTip,
    });
    assert.equal(ok.refused, null);
    assert.equal(first.state.owner_signoff, OWNER);
    assert.equal(first.state.branches['hitld/W-2'].approval?.as_presented, false);

    // W-1 merges without asking. W-2 (approved) is then behind main only by W-1's tracker change,
    // which it leaves alone (HITLD-777): it merges as it is, with the owner's own sign-off and no
    // delegation trailer, its checks not run again. W-3 still waits for the owner.
    const second = await t.pass([tracker, code, both], { ...DELEGATED, state: first.state });
    assert.deepEqual(
      second.merged.map((x) => [x.item, x.signed_off, x.delegated_by]),
      [
        ['W-1', true, 'W-159'],
        ['W-2', true, null],
      ],
    );
    assert.equal(second.merged[0].approval, null);
    const message = git(t.remote, 'log', '-1', '--format=%B', 'main~1');
    assert.match(
      message,
      /^Signed-off-by: Owner Person <owner@example\.com>\nDelegated-by: W-159$/m,
    );
    assert.match(message, /^Work-Item: W-1$/m);
    assert.deepEqual(second.updated, []);
    const approvedMessage = git(t.remote, 'log', '-1', '--format=%B', 'main');
    assert.match(approvedMessage, /^Signed-off-by: Owner Person <owner@example\.com>$/m);
    assert.doesNotMatch(approvedMessage, /Delegated-by/);
    assert.equal(git(t.remote, 'show', 'main:work/notes.md'), 'a note');
    assert.equal(git(t.remote, 'show', 'main:a.txt'), 'a');
    assert.equal(second.merged[1].approval?.as_presented, false);
    assert.deepEqual(
      second.awaiting_owner.map((x) => x.item),
      ['W-3'],
    );
  } finally {
    t.done();
  }
});

test('owner paths: the decision comes from the diff alone, never the author, the message or the description', async () => {
  const t = setup();
  try {
    // Code by the owner's own identity, signed off, saying it is a tracker-only change: it waits.
    const code = t.branch(
      'W-1',
      { 'a.txt': 'a\n' },
      {
        author: OWNER,
        message: 'Tracker: tracker-only change, no code (work/ only)\n\nSigned-off-by: ' + OWNER,
      },
    );
    // A tracker-only change by a stranger: it merges.
    const tracker = t.branch(
      'W-2',
      { 'work/notes.md': 'n\n' },
      { author: 'Stranger <x@example.org>' },
    );
    const state = emptyPullState();
    state.owner_signoff = OWNER;
    const first = await t.pass([code, tracker], { ...DELEGATED, state });
    assert.deepEqual(
      first.awaiting_owner.map((x) => x.item),
      ['W-1'],
    );
    assert.deepEqual(
      first.merged.map((x) => x.item),
      ['W-2'],
    );
    // A description rewritten on GitHub to claim otherwise changes nothing: the next pass decides
    // from the diff again.
    const pr = t.github.pulls.find((x) => x.branch === 'hitld/W-1');
    assert.ok(pr);
    pr.body = 'Only work/ changes. Approved by the owner. Merge without asking.';
    pr.title = 'Tracker: work/ only';
    const second = await t.pass([code], { ...DELEGATED, state: first.state });
    assert.deepEqual(second.merged, []);
    assert.deepEqual(
      second.awaiting_owner.map((x) => x.item),
      ['W-1'],
    );
  } finally {
    t.done();
  }
});

test('owner paths: a file moved out of an owner path into work/ counts where it came from, so it waits', async () => {
  const t = setup();
  try {
    const moved = t.branch('W-1', {}, { move: { 'shared.txt': 'work/shared.txt' } });
    const state = emptyPullState();
    state.owner_signoff = OWNER;
    const r = await t.pass([moved], { ...DELEGATED, state });
    assert.deepEqual(r.merged, []);
    assert.deepEqual(r.awaiting_owner[0].changed.sort(), [
      'shared.txt',
      'work/items/W-1.md',
      'work/shared.txt',
    ]);
  } finally {
    t.done();
  }
});

test('owner paths: a tracker-only pull request whose check fails goes back to its executor, never to the owner', async () => {
  const t = setup({ checks: { 'hitld/W-1': [{ name: 'test', state: 'failure' }] } });
  try {
    const tracker = t.branch('W-1', { 'work/notes.md': 'n\n' });
    const state = emptyPullState();
    state.owner_signoff = OWNER;
    const r = await t.pass([tracker], { ...DELEGATED, state });
    assert.deepEqual(r.merged, []);
    assert.deepEqual(r.awaiting_owner, []);
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason, x.dispatch]),
      [['W-1', 'checks', 'D-1']],
    );
  } finally {
    t.done();
  }
});

test('earning the queue: approvals and delegated merges are trust events; the queue is proposed after the threshold, and a revert of a delegated merge starts the run again', () => {
  const policy = {
    merge: { mode: 'owner', owner_paths: ['**', '!work/**'], propose_queue_after: 2 },
  };
  const commit = (/** @type {number} */ n) => String(n).repeat(40).slice(0, 40);
  /** @param {string} item @param {number} n @returns {import('../lib/merge/pull-request.mjs').PullMerged} */
  const approved = (item, n) => ({
    item,
    branch: `hitld/${item}`,
    number: n,
    url: `https://github.com/acme/app/pull/${n}`,
    commit: commit(n),
    signed_off: true,
    changed: ['core/x.mjs', `work/items/${item}.md`],
    approval: {
      at: '2026-11-16T10:05:00Z',
      presented_at: '2026-11-16T10:00:00Z',
      as_presented: true,
    },
    delegated_by: null,
  });
  /** @type {import('../lib/merge/pull-request.mjs').PullMerged} */
  const delegated = {
    ...approved('W-3', 3),
    changed: ['work/items/W-3.md'],
    approval: null,
    delegated_by: 'W-159',
  };
  /** @type {Record<string, any>[]} */
  const trust = pullTrustEvents([approved('W-1', 1), delegated], policy);
  assert.deepEqual(
    trust.map((e) => [e.kind, e.area, e.subject, e.latency_ms ?? null]),
    [
      ['merge-approval', 'unassigned', 'W-1', 300000],
      ['merge-delegated', 'unassigned', 'W-3', null],
    ],
  );
  assert.equal(queueProposals(approvalSummary(trust), policy).length, 0, 'one approval is short');
  trust.push(...pullTrustEvents([approved('W-2', 2)], policy));
  const proposals = queueProposals(approvalSummary(trust), policy);
  assert.deepEqual(
    proposals.map((x) => [x.area, x.clean_run, x.change]),
    [['unassigned', 2, { 'merge.mode': 'queue' }]],
  );
  // The delegated merge is reverted: the run starts again, and nothing is proposed.
  trust.push(...revertEvents(trust, 'W-3'));
  assert.deepEqual(trust.at(-1), { kind: 'merge-reverted', area: 'unassigned', subject: 'W-3' });
  const after = approvalSummary(trust).unassigned;
  assert.equal(after.clean_run, 0);
  assert.equal(after.delegated, 1);
  assert.equal(after.delegated_reverted, 1);
  assert.equal(after.approvals, 2);
  assert.deepEqual(queueProposals(after ? { unassigned: after } : {}, policy), []);
  assert.match(revertCommand({ item: 'W-3', commit: commit(3) }), /^git revert --no-edit 3{40} /);
});

test('earning the queue by area: a glob broader than the area stays, and the area is taken out after it', () => {
  const policy = {
    merge: { mode: 'owner', owner_paths: ['**', '!work/**'], propose_queue_after: 1 },
    rights: {
      areas: [
        { name: 'skills', paths: ['skills/**'] },
        { name: 'core', paths: ['core/**'] },
      ],
    },
  };
  const trust = [{ kind: 'merge-approval', area: 'skills', subject: 'W-1', as_presented: true }];
  const [p] = queueProposals(approvalSummary(trust), policy);
  assert.deepEqual(p.change, {
    'merge.owner_areas': [],
    'merge.owner_paths': ['**', '!work/**', '!skills/**'],
  });
  // A glob inside the area goes.
  const inside = {
    ...policy,
    merge: { ...policy.merge, owner_paths: ['skills/**', 'core/**'] },
  };
  assert.deepEqual(queueProposals(approvalSummary(trust), inside)[0].change, {
    'merge.owner_areas': [],
    'merge.owner_paths': ['core/**'],
  });
});

test('the pieces: no checks named refuses, sign-offs, remote URLs', async () => {
  assert.equal(validSignoff('Owner Person <owner@example.com>'), true);
  assert.equal(validSignoff('owner@example.com'), false);
  assert.equal(repoFromRemote('https://github.com/acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('http://proxy@127.0.0.1:1234/git/acme/app'), 'acme/app');
  // A local path: its last two segments, with either separator.
  assert.equal(repoFromRemote('/srv/git/acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('C:\\srv\\git\\acme\\app.git'), 'acme/app');
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
        full_suite: ['node --test "test/*.test.js"'],
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
    const dispatch = start.result.dispatch;
    await hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', 'agent-1']);
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
      `Work-Item: W-1\nDispatch: ${dispatch}\nAgent-Role: executor`,
    );
    const sha = git(c.root, 'rev-parse', 'HEAD');
    git(c.root, 'push', '-q', 'origin', branch);
    git(c.root, 'switch', '-q', 'main');
    const note = join(c.base, 'note.txt');
    writeFileSync(note, report({ item: 'W-1', sha, branch }));
    const done = await hitld([
      'dispatch',
      'complete',
      '--dispatch',
      dispatch,
      '--report-file',
      note,
    ]);
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

test('hitld merge with owner paths and a delegation: the owner approves code, the queue is proposed, a tracker-only pull request merges without asking and is listed in the digest with its reversal, and its revert starts the run again', async () => {
  const { main } = await import('../lib/cli/main.mjs');
  const { makeConsumer, item, report, STATUS_INPUT } = await import('./orchestrator-fixture.mjs');
  const { recordStatusLine } = await import('../harness/claude-code/statusline.mjs');
  const { openStore } = await import('../lib/store/store.mjs');
  const { readLedger } = await import('../lib/ledger/ledger.mjs');
  const { readTrustEvents } = await import('../lib/rights/trust.mjs');
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'owner',
        via: 'pull-request',
        pull_request: { checks: ['test'], delegated_by: 'W-159' },
        owner_paths: ['**', '!work/**'],
        propose_queue_after: 1,
        full_suite: ['node --test "test/*.test.js"'],
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
    /**
     * Dispatch an item, commit its change on its branch with the item closed, report it.
     * @param {string} id @param {string} file the item's file
     * @param {string} title @param {Record<string, string>} files
     */
    const deliver = async (id, file, title, files) => {
      const start = await hitld(['dispatch', 'start', id]);
      assert.equal(start.exit, 0, JSON.stringify(start.result));
      const dispatch = start.result.dispatch;
      await hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', `agent-${id}`]);
      const branch = start.result.branch;
      git(c.root, 'switch', '-q', '-c', branch);
      put(c.root, { [file]: item({ id, title, kind: 'work', state: 'done' }), ...files });
      git(c.root, 'add', '-A');
      git(
        c.root,
        'commit',
        '-q',
        '-m',
        id,
        '-m',
        `Work-Item: ${id}\nDispatch: ${dispatch}\nAgent-Role: executor`,
      );
      const sha = git(c.root, 'rev-parse', 'HEAD');
      git(c.root, 'push', '-q', 'origin', branch);
      git(c.root, 'switch', '-q', 'main');
      const note = join(c.base, `${id}.txt`);
      writeFileSync(note, report({ item: id, sha, branch }));
      const done = await hitld([
        'dispatch',
        'complete',
        '--dispatch',
        dispatch,
        '--report-file',
        note,
      ]);
      assert.equal(done.result.queued_to_merge, branch, JSON.stringify(done.result));
      return branch;
    };
    recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
    assert.equal((await hitld(['run', 'start'])).exit, 0);

    // A code change waits for the owner, who approves it: their sign-off is recorded, the
    // approval is trust evidence, and after one clean approval (propose_queue_after 1) the queue
    // is proposed.
    const code = await deliver('W-1', 'work/items/W-1-add-numbers.md', 'Add numbers', {
      'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    });
    const shown = await hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    assert.deepEqual(
      shown.result.presented.map((/** @type {any} */ b) => [b.item, b.no_signoff ?? false]),
      [['W-1', false]],
    );
    const approved = await hitld(['merge', '--all', '--signoff', OWNER]);
    assert.equal(approved.exit, 0, JSON.stringify(approved.result));
    assert.deepEqual(approved.result.merged, ['W-1']);
    assert.deepEqual(approved.result.delegated, []);
    assert.deepEqual(
      approved.result.proposals.map((/** @type {any} */ x) => [x.area, x.change]),
      [['unassigned', { 'merge.mode': 'queue' }]],
    );
    assert.match(approved.result.next, /hitld rights ask --question/);
    assert.ok(approved.result.pull_requests[0].approval);
    void code;

    // A tracker-only change merges without asking, with the owner's sign-off marked as delegated.
    const tracker = await deliver('W-2', 'work/items/W-2-another-thing.md', 'Another thing', {
      'work/notes.md': 'a note\n',
    });
    // Its branch left main before W-1 merged: the first pass brings it up to date, the next merges.
    const update = await hitld(['merge']);
    assert.equal(update.exit, 0, JSON.stringify(update.result));
    assert.deepEqual(
      update.result.updated.map((/** @type {any} */ u) => u.item),
      ['W-2'],
      JSON.stringify(update.result),
    );
    const merged = await hitld(['merge']);
    assert.equal(merged.exit, 0, JSON.stringify(merged.result));
    assert.deepEqual(merged.result.merged, ['W-2'], JSON.stringify(merged.result));
    assert.deepEqual(merged.result.presented, []);
    const commit = git(remote, 'rev-parse', 'main');
    assert.deepEqual(
      merged.result.delegated.map((/** @type {any} */ d) => [d.item, d.commit, d.decision]),
      [['W-2', commit, 'W-159']],
    );
    assert.match(
      merged.result.delegated[0].reverse,
      new RegExp(`^git revert --no-edit ${commit} `),
    );
    const message = git(remote, 'log', '-1', '--format=%B', 'main');
    assert.match(
      message,
      /^Signed-off-by: Owner Person <owner@example\.com>\nDelegated-by: W-159$/m,
    );
    const store = openStore(join(c.data, 'human-in-the-lead', 'orch-fixture'));
    const event = readLedger(store).events.find((e) => e.event === 'merged' && e.item === 'W-2');
    assert.equal(event?.decision, 'W-159');
    assert.equal(event?.branch, tracker);

    // The digest lists it as merged without asking, with the command that reverses it.
    const digest = await hitld(['rights', 'digest', '--full']);
    assert.equal(digest.exit, 0, JSON.stringify(digest.result));
    const listed = digest.result.merged.find((/** @type {any} */ m) => m.item === 'W-2');
    assert.equal(listed.delegated_by, 'W-159');
    assert.match(listed.reverse, new RegExp(`git revert --no-edit ${commit}`));
    assert.match(digest.result.text, /merged without asking under W-159/);

    // A revert of it counts against the area: the run starts again.
    const trustBefore = readTrustEvents(store);
    assert.ok(trustBefore.some((e) => e.kind === 'merge-delegated' && e.subject === 'W-2'));
    const reverted = await hitld([
      'ledger',
      'append',
      JSON.stringify({ event: 'reverted', item: 'W-2' }),
    ]);
    assert.equal(reverted.exit, 0, JSON.stringify(reverted.result));
    const trust = readTrustEvents(store);
    assert.ok(trust.some((e) => e.kind === 'merge-reverted' && e.subject === 'W-2'));
    assert.equal(approvalSummary(trust).unassigned.clean_run, 0);
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});

/** This repository's own policy, as committed. */
const REPO_POLICY = JSON.parse(
  readFileSync(new URL('../../.human-in-the-lead/policy.json', import.meta.url), 'utf8'),
);

test("this repository's policy: what merges without asking, by changed paths (HITLD-158, HITLD-309)", () => {
  /** @type {[string[], boolean][]} */
  const table = [
    [['work/items/HITLD-1.md'], false],
    [['work/items/HITLD-1.md', 'work/views/ready.md', 'work/milestones/M-1.md'], false],
    [['work/projects/HITLD-15.md'], false],
    [['work/releases/v0.1.0.md'], true],
    [['work/items/HITLD-1.md', 'work/releases/v0.1.0.md'], true],
    [['work/items/HITLD-1.md', 'core/lib/merge/pull-request.mjs'], true],
    [['core/lib/merge/pull-request.mjs'], true],
    [['plugins/human-in-the-lead/core/lib/merge/owner.mjs'], true],
    [['schemas/policy/merge.schema.json'], true],
    [['skills/execute/SKILL.md'], true],
    [['.github/workflows/ci.yml'], true],
    [['.human-in-the-lead/policy.json'], true],
    [['docs/design/x.md'], true],
    [['scripts/ci-changes.mjs'], true],
    [['README.md'], true],
    [['package-lock.json'], true],
    [['new-directory/x.mjs'], true],
    [[], true],
  ];
  for (const [paths, waits] of table) {
    assert.equal(pullRequestWaits(paths, REPO_POLICY), waits, JSON.stringify(paths));
  }
  // A symbolic link anywhere waits, under work/ too.
  assert.equal(pullRequestWaits(['work/link'], REPO_POLICY, ['work/link']), true);
});

test("this repository's areas: each proposal frees one area; the tracker, already free, and the unassigned files are never proposed", () => {
  /** @param {string} area */
  const run = (area) =>
    Array.from({ length: REPO_POLICY.merge.propose_queue_after }, (_, i) => ({
      kind: 'merge-approval',
      area,
      subject: `HITLD-${i + 1}`,
      as_presented: true,
    }));
  const names = REPO_POLICY.rights.areas.map((/** @type {any} */ a) => a.name);
  for (const area of ['tracker', 'unassigned']) {
    assert.deepEqual(queueProposals(approvalSummary(run(area)), REPO_POLICY), [], area);
  }
  // A yes to core frees its generated copy in the plugin too (HITLD-317): one approval, both.
  const core = queueProposals(approvalSummary(run('core')), REPO_POLICY);
  assert.deepEqual(core[0].change, {
    'merge.owner_areas': [],
    'merge.owner_paths': [
      '**',
      '!work/**',
      'work/releases/**',
      '!core/**',
      '!plugins/human-in-the-lead/core/**',
      '!plugins/human-in-the-lead/hooks/**',
    ],
  });
  const policyWithCore = {
    ...REPO_POLICY,
    merge: { ...REPO_POLICY.merge, owner_paths: core[0].change['merge.owner_paths'] },
  };
  // After a yes, core and its plugin copy stop waiting, and nothing else does.
  assert.equal(pullRequestWaits(['core/lib/x.mjs'], policyWithCore), false);
  assert.equal(
    pullRequestWaits(
      ['core/lib/x.mjs', 'plugins/human-in-the-lead/core/lib/x.mjs'],
      policyWithCore,
    ),
    false,
  );
  assert.equal(
    pullRequestWaits(['plugins/human-in-the-lead/schemas/x.json'], policyWithCore),
    true,
  );
  assert.equal(
    pullRequestWaits(['plugins/human-in-the-lead/hooks/hooks.json'], policyWithCore),
    false,
  );
  assert.equal(pullRequestWaits(['plugins/human-in-the-lead/bin/hitld'], policyWithCore), true);
  assert.equal(
    pullRequestWaits(['plugins/human-in-the-lead/skills/x/SKILL.md'], policyWithCore),
    true,
  );
  assert.equal(pullRequestWaits(['skills/x/SKILL.md'], policyWithCore), true);
  assert.equal(pullRequestWaits(['work/releases/v1.md'], policyWithCore), true);
  const skills = queueProposals(approvalSummary(run('skills')), REPO_POLICY);
  const withSkills = {
    ...REPO_POLICY,
    merge: { ...REPO_POLICY.merge, owner_paths: skills[0].change['merge.owner_paths'] },
  };
  for (const f of [
    'skills/execute/SKILL.md',
    'agents/generalizer.md',
    'plugins/human-in-the-lead/skills/execute/SKILL.md',
    'plugins/human-in-the-lead/agents/generalizer.md',
  ]) {
    assert.equal(pullRequestWaits([f], withSkills), false, f);
  }
  assert.equal(pullRequestWaits(['plugins/human-in-the-lead/core/lib/x.mjs'], withSkills), true);
  // Every tracked file is in one area at most, so an approval counts where its files are.
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const twice = tracked.filter((f) => areasOf([f], REPO_POLICY).length > 1);
  assert.deepEqual(twice, []);
  const plugin = tracked.filter((f) => f.startsWith('plugins/'));
  assert.ok(plugin.length > 0);
  assert.deepEqual(
    plugin.filter((f) => areasOf([f], REPO_POLICY)[0] === 'unassigned'),
    [],
    'every file of the plugin build is in an area',
  );
  // Every generated copy follows its source (HITLD-318): a yes to schemas, templates or evals frees
  // its plugin copy, and the plugins area keeps only what the build does not write.
  for (const [area, source, copy] of [
    [
      'schemas',
      'schemas/policy/merge.schema.json',
      'plugins/human-in-the-lead/schemas/policy/merge.schema.json',
    ],
    [
      'templates',
      'templates/AGENTS.contract.md',
      'plugins/human-in-the-lead/templates/AGENTS.contract.md',
    ],
    ['evals', 'evals/README.md', 'plugins/human-in-the-lead/evals/README.md'],
  ]) {
    const [p] = queueProposals(approvalSummary(run(area)), REPO_POLICY);
    const yes = {
      ...REPO_POLICY,
      merge: { ...REPO_POLICY.merge, owner_paths: p.change['merge.owner_paths'] },
    };
    assert.equal(pullRequestWaits([source, copy], yes), false, area);
    assert.equal(pullRequestWaits(['plugins/human-in-the-lead/core/lib/x.mjs'], yes), true, area);
  }
  assert.deepEqual(tracked.filter((f) => areasOf([f], REPO_POLICY)[0] === 'plugins').sort(), [
    'plugins/human-in-the-lead/.claude-plugin/plugin.json',
    'plugins/human-in-the-lead/README.md',
    'plugins/human-in-the-lead/bin/hitld',
  ]);
  const releases = queueProposals(approvalSummary(run('releases')), REPO_POLICY);
  assert.deepEqual(releases[0].change['merge.owner_paths'], [
    '**',
    '!work/**',
    '!work/releases/**',
  ]);
  for (const area of names.filter((/** @type {string} */ n) => n !== 'tracker')) {
    const [p] = queueProposals(approvalSummary(run(area)), REPO_POLICY);
    assert.ok(p, area);
    assert.notDeepEqual(p.change, { 'merge.mode': 'queue' }, area);
  }
});

test("this repository's CodeQL wait matches CI: waited for where CodeQL analyzes the diff, never for text only", () => {
  const settings = {
    mainBranch: 'main',
    remote: 'origin',
    checks: REPO_POLICY.merge.pull_request.checks,
    conditionalChecks: REPO_POLICY.merge.pull_request.conditional_checks,
    checkTimeoutMinutes: 60,
    generated: [],
    itemAt: () => null,
  };
  /** @type {string[][]} */
  const cases = [
    ['work/items/HITLD-1.md'],
    ['docs/design/x.md'],
    ['README.md', 'CONTRIBUTING.md'],
    ['skills/execute/SKILL.md'],
    ['notes.txt'],
    ['LICENSE'],
    ['core/lib/merge/pull-request.mjs'],
    ['work/items/HITLD-1.md', 'core/x.mjs'],
    ['.github/workflows/ci.yml'],
    ['schemas/policy/merge.schema.json'],
    ['.human-in-the-lead/policy.json'],
    [],
  ];
  for (const paths of cases) {
    const waited = checksFor(paths, settings).includes('CodeQL');
    assert.equal(waited, classify(paths).codeql, JSON.stringify(paths));
  }
});

test('a conditional check: a code change waits for it, a tracker-only one does not', async () => {
  const t = setup({
    checks: {
      'hitld/W-1': [{ name: 'test', state: 'success' }],
      'hitld/W-2': [{ name: 'test', state: 'success' }],
    },
  });
  try {
    const code = t.branch('W-1', { 'a.js': 'a\n' });
    const tracker = t.branch('W-2', { 'work/notes.md': 'n\n' });
    const conditionalChecks = [{ name: 'CodeQL', unless_only: ['work/**', '**/*.md'] }];
    const r = await t.pass([code, tracker], { conditionalChecks });
    assert.deepEqual(
      r.pending.map((x) => [x.item, x.checks]),
      [['W-1', ['CodeQL']]],
    );
    // W-1 holds the merges after it, as any running check does; once CodeQL reports, it merges.
    t.checks['hitld/W-1'].push({ name: 'CodeQL', state: 'success' });
    const again = await t.pass([code, tracker], { conditionalChecks });
    assert.deepEqual(
      again.merged.map((x) => x.item),
      ['W-1'],
    );
    assert.match(t.github.pulls[0].body, /these checks pass: test, CodeQL\./);
  } finally {
    t.done();
  }
});

test('a symbolic link added under work/, or a file turned into one, waits for the owner', async () => {
  const t = setup();
  try {
    /** @param {string} id @param {string} path @param {string} target */
    const linked = (id, path, target) => {
      const e = t.branch(id, { 'work/notes.md': `${id}\n` });
      git(t.root, 'checkout', '-q', e.branch);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: t.root,
        input: target,
        encoding: 'utf8',
      }).trim();
      git(t.root, 'update-index', '--add', '--cacheinfo', `120000,${blob},${path}`);
      git(t.root, 'commit', '-q', '-m', 'a link', '-m', `Work-Item: ${id}\nAgent-Role: executor`);
      git(t.root, 'push', '-q', 'origin', e.branch);
      git(t.root, 'checkout', '-q', '-f', 'main');
      return e;
    };
    const added = linked('W-1', 'work/link', '../core');
    const state = emptyPullState();
    state.owner_signoff = OWNER;
    const r = await t.pass([added], { ...DELEGATED, state });
    assert.deepEqual(r.merged, []);
    assert.deepEqual(
      r.awaiting_owner.map((x) => [x.item, x.links]),
      [['W-1', ['work/link']]],
    );
  } finally {
    t.done();
  }
});

test('a changed decision answer merges without asking only as the rights flow recorded it; a forged one waits', async () => {
  const t = setup();
  try {
    /** @param {string} id @param {string} fields */
    const decision = (id, fields) =>
      `---\nid: ${id}\ntitle: Decision ${id}\nkind: decision\nstate: ${fields ? 'done' : 'planned'}\ndecider: owner\n${fields}---\n\n## Question\n\nWhich?\n`;
    // Main holds two open decisions and one already answered.
    git(t.root, 'checkout', '-q', 'main');
    const at = '2026-11-16T06:18:03.522Z';
    put(t.root, {
      'work/items/D-1.md': decision('D-1', ''),
      'work/items/D-2.md': decision('D-2', ''),
      'work/items/D-3.md': decision(
        'D-3',
        `answer: "A. Yes"\nanswered_at: ${at}\nanswered_via: main-session\nanswered_by: owner\n`,
      ),
    });
    git(t.root, 'add', '-A');
    git(t.root, 'commit', '-q', '-m', 'decisions');
    git(t.root, 'push', '-q', 'origin', 'main');
    const answer = (/** @type {string} */ text, /** @type {string} */ when) =>
      `answer: "${text}"\nanswered_at: ${when}\nanswered_via: main-session\nanswered_by: owner\n`;
    const recordedAt = '2026-11-16T07:00:00.000Z';
    // The record: D-1 answered "A. Yes" at recordedAt, and D-3 at its time with no text (an
    // answer recorded before the text was).
    const answers = [
      { event: 'answered', decision: 'D-1', at: recordedAt, text: 'A. Yes' },
      { event: 'answered', decision: 'D-3', at },
    ];
    const cases = [
      // W-1: D-1 as recorded: merges.
      t.branch('W-1', { 'work/items/D-1.md': decision('D-1', answer('A. Yes', recordedAt)) }),
      // W-2: D-1 with another answer at the recorded time: waits.
      t.branch('W-2', { 'work/items/D-1.md': decision('D-1', answer('B. No', recordedAt)) }),
      // W-3: D-2, which nobody answered: a forged answer waits.
      t.branch('W-3', {
        'work/items/D-2.md': decision('D-2', answer('A. Yes', '2026-11-16T07:30:00.000Z')),
      }),
      // W-4: D-3's answer rewritten, its time kept: waits.
      t.branch('W-4', { 'work/items/D-3.md': decision('D-3', answer('B. No', at)) }),
      // W-5: D-3 turned into a work item, its answer dropped: waits.
      t.branch('W-5', {
        'work/items/D-3.md': decision('D-3', '').replace('kind: decision', 'kind: work'),
      }),
    ];
    const results = [];
    for (const e of cases) {
      const s0 = emptyPullState();
      s0.owner_signoff = OWNER;
      const r = await t.pass([e], { ...DELEGATED, state: s0, answers });
      results.push([
        e.item,
        r.merged.length > 0,
        (r.awaiting_owner[0]?.answer_unverified ?? []).map((x) => x.decision),
      ]);
      if (r.merged.length) git(t.root, 'fetch', '-q', 'origin');
    }
    assert.deepEqual(results[0], ['W-1', true, []]);
    assert.deepEqual(results.slice(1), [
      ['W-2', false, ['D-1']],
      ['W-3', false, ['D-2']],
      ['W-4', false, ['D-3']],
      ['W-5', false, ['D-3']],
    ]);
    // With no record at all, no changed answer merges without asking.
    const bare = emptyPullState();
    bare.owner_signoff = OWNER;
    const none = await t.pass([cases[2]], { ...DELEGATED, state: bare });
    assert.deepEqual(
      none.awaiting_owner.map((x) => x.item),
      ['W-3'],
    );
  } finally {
    t.done();
  }
});
