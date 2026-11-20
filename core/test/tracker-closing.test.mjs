// Closing by trailer at merge, and the consistency check on main (design part 3.4, HITLD-49).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { approvePresented, presentToOwner } from '../lib/merge/owner.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { closeByTrailer } from '../lib/tracker/files/closing.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { commitAll, git, isolatedEnv, makeRepo, policyFor, put } from './tracker-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const HOME = isolatedEnv();
const W4 = 'work/items/W-4-second-step.md';
const W5 = 'work/items/W-5-third-step.md';

/** @param {string} root */
const layoutOf = (root) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME } }).layout();

/** @param {string} root @param {string} ref @param {string} path */
const stateAt = (root, ref, path) =>
  /^state: (.*)$/m.exec(git(root, 'show', `${ref}:${path}`))?.[1] ?? null;

/**
 * The queue's settings for the fixture, with closing by trailer as `hitld merge` wires it.
 * @param {string} root
 * @returns {import('../lib/merge/queue.mjs').Settings}
 */
const settingsFor = (root) => {
  const layout = layoutOf(root);
  return {
    mainBranch: 'main',
    batchMax: 4,
    fastChecks: [],
    fullSuite: ['true'],
    generated: [],
    flakeReruns: 0,
    closeByTrailer: (dir, from, to) => closeByTrailer(dir, layout, from, to),
  };
};

/**
 * A person's branch, made by hand with no claim: one commit of work whose message carries the
 * given trailers after a paragraph of prose.
 * @param {string} root @param {string} branch @param {string} trailers
 */
function handBranch(root, branch, trailers) {
  git(root, 'checkout', '-q', '-b', branch, 'main');
  put(root, { [`src/${branch.replace(/\W/g, '-')}.txt`]: 'the fix\n' });
  git(root, 'add', '-A');
  git(
    root,
    'commit',
    '-q',
    '-m',
    'Fix the thing by hand',
    '-m',
    'This closes W-5 and fixes W-6 in prose, which never counts.',
    '-m',
    trailers,
  );
  git(root, 'checkout', '-q', 'main');
}

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: { ...HOME } });
  return { code, json: out.startsWith('{') ? JSON.parse(out) : null };
}

/** @param {string} root */
function settings(root) {
  const dir = join(root, '.human-in-the-lead');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } }),
  );
  chmodSync(join(dir, 'policy.json'), 0o644);
}

test('a hand merge with Closes: commits the Done edit in the same merge; Refs: and prose change nothing; a revert reopens it', async () => {
  const root = makeRepo();
  handBranch(root, 'fix/by-hand', 'Closes: W-4\nRefs: W-5');
  const before = git(root, 'rev-parse', 'main').trim();
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-4', branch: 'fix/by-hand' }],
    settings: settingsFor(root),
  });
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(
    result.merged.map((m) => [m.item, m.closed]),
    [['W-4', ['W-4']]],
  );
  assert.equal(stateAt(root, 'main', W4), 'done', 'Closes: closed it');
  assert.equal(stateAt(root, 'main', W5), 'planned', 'Refs: and the prose changed nothing');
  // The Done edit is the merge's own last commit, on top of the person's work.
  assert.equal(git(root, 'log', '-1', '--format=%s', 'main').trim(), 'close: W-4');
  assert.match(git(root, 'log', '-1', '--format=%b', 'main'), /^Work-Item: W-4$/m);
  assert.equal(git(root, 'show', '--name-only', '--format=', 'main').trim(), W4);
  assert.equal(git(root, 'rev-list', '--count', `${before}..main`).trim(), '2');
  // The branch itself is untouched: the edit lives in the merge.
  assert.equal(stateAt(root, 'fix/by-hand', W4), 'planned');

  settings(root);
  const merged = await hitld(['work', 'check'], root);
  assert.deepEqual(merged.json.mismatches, []);

  // Reverting the merge reopens the item, and the check stays quiet: the item file changed after
  // the commit that carries the trailer.
  git(root, 'revert', '--no-edit', `${before}..main`);
  assert.equal(stateAt(root, 'main', W4), 'planned');
  const reverted = await hitld(['work', 'check'], root);
  assert.equal(reverted.json.ok, true);
  assert.deepEqual(reverted.json.mismatches, []);
});

