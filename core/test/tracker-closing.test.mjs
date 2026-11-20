// Closing by trailer at merge, and the consistency check on main (design part 3.4, HITLD-49).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { approvePresented, presentToOwner } from '../lib/merge/owner.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { closeByTrailer, setStateLine, subjectIds } from '../lib/tracker/files/closing.mjs';
import { STRICT } from '../lib/guard/classification.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git as ogit, makeConsumer, report } from './orchestrator-fixture.mjs';
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
    closeByTrailer: (dir, from, to, own) => closeByTrailer(dir, layout, from, to, { own }),
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

// --- After the review of HITLD-49 ---------------------------------------------------------

/**
 * A branch of one commit with a full message, made from main.
 * @param {string} root @param {string} branch @param {string[]} paragraphs
 * @param {Record<string, string>} [files]
 */
function branchWith(root, branch, paragraphs, files) {
  git(root, 'checkout', '-q', '-b', branch, 'main');
  put(root, files ?? { [`src/${branch.replace(/\W/g, '-')}.txt`]: `${branch}\n` });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', ...paragraphs.flatMap((p) => ['-m', p]));
  git(root, 'checkout', '-q', 'main');
}

test('a value in the tracker key that is not an ID is refused; one in another key is ignored', () => {
  const root = makeRepo();
  for (const [name, value] of [
    ['dot', 'W-4.'],
    ['lower', 'w-4'],
    ['zero', 'W-04'],
  ]) {
    branchWith(root, `fix/${name}`, ['Fix', `Closes: ${value}`]);
    git(root, 'checkout', '-q', `fix/${name}`);
    const r = closeByTrailer(root, layoutOf(root), 'main', 'HEAD');
    assert.deepEqual(r.closed, [], value);
    assert.match(
      r.problems[0],
      new RegExp(
        `^Closes: ${value.replace('.', '\\.')} \\([0-9a-f]{12}\\) is not an ID in this tracker \\(W-<n>`,
      ),
    );
    git(root, 'checkout', '-q', 'main');
  }
  branchWith(root, 'fix/forge', ['Fix', 'Closes: #57\nCloses: APP-4']);
  git(root, 'checkout', '-q', 'fix/forge');
  assert.deepEqual(closeByTrailer(root, layoutOf(root), 'main', 'HEAD'), {
    closed: [],
    problems: [],
  });
});

test('a dispatched branch closes only its own item; a dropped item never closes', async () => {
  const root = makeRepo({
    files: {
      'work/items/W-7-given-up.md':
        '---\nid: W-7\ntitle: Given up\nkind: work\nstate: dropped\nproject: W-2\nreason: not needed\n---\n\nBody.\n',
    },
  });
  branchWith(root, 'exec/w-4', ['W-4', 'Closes: W-5']);
  branchWith(root, 'exec/w-5', ['W-5', 'Closes: W-5']);
  branchWith(root, 'fix/dropped', ['Fix', 'Closes: W-7']);
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [
      { item: 'W-4', branch: 'exec/w-4', dispatch: 'D-1' },
      { item: 'W-5', branch: 'exec/w-5', dispatch: 'D-2' },
      { item: 'W-7', branch: 'fix/dropped' },
    ],
    settings: settingsFor(root),
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason, x.dispatch ?? null]),
    [
      ['W-4', 'closes', 'D-1'],
      ['W-7', 'closes', null],
    ],
  );
  assert.match(
    String(result.rejected[0].output),
    /names an item other than W-4, the one this branch was dispatched for/,
  );
  assert.match(String(result.rejected[1].output), /names an item that is dropped/);
  assert.deepEqual(
    result.merged.map((m) => [m.item, m.closed]),
    [['W-5', ['W-5']]],
  );
  assert.equal(stateAt(root, 'main', W5), 'done');
  assert.equal(stateAt(root, 'main', W4), 'planned');
});

test('only the trailer block counts: a Closes: line mid-body or quoted closes nothing', async () => {
  const root = makeRepo();
  branchWith(root, 'fix/prose', [
    'Fix the thing',
    'Someone wrote this in the issue:\nCloses: W-5\nbut that is not this commit.',
    '> Closes: W-5',
    'Refs: W-4',
  ]);
  git(root, 'checkout', '-q', 'fix/prose');
  assert.deepEqual(closeByTrailer(root, layoutOf(root), 'main', 'HEAD'), {
    closed: [],
    problems: [],
  });
});

