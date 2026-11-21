import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { findOrphans } from '../lib/tracker/files/claims.mjs';
import { TRACKER_METHODS } from '../lib/tracker/interface.mjs';
import {
  commitAll,
  git,
  isolatedEnv,
  itemText,
  makeRepo,
  policyFor,
  put,
} from './tracker-fixture.mjs';
import { removeTempDir, tempDir } from './helpers/tmp.mjs';

/** Whether this machine lets the tests create symbolic links (Windows needs Developer Mode or admin). */
const canSymlink = (() => {
  const dir = tempDir('hitld-link-probe-');
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    removeTempDir(dir);
  }
})();
const needsSymlink = {
  skip: !canSymlink && 'Windows: creating symbolic links needs Developer Mode or admin',
};

/** No person file, private store or store address of this machine is read. */
const HOME = isolatedEnv();

/** @param {string} root @param {Partial<Parameters<typeof openTracker>[0]>} [extra] */
const open = (root, extra) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME }, ...(extra ?? {}) });

// --- The adapter ------------------------------------------------------------------------

test('the tracker implements every method of the interface', () => {
  const t = open(makeRepo());
  for (const m of TRACKER_METHODS) assert.equal(typeof (/** @type {any} */ (t)[m]), 'function', m);
  assert.deepEqual(t.capabilities(), {
    closesOnMerge: true,
    claimInBranch: true,
    customFields: true,
    decisionKind: true,
    classificationEnforced: false,
    history: 'full',
  });
});

test('get returns the model’s field names, validated by the kind’s schema', () => {
  const t = open(makeRepo());
  const e = t.get('W-4');
  assert.equal(e.id, 'W-4');
  assert.equal(e.state, 'planned');
  assert.equal(e.parent, 'W-2');
  assert.deepEqual(e.needs, ['W-3']);
  assert.equal(e.classification, 'public');
  assert.equal(e.body, '\nBody.\n');
  assert.deepEqual(e.constraint_of, []);
  assert.deepEqual(e.contributes_to, []);
  assert.equal(e.released_in, null);
  assert.equal(t.get('W-6').decider, 'owner');
  // A record without an owner key is the owner's; a project has no parent.
  assert.equal(e.owner, 'owner');
  assert.equal(t.get('W-2').parent, undefined);
  assert.equal(t.get('W-1').parent, undefined, 'a long outcome: a milestone with no parent');
  const {
    body: _b,
    path: _p,
    version: _v,
    entity: _t,
    constraint_of: _c,
    contributes_to: _s,
    released_in: _r,
    ...canonical
  } = e;
  assert.deepEqual(schemas().validateTrackerEntity({ schema_version: 1, ...canonical }), []);
  assert.throws(() => t.get('W-99'), /W-99 is not in the tracker/);
});

test('query by kind, state, needs, parent and text, and the derived ready and blocked sets', () => {
  const t = open(makeRepo());
  /** @param {import('../lib/tracker/interface.mjs').Filter} f */
  const ids = (f) => t.query(f).map((e) => e.id);
  assert.deepEqual(ids({ kind: 'decision' }), ['W-6']);
  assert.deepEqual(ids({ kind: ['work', 'decision'], state: 'planned' }), ['W-4', 'W-5', 'W-6']);
  assert.deepEqual(ids({ needs: 'W-4' }), ['W-5']);
  assert.deepEqual(ids({ parent: 'W-2' }), ['W-3', 'W-4', 'W-5', 'W-6']);
  assert.deepEqual(ids({ text: 'WHICH' }), ['W-6']);
  assert.deepEqual(ids({ ready: true }), ['W-4', 'W-6']);
  assert.deepEqual(ids({ blocked: true }), ['W-5']);
  assert.deepEqual(ids({ ready: false, kind: 'work' }), ['W-3', 'W-5']);
});