test('in owner mode the close is in the held batch the owner sees, and lands when they approve it', async () => {
  const root = makeRepo();
  handBranch(root, 'fix/owner', 'Closes: W-4');
  const before = git(root, 'rev-parse', 'main').trim();
  const { policy } = resolvePolicy({
    schema_version: 1,
    project: { id: 'fixture', key: 'W' },
    merge: { mode: 'owner' },
  });
  if (!policy) throw new Error('the policy is invalid');
  const entries = [{ item: 'W-4', branch: 'fix/owner' }];
  const s = settingsFor(root);
  const shown = await presentToOwner({ repoRoot: root, entries, settings: s, policy });
  const p = /** @type {NonNullable<typeof shown.presentation>} */ (shown.presentation);
  assert.equal(git(root, 'rev-parse', 'main').trim(), before, 'nothing merged before the owner');
  assert.deepEqual(p.branches[0].closed, ['W-4']);
  assert.ok(p.branches[0].changed.includes(W4), 'the item file is among the files shown');
  const approved = await approvePresented({
    repoRoot: root,
    presentation: p,
    all: true,
    names: [],
    entries,
    settings: s,
  });
  assert.equal(approved.rechecked, false);
  assert.deepEqual(
    approved.result?.merged.map((m) => m.closed),
    [['W-4']],
  );
  assert.equal(stateAt(root, 'main', W4), 'done');
});

test('a Closes: trailer that cannot be honored sends the branch back and closes nothing; one in another key is not ours', async () => {
  const root = makeRepo();
  handBranch(root, 'fix/unknown', 'Closes: W-99');
  handBranch(root, 'fix/decision', 'Closes: W-6');
  handBranch(root, 'fix/done', 'Closes: W-3');
  handBranch(root, 'fix/forge', 'Closes: #57\nCloses: APP-3');
  const before = git(root, 'rev-parse', 'main').trim();
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [
      { item: 'W-99', branch: 'fix/unknown', dispatch: 'D-1' },
      { item: 'W-6', branch: 'fix/decision' },
    ],
    settings: settingsFor(root),
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason]),
    [
      ['W-99', 'closes'],
      ['W-6', 'closes'],
    ],
  );
  assert.match(String(result.rejected[0].output), /^Closes: W-99 \([0-9a-f]{12}\) names no item/);
  assert.match(String(result.rejected[0].message), /use Refs: to link one without closing it/);
  assert.match(String(result.rejected[1].output), /names a decision; only a work item closes/);
  assert.equal(git(root, 'rev-parse', 'main').trim(), before);

  // Already done in the tree: nothing to add. Not this tracker's key: left alone.
  const ok = await runMergeQueue({
    repoRoot: root,
    entries: [
      { item: 'W-3', branch: 'fix/done' },
      { item: 'W-4', branch: 'fix/forge' },
    ],
    settings: settingsFor(root),
  });
  assert.deepEqual(ok.rejected, []);
  assert.deepEqual(
    ok.merged.map((m) => m.closed),
    [undefined, undefined],
  );
  assert.equal(git(root, 'rev-list', '--count', `${before}..main`).trim(), '2');
  assert.equal(stateAt(root, 'main', W4), 'planned');
});

test('a proposed item does not close by trailer: it is not yet committed to', () => {
  const root = makeRepo({
    files: {
      'work/items/W-7-an-idea.md':
        '---\nid: W-7\ntitle: An idea\nkind: work\nstate: proposed\nproject: W-2\n---\n\nBody.\n',
    },
  });
  handBranch(root, 'fix/idea', 'Closes: W-7');
  git(root, 'checkout', '-q', 'fix/idea');
  const r = closeByTrailer(root, layoutOf(root), 'main', 'fix/idea');
  assert.deepEqual(r.closed, []);
  assert.match(r.problems[0], /names an item that is proposed; only planned or in-progress work/);
  assert.equal(git(root, 'status', '--porcelain').trim(), '', 'nothing was written');
});