test('two branches that close one item in a batch close it once', async () => {
  const root = makeRepo();
  branchWith(root, 'fix/one', ['One', 'Closes: W-4']);
  branchWith(root, 'fix/two', ['Two', 'Closes: W-4']);
  const before = git(root, 'rev-parse', 'main').trim();
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [
      { item: 'W-4', branch: 'fix/one' },
      { item: 'W-5', branch: 'fix/two' },
    ],
    settings: settingsFor(root),
  });
  assert.deepEqual(
    result.merged.map((m) => [m.item, m.closed]),
    [
      ['W-4', ['W-4']],
      ['W-5', undefined],
    ],
  );
  assert.equal(
    git(root, 'log', '--format=%s', `${before}..main`)
      .split('\n')
      .filter((s) => s === 'close: W-4').length,
    1,
  );
  assert.equal(stateAt(root, 'main', W4), 'done');
});

test('bisection sends back the branch that breaks the suite, and its close with it; the good branch keeps its close', async () => {
  const root = makeRepo();
  branchWith(root, 'fix/good', ['Good', 'Closes: W-4']);
  branchWith(root, 'fix/bad', ['Bad', 'Closes: W-5'], { 'src/broken.txt': 'broken\n' });
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [
      { item: 'W-4', branch: 'fix/good' },
      { item: 'W-5', branch: 'fix/bad' },
    ],
    settings: { ...settingsFor(root), fullSuite: ['test ! -e src/broken.txt'] },
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason]),
    [['W-5', 'suite']],
  );
  assert.ok(result.bisection_runs > 0);
  assert.deepEqual(
    result.merged.map((m) => [m.item, m.closed]),
    [['W-4', ['W-4']]],
  );
  assert.equal(stateAt(root, 'main', W4), 'done');
  assert.equal(stateAt(root, 'main', W5), 'planned');
});

test('the commit guard covers the close commit: a private term in the item file refuses the branch', async () => {
  const term = 'Quillmarsh';
  const root = makeRepo({
    files: {
      [W4]: `---\nid: W-4\ntitle: Second step\nkind: work\nstate: planned\nproject: W-2\nneeds: [W-3]\n---\n\nAsked for by ${term}.\n`,
    },
  });
  branchWith(root, 'fix/term', ['Fix', 'Closes: W-4']);
  const before = git(root, 'rev-parse', 'main').trim();
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-4', branch: 'fix/term' }],
    settings: {
      ...settingsFor(root),
      classification: {
        ...STRICT,
        terms: compileTerms([{ term, kind: 'name', id: 'PT-1' }]),
      },
    },
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason, x.files]),
    [['W-4', 'classification', [W4]]],
  );
  assert.equal(git(root, 'rev-parse', 'main').trim(), before);
});

test('the close changes the state line and no other byte of the item file', async () => {
  const text =
    '---\nid: W-4\ntitle: "Second: step, with a colon"\nkind: work\nstate: planned\nproject: W-2\nneeds: [W-3]\nrelease: 0.2.0\n---\n\nBody, kept as written.\n';
  const root = makeRepo({ files: { [W4]: text } });
  branchWith(root, 'fix/bytes', ['Fix', 'Closes: W-4']);
  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-4', branch: 'fix/bytes' }],
    settings: settingsFor(root),
  });
  assert.deepEqual(result.rejected, []);
  assert.equal(git(root, 'show', `main:${W4}`), text.replace('state: planned', 'state: done'));
  assert.equal(setStateLine('no front matter\n', 'done'), null);
  assert.equal(setStateLine('---\nid: W-1\n---\nstate: planned\n', 'done'), null);
});