test('update refuses a stale version, an unsupported field and a change that would break the check', () => {
  const root = makeRepo();
  const t = open(root);
  const v1 = String(t.get('W-4').version);
  const v2 = t.update('W-4', { title: 'Second step, renamed' }, v1);
  assert.notEqual(v1, v2);
  assert.equal(t.get('W-4').title, 'Second step, renamed');
  assert.throws(() => t.update('W-4', { title: 'Again' }, v1), /changed since it was read/);
  assert.throws(() => t.update('W-4', { touches: ['x'] }, v2), /no key for touches/);
  assert.throws(() => t.update('W-4', { priority: 'high' }, v2), /no key for priority/);
  assert.throws(() => t.update('W-4', { kind: 'decision' }, v2), /kind cannot be changed/);
  assert.throws(() => t.update('W-4', { parent: 'W-99' }, v2), /project W-99 doesn't exist/);
  assert.throws(() => t.update('W-4', { state: 'Wip' }, v2), /state "Wip" isn't one of/);
  t.update('W-4', { needs: null }, v2);
  assert.equal(t.get('W-4').needs, undefined);
  assert.equal(
    readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8').includes('needs'),
    false,
  );
});

test('transition follows the lifecycle, and Dropped records its reason', () => {
  const t = open(makeRepo());
  assert.throws(
    () => t.transition('W-3', 'planned', 'x', {}),
    /W-3 is done; the lifecycle allows no change/,
  );
  assert.throws(() => t.transition('W-4', 'dropped', ' ', {}), /dropped needs a reason/);
  assert.throws(() => t.transition('W-4', 'in-progress', 'x', {}), /claim W-4/);
  assert.throws(
    () => t.transition('W-4', 'proposed', 'x', {}),
    /allows in-progress, done, dropped/,
  );
  t.transition('W-4', 'dropped', 'not needed', {});
  assert.equal(t.get('W-4').state, 'dropped');
  assert.equal(t.get('W-4').reason, 'not needed');
  // W-5 needs the dropped W-4: the check says so, and the tracker reports it.
  assert.ok(
    t.check().problems.some((/** @type {string} */ p) => /needs W-4, which was dropped/.test(p)),
  );
});

test('link adds a need once, refuses a cycle and an unsupported relation', () => {
  const t = open(makeRepo());
  t.link('W-6', 'needs', 'W-3');
  t.link('W-6', 'needs', 'W-3');
  assert.deepEqual(t.get('W-6').needs, ['W-3']);
  assert.throws(() => t.link('W-4', 'needs', 'W-5'), /cycle: W-4 → W-5 → W-4/);
  assert.throws(() => t.link('W-4', 'needs', 'W-2'), /needs name items and milestones only/);
  assert.throws(() => t.link('W-4', 'duplicate_of', 'W-5'), /no "duplicate_of" link/);
  assert.throws(() => t.link('W-4', 'opened_from', 'W-5'), /optional_keys/);
});

test('history lists each state change with its commit', () => {
  const root = makeRepo();
  const t = open(root);
  t.transition('W-4', 'done', '', {});
  const sha = commitAll(root, 'done');
  const h = t.history('W-4');
  assert.deepEqual(
    h.map((c) => [c.from, c.to]),
    [
      [null, 'planned'],
      ['planned', 'done'],
    ],
  );
  assert.equal(h[1].ref.commit, sha);
  assert.match(h[1].at, /^\d{4}-\d\d-\d\dT/);
});

// --- ID allocation ------------------------------------------------------------------------

test('create allocates the next number, writes the reference format and passes the check', () => {
  const root = makeRepo();
  const t = open(root);
  const id = t.create({
    kind: 'work',
    title: 'Cache responses',
    parent: 'W-2',
    needs: ['W-4'],
  });
  assert.equal(id, 'W-7');
  const text = readFileSync(join(root, 'work/items/W-7-cache-responses.md'), 'utf8');
  assert.match(
    text,
    /^---\nid: W-7\ntitle: Cache responses\nkind: work\nstate: planned\ncreated: \d{4}-\d\d-\d\d\nproject: W-2\nneeds: \[W-4\]\n---\n\n## Done when\n/,
  );
  assert.equal(t.check().problems.length, 0);
  assert.equal(t.create({ kind: 'decision', title: 'Which?', parent: 'W-2' }), 'W-8');
  assert.equal(t.get('W-8').decider, 'owner');
  assert.equal(t.create({ kind: 'milestone', title: 'Big goal', constraints: ['W-1 c?'] }), 'W-9');
  assert.equal(t.get('W-9').parent, undefined);
  assert.equal(t.create({ kind: 'project', title: 'A project' }), 'W-10');
  assert.equal(t.get('W-10').owner, 'owner');
  // The default owner is not written.
  assert.doesNotMatch(readFileSync(join(root, 'work/projects/W-10-a-project.md'), 'utf8'), /owner/);
});

test('create refuses incomplete or inconsistent drafts and writes nothing', () => {
  const root = makeRepo();
  const t = open(root);
  assert.throws(() => t.create({ kind: 'work', title: 'x' }), /needs a parent/);
  assert.throws(
    () => t.create({ kind: 'work', title: 'x', parent: 'W-99' }),
    /project W-99 doesn't exist/,
  );
  assert.throws(
    () => t.create({ kind: 'external', title: 'x', parent: 'W-2' }),
    /needs waiting_on/,
  );
  assert.throws(
    () => t.create({ kind: 'work', title: 'x', parent: 'W-2', state: 'done' }),
    /planned or proposed/,
  );
  assert.throws(
    () => t.create({ kind: 'work', title: 'x', parent: 'W-2', needs: ['W-2'] }),
    /needs name items and milestones only/,
  );
  assert.throws(() => t.create({ kind: 'project', title: 'x', parent: 'W-1' }), /has no parent/);
  assert.throws(() => t.create({ kind: 'milestone', title: 'Phase 2' }), /numbers the milestone/);
  assert.throws(() => t.create({ kind: 'capability', title: 'x' }), /kind must be one of/);
  assert.throws(() => t.create({ kind: 'task', title: 'x' }), /kind must be one of/);
  assert.equal(git(root, 'status', '--porcelain').trim(), '');
});

test('only the orchestrator allocates IDs: on main, and never as an executor', () => {
  const root = makeRepo();
  git(root, 'checkout', '-q', '-b', 'exec/w-4');
  assert.throws(
    () => open(root).create({ kind: 'work', title: 'x', parent: 'W-2' }),
    /only the orchestrator creates tracker entities, on main/,
  );
  git(root, 'checkout', '-q', 'main');
  const executor = open(root, { env: { HITLD_ROLE: 'executor' } });
  assert.throws(
    () => executor.create({ kind: 'work', title: 'x', parent: 'W-2' }),
    /an executor describes new work in its report/,
  );
  git(root, 'checkout', '-q', '--detach');
  assert.throws(
    () => open(root).create({ kind: 'work', title: 'x', parent: 'W-2' }),
    /detached HEAD/,
  );
});

test('allocation counts numbers on other branches, other worktrees and bundle refs', () => {
  const root = makeRepo();
  const t = open(root);
  // A committed item on another branch.
  git(root, 'checkout', '-q', '-b', 'elsewhere');
  put(root, {
    'work/items/W-9-on-a-branch.md': itemText({
      id: 'W-9',
      title: 'On a branch',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  const bundled = commitAll(root, 'branch item');
  git(root, 'checkout', '-q', 'main');
  assert.equal(t.create({ kind: 'work', title: 'one', parent: 'W-2' }), 'W-10');
  // An uncommitted file in another worktree.
  const wt = join(tempDir('hitld-wt-'), 'wt');
  git(root, 'worktree', 'add', '-q', '-b', 'other', wt, 'main');
  put(wt, {
    'work/items/W-20-uncommitted.md': itemText({
      id: 'W-20',
      title: 'Uncommitted',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  assert.equal(t.create({ kind: 'work', title: 'two', parent: 'W-2' }), 'W-21');
  // A fetched bundle ref.
  put(wt, {
    'work/items/W-30-bundled.md': itemText({
      id: 'W-30',
      title: 'Bundled',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'x');
  git(root, 'update-ref', 'refs/bundles/example-laptop/main', git(wt, 'rev-parse', 'HEAD').trim());
  git(wt, 'checkout', '-q', '--detach');
  git(root, 'branch', '-q', '-D', 'other');
  assert.equal(t.create({ kind: 'work', title: 'three', parent: 'W-2' }), 'W-31');
  void bundled;
});

test('a second machine allocates from its reserved block, and the base range never reaches it', () => {
  const root = makeRepo();
  const policy = policyFor([{ name: 'second-machine', from: 100000 }]);
  const base = openTracker({ repoRoot: root, policy, env: { ...HOME } });
  const second = openTracker({
    repoRoot: root,
    policy,
    env: { ...HOME, HITLD_ID_BLOCK: 'second-machine' },
  });
  assert.equal(second.create({ kind: 'work', title: 'there', parent: 'W-2' }), 'W-100000');
  assert.equal(second.create({ kind: 'work', title: 'there too', parent: 'W-2' }), 'W-100001');
  // The first machine, seeing the second's items, keeps counting in its own range.
  assert.equal(base.create({ kind: 'work', title: 'here', parent: 'W-2' }), 'W-7');
  assert.equal(base.create({ kind: 'work', title: 'here too', parent: 'W-2' }), 'W-8');
  assert.equal(second.create({ kind: 'work', title: 'again', parent: 'W-2' }), 'W-100002');
  assert.equal(base.check().problems.length, 0);
  // The option works the same as the environment variable.
  assert.equal(
    openTracker({ repoRoot: root, policy, env: { ...HOME }, block: 'second-machine' }).create({
      kind: 'work',
      title: 'opt',
      parent: 'W-2',
    }),
    'W-100003',
  );
});

test('a block that is used up, or does not exist, is an error that says so', () => {
  const root = makeRepo();
  const small = openTracker({
    repoRoot: root,
    policy: policyFor([{ name: 'tiny', from: 50, to: 51 }]),
    env: { ...HOME, HITLD_ID_BLOCK: 'tiny' },
  });
  assert.equal(small.create({ kind: 'work', title: 'a', parent: 'W-2' }), 'W-50');
  assert.equal(small.create({ kind: 'work', title: 'b', parent: 'W-2' }), 'W-51');
  assert.throws(
    () => small.create({ kind: 'work', title: 'c', parent: 'W-2' }),
    /block "tiny" \(50 to 51\) is used up/,
  );
  const capped = openTracker({
    repoRoot: root,
    policy: policyFor([{ name: 'second', from: 9 }]),
    env: { ...HOME },
  });
  assert.equal(capped.create({ kind: 'work', title: 'x', parent: 'W-2' }), 'W-7');
  assert.equal(capped.create({ kind: 'work', title: 'y', parent: 'W-2' }), 'W-8');
  assert.throws(
    () => capped.create({ kind: 'work', title: 'z', parent: 'W-2' }),
    /block "base" \(1 to 8\) is used up/,
  );
  assert.throws(
    () =>
      openTracker({
        repoRoot: root,
        policy: policyFor(),
        env: { ...HOME, HITLD_ID_BLOCK: 'nope' },
      }).create({
        kind: 'work',
        title: 'q',
        parent: 'W-2',
      }),
    /no ID block named "nope"/,
  );
});

test('the check fails on a number used by two different items on different branches', () => {
  const root = makeRepo();
  git(root, 'checkout', '-q', '-b', 'machine-b');
  put(root, {
    'work/items/W-7-from-b.md': itemText({
      id: 'W-7',
      title: 'From B',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  commitAll(root, 'b');
  git(root, 'checkout', '-q', 'main');
  put(root, {
    'work/items/W-7-from-a.md': itemText({
      id: 'W-7',
      title: 'From A',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  commitAll(root, 'a');
  const t = open(root);
  assert.equal(t.check().problems.length, 0);
  const { problems } = t.check({ branches: true });
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /^W-7 is two different items: W-7-from-a\.md on .*main.*; W-7-from-b\.md on machine-b/,
  );
});

// --- Claims, closing and releasing ----------------------------------------------------

/** @param {string} root @param {string} branch @param {string} id @param {string} claimant */
function claimOn(root, branch, id, claimant) {
  git(root, 'checkout', '-q', '-b', branch, 'main');
  const ref = open(root).claim(id, claimant, branch);
  git(root, 'checkout', '-q', 'main');
  return ref;
}

test('a claim is the branch’s first commit, changes only the item file and is read from the branch', () => {
  const root = makeRepo();
  put(root, { 'work/notes.txt': 'unrelated staged change' });
  git(root, 'add', 'work/notes.txt');
  const ref = claimOn(root, 'exec/w-4', 'W-4', 'D-12');
  assert.equal(ref.branch, 'exec/w-4');
  assert.equal(git(root, 'log', '-1', '--format=%s', String(ref.commit)).trim(), 'claim: W-4');
  assert.equal(
    git(root, 'log', '-1', '--format=%b', String(ref.commit)).trim(),
    'Work-Item: W-4\nDispatch: D-12',
  );
  assert.equal(
    git(root, 'show', '--name-only', '--format=', String(ref.commit)).trim(),
    'work/items/W-4-second-step.md',
  );
  assert.equal(git(root, 'rev-list', '--count', `main..${ref.commit}`).trim(), '1');
  // The staged change was not swept into the claim.
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), 'work/notes.txt');
  git(root, 'reset', '-q');
  git(root, 'checkout', '-q', '--', '.');

  const t = open(root);
  assert.equal(t.get('W-4').state, 'planned', 'main never shows In progress');
  const claims = t.claims();
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, 'W-4');
  assert.deepEqual(
    claims[0].claims.map((/** @type {any} */ c) => [c.claimant, c.branch, c.commit, c.source]),
    [['D-12', 'exec/w-4', ref.commit, 'local']],
  );
  assert.match(String(claims[0].claims[0].at), /^\d{4}-\d\d-\d\dT/);
  assert.equal(claims[0].double, false);
  // Claimed items are no longer ready.
  assert.deepEqual(
    t.query({ ready: true }).map((e) => e.id),
    ['W-6'],
  );
  assert.deepEqual(
    t.query({ claimed: true }).map((e) => e.id),
    ['W-4'],
  );
});

test('a claim is refused on main, for an item not Planned, for a container, or one already claimed', () => {
  const root = makeRepo();
  const t = open(root);
  assert.throws(() => t.claim('W-4', 'D-1', 'main'), /never on main/);
  git(root, 'checkout', '-q', '-b', 'exec/a');
  assert.throws(
    () => t.claim('W-3', 'D-1', 'exec/a'),
    /W-3 is done; only a planned item can be claimed/,
  );
  assert.throws(() => t.claim('W-2', 'D-1', 'exec/a'), /W-2 is a project/);
  assert.throws(() => t.claim('W-4', 'D-1', 'exec/other'), /on exec\/a, not exec\/other/);
  assert.throws(() => t.claim('W-4', ' ', 'exec/a'), /needs a claimant/);
  t.claim('W-4', 'D-1', 'exec/a');
  git(root, 'checkout', '-q', '-b', 'exec/b', 'main');
  assert.throws(() => t.claim('W-4', 'D-2', 'exec/b'), /W-4 is already claimed by D-1 on exec\/a/);
});

test('closing rides with the work: merging the branch takes the item from Planned to Done on main', () => {
  const root = makeRepo();
  const ref = claimOn(root, 'exec/w-4', 'W-4', 'D-3');
  git(root, 'checkout', '-q', 'exec/w-4');
  put(root, { 'src/feature.txt': 'the work' });
  commitAll(root, 'the work');
  const t = open(root);
  assert.throws(() => t.close('W-5'), /W-5 is planned; close an item that this branch claimed/);
  const done = t.close('W-4');
  assert.equal(git(root, 'log', '-1', '--format=%s', String(done.commit)).trim(), 'close: W-4');
  assert.equal(
    git(root, 'log', '-1', '--format=%b', String(done.commit)).trim(),
    'Work-Item: W-4\nDispatch: D-3',
  );
  assert.equal(
    readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8').includes('state: done'),
    true,
  );
  assert.equal(
    readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8').includes('claimed_by: D-3'),
    true,
  );
  git(root, 'checkout', '-q', 'main');
  assert.throws(() => open(root).close('W-4'), /W-4 is planned/);
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge exec/w-4', 'exec/w-4');
  const m = open(root);
  assert.equal(m.get('W-4').state, 'done');
  assert.deepEqual(m.claims(), [], 'a Done item is no longer a claim');
  assert.deepEqual(
    m.history('W-4').map((c) => c.to),
    ['planned', 'in-progress', 'done'],
  );
  assert.equal(m.check().problems.length, 0, 'main passes the check, with no item In progress');
  assert.deepEqual(
    m.query({ ready: true }).map((e) => e.id),
    ['W-5'].filter(() => false).concat(['W-6']),
  );
  void ref;
});

test('close refuses a work item on main; a decision is closed on main', () => {
  const root = makeRepo();
  const t = open(root);
  put(root, {
    'work/items/W-4-second-step.md': readFileSync(
      join(root, 'work/items/W-4-second-step.md'),
      'utf8',
    )
      .replace('planned', 'in-progress')
      .replace('needs:', 'claimed_by: me\nneeds:'),
  });
  assert.throws(() => t.close('W-4'), /in the branch that does the work, not on main/);
  const done = t.close('W-6', { commit: false });
  assert.equal(done.commit, null);
  assert.equal(t.get('W-6').state, 'done');
});

test('an unclaim on main records why and retires the claim; main is otherwise untouched', () => {
  const root = makeRepo();
  const ref = claimOn(root, 'exec/w-4', 'W-4', 'D-5');
  const t = open(root);
  put(root, { 'work/staged.txt': 'staged' });
  git(root, 'add', 'work/staged.txt');
  assert.throws(() => t.unclaim('W-4', ' '), /needs a reason/);
  assert.throws(() => t.unclaim('W-5', 'x'), /W-5 has no live claim/);
  assert.throws(() => t.unclaim('W-4', 'x', 'exec/other'), /no live claim on exec\/other/);
  const before = git(root, 'rev-parse', 'HEAD^{tree}').trim();
  const out = t.unclaim('W-4', 'the executor stalled');
  assert.equal(git(root, 'rev-parse', 'HEAD^{tree}').trim(), before, 'an empty commit');
  assert.equal(
    git(root, 'diff', '--cached', '--name-only').trim(),
    'work/staged.txt',
    'the index is left alone',
  );
  const message = git(root, 'log', '-1', '--format=%B', out.commit);
  assert.match(
    message,
    /^unclaim: W-4\n\nReason: the executor stalled\n\nWork-Item: W-4\nClaim-Branch: exec\/w-4\nClaim-Commit: [0-9a-f]{40}/,
  );
  assert.ok(message.includes(String(ref.commit)));
  assert.deepEqual(t.claims(), []);
  assert.deepEqual(
    t.query({ ready: true }).map((e) => e.id),
    ['W-4', 'W-6'],
  );
  // The item can be claimed again, on a new branch.
  git(root, 'reset', '-q');
  git(root, 'checkout', '-q', '--', '.');
  git(root, 'clean', '-fdq');
  claimOn(root, 'exec/w-4-again', 'W-4', 'D-6');
  assert.deepEqual(
    t.claims().map((c) => c.claims.map((x) => x.branch)),
    [['exec/w-4-again']],
  );
});

test('a claim branch and an unclaim commit from before HITLD-82 still count', () => {
  const root = makeRepo();
  // A branch made before the migration: the item file holds the old keys and values.
  git(root, 'checkout', '-q', '-b', 'exec/old', 'main');
  const path = 'work/items/W-4-second-step.md';
  put(root, {
    [path]: itemText({
      id: 'W-4',
      title: 'Second step',
      kind: 'work',
      status: 'In progress',
      project: 'W-2',
      needs: ['W-3'],
      claimed: 'D-3',
    }),
  });
  git(root, 'add', path);
  git(root, 'commit', '-q', '-m', 'claim: W-4');
  const sha = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', 'main');
  const t = open(root);
  assert.deepEqual(
    t.claims().map((c) => [c.id, c.claims[0].claimant, c.claims[0].branch]),
    [['W-4', 'D-3', 'exec/old']],
  );
  // The history of a file reads its old commits in the new form.
  assert.deepEqual(
    t.history('W-4').map((c) => c.to),
    ['planned'],
  );
  // An unclaim commit made before HITLD-82 starts release:.
  git(
    root,
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'release: W-4',
    '-m',
    `Reason: old\n\nWork-Item: W-4\nClaim-Branch: exec/old\nClaim-Commit: ${sha}`,
  );
  assert.deepEqual(t.claims(), []);
});

test('an unclaim is made on main only', () => {
  const root = makeRepo();
  claimOn(root, 'exec/w-4', 'W-4', 'D-5');
  git(root, 'checkout', '-q', 'exec/w-4');
  assert.throws(() => open(root).unclaim('W-4', 'x'), /unclaim on main/);
});

test('claims from a fetched bundle ref count, and double claims and orphans are flagged by the check', () => {
  const root = makeRepo();
  claimOn(root, 'exec/w-4', 'W-4', 'D-1');
  // Another machine's claim on the same item, arriving by bundle.
  git(root, 'checkout', '-q', '-b', 'scratch', 'main');
  const text = readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8')
    .replace('planned', 'in-progress')
    .replace('needs:', 'claimed_by: D-100001\nneeds:');
  put(root, { 'work/items/W-4-second-step.md': text });
  const sha = commitAll(root, 'claim: W-4');
  git(root, 'checkout', '-q', 'main');
  git(root, 'update-ref', 'refs/bundles/example-laptop/exec/w-4', sha);
  git(root, 'branch', '-q', '-D', 'scratch');
  const t = open(root);
  const [c] = t.claims();
  assert.equal(c.double, true);
  assert.deepEqual(c.claims.map((x) => [x.claimant, x.source]).sort(), [
    ['D-1', 'local'],
    ['D-100001', 'bundle'],
  ]);
  assert.equal(t.check().problems.length, 0, 'claims are scanned with --branches or --in-flight');
  const problems = t.check({ branches: true, inflight: ['D-1', 'D-9'] }).problems;
  assert.ok(
    problems.includes(
      'W-4 is claimed twice: D-1 on exec/w-4; D-100001 on refs/bundles/example-laptop/exec/w-4',
    ),
    problems.join('\n'),
  );
  assert.ok(
    problems.some((p) =>
      /W-4 is claimed by D-100001 on .*, but that dispatch is not in flight/.test(p),
    ),
  );
  assert.ok(problems.includes('D-9 is in flight but has no claim branch'));
});

test('orphans: matching is by dispatch ID, both ways, and a person’s handle is not a dispatch', () => {
  const claims = [
    {
      id: 'W-4',
      title: 't',
      double: false,
      claims: [
        {
          claimant: 'D-1',
          branch: 'a',
          ref: 'r',
          commit: null,
          at: null,
          source: /** @type {'local'} */ ('local'),
        },
      ],
    },
    {
      id: 'W-5',
      title: 't',
      double: false,
      claims: [
        {
          claimant: 'alice',
          branch: 'b',
          ref: 'r',
          commit: null,
          at: null,
          source: /** @type {'local'} */ ('local'),
        },
      ],
    },
  ];
  assert.deepEqual(findOrphans(claims, ['D-1']), []);
  assert.deepEqual(findOrphans(claims, []), [
    'W-4 is claimed by D-1 on a, but that dispatch is not in flight (an abandoned branch?)',
  ]);
  assert.deepEqual(findOrphans(claims, ['D-1', 'D-2']), [
    'D-2 is in flight but has no claim branch',
  ]);
});

// --- Views written to files ----------------------------------------------------------------

test('views are written to the views directory, only changed files are rewritten, and --out touches nothing else', () => {
  // A view the format no longer has is removed when the views are written.
  const root = makeRepo({ files: { 'work/views/initiatives.md': 'stale\n' } });
  const t = open(root);
  const first = t.writeViews();
  assert.deepEqual(first.written.sort(), [
    'blocked.md',
    'critical-path.md',
    'decisions.md',
    'initiatives.md (removed: no longer a view)',
    'items-graph.md',
    'lists.md',
    'milestones.md',
    'projects-graph.md',
    'projects.md',
    'ready.md',
    'unreleased.md',
  ]);
  assert.equal(first.dir, join(root, 'work', 'views'));
  assert.equal(existsSync(join(first.dir, 'initiatives.md')), false);
  assert.match(
    readFileSync(join(first.dir, 'ready.md'), 'utf8'),
    /^<!-- Generated by `hitld work views`\. Never edit by hand\. -->\n\n# Ready\n\n```text\nW-2 The project\n {2}W-4 {2}Second step/,
  );
  assert.equal(t.writeViews().written.length, 0);
  const scratch = tempDir('hitld-views-');
  const status = git(root, 'status', '--porcelain');
  const out = t.writeViews({ outDir: scratch });
  assert.equal(out.dir, scratch);
  assert.equal(out.written.length, 10);
  assert.equal(git(root, 'status', '--porcelain'), status);
});

test('views regenerate the lists between the README markers when tracker.json names the file', () => {
  const root = makeRepo({
    files: {
      'work/README.md':
        '# Work\n\nIntro.\n\n<!-- work:lists:begin (old) -->\nstale\n<!-- work:lists:end -->\n\nOutro.\n',
    },
  });
  const cfg = tempDir('hitld-cfg-');
  writeFileSync(
    join(cfg, 'tracker.json'),
    JSON.stringify({ schema_version: 1, lists_readme: 'README.md' }),
  );
  const t = open(root, { configDir: cfg });
  const scratch = tempDir('hitld-views-');
  t.writeViews({ outDir: scratch });
  assert.equal(
    readFileSync(join(root, 'work/README.md'), 'utf8').includes('stale'),
    true,
    '--out leaves the README alone',
  );
  t.writeViews();
  const readme = readFileSync(join(root, 'work/README.md'), 'utf8');
  assert.match(
    readme,
    /^# Work\n\nIntro\.\n\n<!-- work:lists:begin \(generated by views\.mjs lists --write; don't edit by hand\) -->\n\n### The project\n/,
  );
  assert.match(readme, /<!-- work:lists:end -->\n\nOutro\.\n$/);
  assert.equal(readme.includes('stale'), false);
  assert.equal(t.writeViews().written.length, 0, 'regenerating changes nothing');
});

// --- The command line --------------------------------------------------------------------------

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
async function hitld(argv, cwd, env = { ...HOME }) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, out, json: out.startsWith('{') ? JSON.parse(out) : null };
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
  return dir;
}

test('hitld work check, query, show and views run from the repository', async () => {
  const root = makeRepo();
  settings(root);
  const check = await hitld(['work', 'check'], root);
  assert.equal(check.code, 0);
  // The fixture's open work items are under no milestone: a warning each, and still ok. It has no
  // private store, so no term list either, and says so (HITLD-187).
  assert.match(check.json.warnings[0], /^the private term list was not checked: /);
  assert.deepEqual(check.json, {
    ok: true,
    files: 6,
    problems: [],
    warnings: [
      check.json.warnings[0],
      'work/items/W-4-second-step.md: W-4 is open and under no milestone; make it a constraint of the milestone clause it serves',
      'work/items/W-5-third-step.md: W-5 is open and under no milestone; make it a constraint of the milestone clause it serves',
    ],
    summary: '6 files, no problems',
  });
  const q = await hitld(['work', 'query', '--ready'], root);
  assert.deepEqual(
    q.json.entities.map((/** @type {any} */ e) => e.id),
    ['W-4', 'W-6'],
  );
  assert.equal(q.json.entities[0].body, undefined);
  assert.equal(
    (
      await hitld(['work', 'query', '--kind', 'decision', '--bodies'], root)
    ).json.entities[0].body.includes('Body.'),
    true,
  );
  const show = await hitld(['work', 'show', 'W-5'], root);
  assert.deepEqual(show.json.entity.needs, ['W-4', 'W-6']);
  const view = await hitld(['work', 'views', '--view', 'blocked'], root);
  assert.match(view.json.text, /1 blocked\n$/);
  const bad = await hitld(['work', 'views', '--view', 'nope'], root);
  assert.equal(bad.code, 1);
  assert.match(bad.json.message, /no view "nope"/);
});

test('hitld work check exits 1 and lists the problems', async () => {
  const root = makeRepo({
    files: {
      'work/items/W-7-bad.md': itemText({
        id: 'W-7',
        title: 'Bad',
        kind: 'work',
        state: 'planned',
        project: 'W-99',
      }),
    },
  });
  settings(root);
  const r = await hitld(['work', 'check'], root);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.deepEqual(r.json.problems, ["work/items/W-7-bad.md: project W-99 doesn't exist"]);
  assert.equal(r.json.summary, '1 problem(s)');
});

test('hitld work new, claim, close, claims and unclaim walk the lifecycle', async () => {
  const root = makeRepo();
  settings(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'settings');
  const made = await hitld(
    ['work', 'new', '--title', 'Add a thing', '--parent', 'W-2', '--needs', 'W-3, W-4'],
    root,
  );
  assert.deepEqual(made.json, {
    ok: true,
    id: 'W-7',
    path: 'work/items/W-7-add-a-thing.md',
    block: 'base',
    id_source: 'local',
  });
  assert.equal(
    git(root, 'status', '--porcelain').includes('W-7-add-a-thing.md'),
    true,
    'new stages nothing and commits nothing',
  );
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'add W-7');

  git(root, 'checkout', '-q', '-b', 'exec/w-4');
  const claim = await hitld(
    ['work', 'claim', 'W-4', '--dispatch', 'D-7', '--branch', 'exec/w-4'],
    root,
  );
  assert.equal(claim.code, 0);
  assert.equal(claim.json.branch, 'exec/w-4');
  const refused = await hitld(['work', 'new', '--title', 'nope', '--parent', 'W-2'], root);
  assert.equal(refused.code, 1);
  assert.match(refused.json.message, /only the orchestrator/);
  const closed = await hitld(['work', 'close', 'W-4'], root);
  assert.equal(closed.code, 0);
  assert.equal(git(root, 'log', '-1', '--format=%s').trim(), 'close: W-4');

  git(root, 'checkout', '-q', 'main');
  git(root, 'checkout', '-q', '-b', 'exec/w-5', 'main');
  const decision = await hitld(['work', 'claim', 'W-6', '--dispatch', 'D-8'], root);
  assert.match(decision.json.message, /only a work item is claimed/);
  await hitld(['work', 'claim', 'W-5', '--dispatch', 'D-8'], root);
  git(root, 'checkout', '-q', 'main');
  const claims = await hitld(['work', 'claims'], root);
  assert.equal(claims.json.count, 1);
  assert.equal(claims.json.claims[0].id, 'W-5');
  const unclaimed = await hitld(['work', 'unclaim', 'W-5', '--reason', 'dispatch lost'], root);
  assert.equal(unclaimed.code, 0);
  assert.match(git(root, 'log', '-1', '--format=%s'), /^unclaim: W-5/);
  assert.equal((await hitld(['work', 'claims'], root)).json.count, 0);
  const noReason = await hitld(['work', 'unclaim', 'W-5'], root);
  assert.equal(noReason.code, 2);
  const parsed = await hitld(['work', 'close', 'W-6', '--no-commit'], root);
  assert.equal(parsed.code, 0);
  assert.equal(parsed.json.commit, null);
});

test('--repo and --config read a tracker with its settings kept outside it, writing nothing there', async () => {
  const root = makeRepo();
  const cfg = tempDir('hitld-cfg-');
  writeFileSync(
    join(cfg, 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } }),
  );
  writeFileSync(join(cfg, 'tracker.json'), JSON.stringify({ schema_version: 1 }));
  const elsewhere = tempDir('hitld-cwd-');
  const status = git(root, 'status', '--porcelain');
  const check = await hitld(
    ['work', 'check', '--repo', root, '--config', cfg, '--branches'],
    elsewhere,
  );
  assert.equal(check.json.ok, true);
  const out = tempDir('hitld-views-');
  const views = await hitld(
    ['work', 'views', '--repo', root, '--config', cfg, '--out', out],
    elsewhere,
  );
  assert.equal(views.json.written.length, 10);
  assert.equal(git(root, 'status', '--porcelain'), status);
  const missing = await hitld(['work', 'check', '--repo', root], elsewhere);
  assert.equal(missing.code, 1);
  assert.match(missing.json.message, /policy\.json/);
});

test('every command this piece owns is built', async () => {
  const { COMMANDS } = await import('../lib/cli/table.mjs');
  const mine = COMMANDS.filter((c) => c.built_by === 'a');
  assert.deepEqual(
    mine.map((c) => c.name),
    [
      'work new',
      'work show',
      'work query',
      'work claim',
      'work unclaim',
      'work close',
      'work migrate',
      'work claims',
      'work check',
      'work sweep',
      'work views',
      'work publish',
    ],
  );
  for (const c of mine) assert.equal(typeof c.run, 'function', c.name);
});

// --- Settings kept outside the repository, and symbolic links -------------------------------------

/** @param {Record<string, unknown>} [tracker] */
function configDir(tracker = {}) {
  const cfg = tempDir('hitld-cfg-');
  writeFileSync(
    join(cfg, 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } }),
  );
  writeFileSync(join(cfg, 'tracker.json'), JSON.stringify({ schema_version: 1, ...tracker }));
  return cfg;
}

test('a command that acts refuses --config; the settings must come from the repository', async () => {
  const root = makeRepo();
  const cfg = configDir();
  const elsewhere = tempDir('hitld-cwd-');
  const status = git(root, 'status', '--porcelain');
  for (const argv of [
    ['work', 'new', '--title', 'x', '--parent', 'W-2'],
    ['work', 'claim', 'W-4', '--dispatch', 'D-1'],
    ['work', 'unclaim', 'W-4', '--reason', 'x'],
    ['work', 'close', 'W-6'],
    ['work', 'views'],
  ]) {
    const r = await hitld([...argv, '--repo', root, '--config', cfg], elsewhere);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.json.message, /--config is only for read-only commands/, argv.join(' '));
  }
  assert.equal(git(root, 'status', '--porcelain'), status);
  // The read-only ones are allowed.
  for (const argv of [
    ['work', 'check'],
    ['work', 'show', 'W-4'],
    ['work', 'query', '--ready'],
    ['work', 'claims'],
    ['work', 'views', '--view', 'ready'],
  ]) {
    assert.equal(
      (await hitld([...argv, '--repo', root, '--config', cfg], elsewhere)).code,
      0,
      argv.join(' '),
    );
  }
});

test('--config with views --out needs --out outside the repository', async () => {
  const root = makeRepo();
  const cfg = configDir();
  const r = await hitld(
    ['work', 'views', '--repo', root, '--config', cfg, '--out', join(root, 'generated', 'views')],
    root,
  );
  assert.equal(r.code, 1);
  assert.match(r.json.message, /--out outside the repository/);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('the files in a --config directory must be yours, not group-writable, and not links', async () => {
  const root = makeRepo();
  const elsewhere = tempDir('hitld-cwd-');
  const args = (/** @type {string} */ cfg) => ['work', 'check', '--repo', root, '--config', cfg];

  // Owners and modes are POSIX: on Windows hitld skips those checks (policy.mjs), so only the
  // link is checked there, where this machine can create one.
  if (process.platform !== 'win32') {
    const writable = configDir();
    chmodSync(join(writable, 'policy.json'), 0o666);
    const a = await hitld(args(writable), elsewhere);
    assert.equal(a.code, 1);
    assert.match(a.json.message, /writable by group or others/);

    const writableTracker = configDir();
    chmodSync(join(writableTracker, 'tracker.json'), 0o666);
    const b = await hitld(args(writableTracker), elsewhere);
    assert.equal(b.code, 1);
    assert.match(
      b.json.message,
      /writable by group or others.*tracker\.json sets where the tracker reads and writes/,
    );
  }

  if (canSymlink) {
    const linked = configDir();
    const real = join(tempDir('hitld-real-'), 'tracker.json');
    writeFileSync(real, '{"schema_version":1}');
    rmSync(join(linked, 'tracker.json'));
    symlinkSync(real, join(linked, 'tracker.json'));
    const c = await hitld(args(linked), elsewhere);
    assert.equal(c.code, 1);
    assert.match(c.json.message, /is a symbolic link/);
  }

  if (process.platform !== 'win32') {
    const openDir = configDir();
    chmodSync(openDir, 0o777);
    const d = await hitld(args(openDir), elsewhere);
    assert.equal(d.code, 1);
    assert.match(d.json.message, /which is writable by group or others/);
  }
});

test('lists_readme is a safe relative path like the others', () => {
  const root = makeRepo();
  for (const bad of ['../outside.md', '/etc/passwd', 'a/../../b.md', 'x\\y.md']) {
    const cfg = configDir({ lists_readme: bad });
    assert.throws(() => open(root, { configDir: cfg }), /tracker\.json/, bad);
  }
  assert.doesNotThrow(() => open(root, { configDir: configDir({ lists_readme: 'README.md' }) }));
});

test(
  'the work directory, the views directory and the README are never reached through a link',
  needsSymlink,
  () => {
    const outside = tempDir('hitld-outside-');
    // A work directory that is a link out of the repository.
    const a = makeRepo({ commit: false });
    rmSync(join(a, 'work'), { recursive: true });
    symlinkSync(outside, join(a, 'work'));
    assert.throws(() => open(a), /work is a symbolic link/);

    // A views directory that is a link.
    const b = makeRepo();
    symlinkSync(outside, join(b, 'work', 'views'));
    assert.throws(() => open(b).writeViews(), /work\/views is a symbolic link/);
    assert.deepEqual(readdirSync(outside), []);

    // A README that is a link: not read, not written through.
    const c = makeRepo();
    writeFileSync(
      join(outside, 'target.md'),
      '<!-- work:lists:begin -->\nx\n<!-- work:lists:end -->\n',
    );
    symlinkSync(join(outside, 'target.md'), join(c, 'work', 'README.md'));
    const cfg = tempDir('hitld-cfg-');
    writeFileSync(
      join(cfg, 'tracker.json'),
      JSON.stringify({ schema_version: 1, lists_readme: 'README.md' }),
    );
    assert.throws(() => open(c, { configDir: cfg }), /work\/README\.md is a symbolic link/);
    assert.equal(readFileSync(join(outside, 'target.md'), 'utf8').includes('x'), true);
  },
);

test(
  'an item file or an item folder that is a link is refused, and nothing is written through it',
  needsSymlink,
  () => {
    const outside = tempDir('hitld-outside-');
    const root = makeRepo();
    const target = join(outside, 'W-7-elsewhere.md');
    writeFileSync(
      target,
      itemText({ id: 'W-7', title: 'Elsewhere', kind: 'work', state: 'planned', project: 'W-2' }),
    );
    symlinkSync(target, join(root, 'work', 'items', 'W-7-elsewhere.md'));
    const t = open(root);
    assert.deepEqual(t.check().problems, [
      'work/items/W-7-elsewhere.md: is not a regular file (a symbolic link?); item files are never followed',
    ]);
    assert.throws(() => t.get('W-7'), /not in the tracker/);

    const other = makeRepo();
    rmSync(join(other, 'work', 'items'), { recursive: true });
    symlinkSync(outside, join(other, 'work', 'items'));
    assert.throws(
      () => open(other).create({ kind: 'work', title: 'x', parent: 'W-2' }),
      /work\/items is a symbolic link/,
    );
    assert.equal(
      readdirSync(outside).filter((f) => f.startsWith('W-') && f !== 'W-7-elsewhere.md').length,
      0,
    );
  },
);

test('a plan path that leaves the repository is never probed', () => {
  const root = makeRepo({
    files: {
      'work/projects/W-2-the-project.md': itemText({
        id: 'W-2',
        title: 'The project',
        kind: 'project',
        state: 'planned',
        owner: 'owner',
        plan: '../../../etc/passwd',
      }),
    },
  });
  assert.deepEqual(open(root).check().problems, [
    "work/projects/W-2-the-project.md: plan ../../../etc/passwd doesn't exist",
  ]);
});

test('the check refuses a feedback record in the repository (design 18.4: private store only)', () => {
  const root = makeRepo({ files: { 'notes/feedback/FB-1.json': '{}' } });
  const problems = open(root).check().problems;
  assert.ok(
    problems.some((/** @type {string} */ p) =>
      /^notes\/feedback\/FB-1\.json: a feedback record is confidential/.test(p),
    ),
    problems.join('\n'),
  );
});

test('work new refused for an executor or off main returns not-permitted', async () => {
  const root = makeRepo();
  settings(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'settings');
  const args = ['work', 'new', '--title', 'X', '--parent', 'W-2'];
  const executor = await hitld(args, root, { HITLD_ROLE: 'executor' });
  assert.equal(executor.code, 1);
  assert.equal(executor.json.error, 'not-permitted');
  git(root, 'checkout', '-q', '-b', 'exec/w-4');
  const off = await hitld(args, root);
  assert.equal(off.json.error, 'not-permitted');
  git(root, 'checkout', '-q', 'main');
  const onMain = await hitld(['work', 'claim', 'W-4', '--dispatch', 'D-1'], root);
  assert.equal(onMain.json.error, 'not-permitted');
});

test('work check with no policy.json returns policy; a missing item is not-found', async () => {
  const root = makeRepo();
  const r = await hitld(['work', 'check'], root);
  assert.equal(r.code, 1);
  assert.equal(r.json.error, 'policy');
  settings(root);
  const shown = await hitld(['work', 'show', 'W-99'], root);
  assert.equal(shown.json.error, 'not-found');
});

test('work check that finds no tracker files warns and says where it looked', async () => {
  const bare = makeRepo({
    files: {
      'backlog/W-9-thing.md': itemText({
        id: 'W-9',
        title: 'Thing',
        kind: 'work',
        state: 'planned',
      }),
    },
    omit: [
      'work/milestones/W-1-goal.md',
      'work/projects/W-2-the-project.md',
      'work/items/W-3-first-step.md',
      'work/items/W-4-second-step.md',
      'work/items/W-5-third-step.md',
      'work/items/W-6-which-way.md',
    ],
  });
  settings(bare);
  git(bare, 'add', '-A');
  git(bare, 'commit', '-q', '-m', 'settings');
  const r = await hitld(['work', 'check'], bare);
  assert.equal(r.json.files, 0);
  assert.match(r.json.summary, /0 files checked/);
  const w = r.json.warnings.join('\n');
  assert.match(w, /no tracker files found in work\//);
  assert.match(w, /no tracker\.json/);
  assert.match(w, /look like tracker items.*backlog/);
});