test('hitld work check on main catches a direct push with Closes: and a done item no commit names', async () => {
  const root = makeRepo();
  settings(root);
  // Before any commit names an item, done items are from before the trailers: not checked.
  const fresh = await hitld(['work', 'check'], root);
  assert.deepEqual(fresh.json.mismatches, []);
  assert.deepEqual(
    fresh.json.mismatches_skipped.map((/** @type {any} */ s) => s.kind),
    ['done-without-commit'],
  );

  // A direct push to main, outside the merge path: the trailer asks for a close no merge made.
  put(root, { 'src/pushed.txt': 'pushed\n' });
  git(root, 'add', 'src/pushed.txt');
  git(root, 'commit', '-q', '-m', 'Pushed straight to main', '-m', 'Closes: W-4');
  const pushed = git(root, 'rev-parse', 'HEAD').trim().slice(0, 12);
  // Then an item marked done by hand, with no commit naming it.
  put(root, {
    [W5]: readFileSync(join(root, W5), 'utf8').replace('state: planned', 'state: done'),
  });
  commitAll(root, 'Tracker: W-5 is done');

  const r = await hitld(['work', 'check'], root);
  assert.equal(r.code, 0, 'mismatches warn; they are not problems');
  assert.equal(r.json.ok, true);
  assert.deepEqual(
    r.json.mismatches.map((/** @type {any} */ m) => [m.kind, m.item, m.commits]),
    [
      ['open-with-commit', 'W-4', [pushed]],
      ['done-without-commit', 'W-5', []],
    ],
  );
  assert.ok(
    r.json.warnings.includes(
      `${W4}: W-4 is planned, but ${pushed} on main carries its Work-Item or Closes trailer: close it if the work is done, or note in the item why it stays open`,
    ),
  );
  assert.ok(
    r.json.warnings.includes(
      `${W5}: W-5 is done, but no commit on main names it in a Work-Item, Closes or Refs trailer: confirm the work with a commit carrying Refs: W-5, or reopen it`,
    ),
  );
  // W-3 was done before any commit named an item: it is not flagged.
  assert.ok(!r.json.mismatches.some((/** @type {any} */ m) => m.item === 'W-3'));

  // The fixes: a commit that confirms W-5 with Refs:, and a note in W-4 saying why it stays open.
  git(root, 'commit', '-q', '--allow-empty', '-m', 'Confirm W-5', '-m', 'Refs: W-5');
  put(root, {
    [W4]: `${readFileSync(join(root, W4), 'utf8')}\nThe pushed commit did not finish it.\n`,
  });
  commitAll(root, 'Tracker: W-4 stays open');
  const fixed = await hitld(['work', 'check'], root);
  assert.deepEqual(fixed.json.mismatches, []);
});

test('off main, and in a shallow clone, the check says what it skipped', async () => {
  const root = makeRepo();
  settings(root);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'Linked', '-m', 'Refs: W-4');
  git(root, 'checkout', '-q', '-b', 'elsewhere');
  const off = await hitld(['work', 'check'], root);
  assert.deepEqual(off.json.mismatches, []);
  assert.deepEqual(
    off.json.mismatches_skipped.map((/** @type {any} */ s) => s.kind),
    ['all'],
  );
  git(root, 'checkout', '-q', 'main');

  const clone = join(tempDir('hitld-shallow-'), 'clone');
  git(root, 'clone', '-q', '--depth', '1', `file://${root}`, clone);
  settings(clone);
  const shallow = await hitld(['work', 'check'], clone);
  assert.deepEqual(
    shallow.json.mismatches_skipped.map((/** @type {any} */ s) => s.kind),
    ['done-without-commit'],
  );
  assert.match(shallow.json.mismatches_skipped[0].why, /shallow/);
});

test('a Work-Item trailer on a tracker-only commit is bookkeeping; on a commit with the work, it names the item', async () => {
  const root = makeRepo();
  settings(root);
  /** @param {string} path @param {string} from @param {string} to */
  const edit = (path, from, to) =>
    put(root, { [path]: readFileSync(join(root, path), 'utf8').replace(from, to) });
  /** @param {string} subject @param {string} trailers */
  const commit = (subject, trailers) => {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', subject, '-m', trailers);
  };
  // A squash commit as the pull-request path writes it: the work and the Done edit together.
  put(root, { 'src/w4.txt': 'the work\n' });
  edit(W4, 'state: planned', 'state: done');
  commit('Second step (W-4)', 'Work-Item: W-4\nDispatch: D-2');
  // A tracker change as hitld work publish writes it, to an open item: not a claim of work.
  edit(W5, 'Body.', 'Body, with a note.');
  commit('Tracker: a note on W-5', 'Work-Item: W-5\nAgent-Role: orchestrator');
  // A new item, filed the same way.
  put(root, {
    'work/items/W-7-filed.md':
      '---\nid: W-7\ntitle: Filed\nkind: work\nstate: planned\nproject: W-2\n---\n\nBody.\n',
  });
  commit('Tracker: file W-7', 'Work-Item: W-7\nAgent-Role: orchestrator');
  const quiet = await hitld(['work', 'check'], root);
  assert.deepEqual(quiet.json.mismatches, []);

  // An item marked done the same way, with nothing but the tracker change naming it.
  edit(W5, 'state: planned', 'state: done');
  commit('Tracker: W-5 is done', 'Work-Item: W-5\nAgent-Role: orchestrator');
  const r = await hitld(['work', 'check'], root);
  assert.deepEqual(
    r.json.mismatches.map((/** @type {any} */ m) => [m.kind, m.item]),
    [['done-without-commit', 'W-5']],
  );
});