test('on main, a subject naming the item counts, a bulk edit is not a change, and a release item is left out', async () => {
  const root = makeRepo({
    files: {
      'work/items/W-7-the-release.md':
        '---\nid: W-7\ntitle: The release\nkind: work\nstate: planned\nproject: W-2\nrelease: 0.1.0\n---\n\nBody.\n',
    },
  });
  settings(root);
  /** @param {string} path @param {string} from @param {string} to */
  const edit = (path, from, to) =>
    put(root, { [path]: readFileSync(join(root, path), 'utf8').replace(from, to) });
  // The first commit that names an item, so done items after it are checked.
  git(root, 'commit', '-q', '--allow-empty', '-m', 'Start', '-m', 'Refs: W-3');
  // A squash merge through a pull request: the subject names W-4, and no trailer does.
  put(root, { 'src/w4.txt': 'the work\n' });
  edit(W4, 'state: planned', 'state: done');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'W-4: the second step (#12)', '-m', 'Agent-Role: executor');
  // A bulk edit after it rewrites six item files, W-3 among them (done before any trailer).
  for (const f of [
    'work/items/W-3-first-step.md',
    W4,
    W5,
    'work/items/W-6-which-way.md',
    'work/items/W-7-the-release.md',
    'work/projects/W-2-the-project.md',
  ]) {
    edit(f, 'Body.', 'Body, reworded.');
  }
  commitAll(root, 'Tracker: reword every body');
  // The release item is marked done in a tracker commit, as a release does.
  edit('work/items/W-7-the-release.md', 'state: planned', 'state: done');
  commitAll(root, 'Tracker: the release is published');
  const r = await hitld(['work', 'check'], root);
  assert.deepEqual(r.json.mismatches, []);
  assert.deepEqual(subjectIds('W-650, 651: the chief (#7)', 'W'), ['W-650', 'W-651']);
  assert.deepEqual(subjectIds('W-571 to 573: placement', 'W'), ['W-571', 'W-572', 'W-573']);
  assert.deepEqual(subjectIds('Add a thing (W-12) (#5)', 'W'), ['W-12']);
  assert.deepEqual(subjectIds('Tracker: W-1: something', 'W'), []);
  assert.deepEqual(subjectIds('W-4x is not one', 'W'), []);
});

test('hitld merge end to end: an executor closes its own item by trailer; another item in its trailer sends it back', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  /** @param {string} id @param {string} trailer */
  const dispatchAndReport = async (id, trailer) => {
    const start = await c.hitld(['dispatch', 'start', id]);
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    const d = start.result.dispatch;
    await c.hitld(['dispatch', 'handle', '--dispatch', d, '--harness-ref', `agent-${d}`]);
    const branch = start.result.branch;
    ogit(c.root, 'switch', '-q', '-c', branch);
    put(c.root, { [`src/${id}.js`]: `export const x = '${id}';\n` });
    ogit(c.root, 'add', '-A');
    ogit(c.root, 'commit', '-q', '-m', `${id}: the work`, '-m', trailer);
    const sha = ogit(c.root, 'rev-parse', 'HEAD');
    ogit(c.root, 'switch', '-q', 'main');
    const note = join(c.base, `note-${id}.txt`);
    writeFileSync(note, report({ item: id, sha, branch }));
    const done = await c.hitld(['dispatch', 'complete', '--dispatch', d, '--report-file', note]);
    assert.equal(done.exit, 0, JSON.stringify(done.result));
    return d;
  };
  const d1 = await dispatchAndReport('W-1', `Closes: W-1\nWork-Item: W-1`);
  const d2 = await dispatchAndReport('W-2', `Closes: W-3\nWork-Item: W-2`);
  const merged = await c.hitld(['merge']);
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.deepEqual(merged.result.merged, ['W-1']);
  assert.deepEqual(merged.result.closed, ['W-1']);
  assert.match(readFileSync(join(c.root, 'work/items/W-1-add-numbers.md'), 'utf8'), /state: done/);
  assert.match(readFileSync(join(c.root, 'work/items/W-3-after-one.md'), 'utf8'), /state: planned/);
  const back = merged.result.rejected.find((/** @type {any} */ x) => x.item === 'W-2');
  assert.equal(back.reason, 'closes');
  assert.equal(back.follow_up.dispatch, d2);
  assert.match(back.problems[0], /^Closes: W-3 \([0-9a-f]{12}\) names an item other than W-2/);
  assert.match(back.follow_up.message, /a dispatched branch only its own item/);
  void d1;
});
