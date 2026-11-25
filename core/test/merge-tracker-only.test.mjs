// Tracker-only merges without the owner (HITLD-871): the queue, and `hitld merge --tracker-only`,
// against a fake GitHub whose repository is a bare git remote. A merge the owner did not approve
// changes only the item a live dispatch on its branch claimed (never the fields that carry rights or
// ordering, never a state the claim and close flow does not set), a decision's recorded answer, and
// a decision it adds that is a choice the rights flow recorded; another item, a milestone, an added
// item, any other added decision, a decision's question rewritten, a view or any other tracker file
// waits for the owner; an item promoted out of proposed is refused. The command runs the queue's
// guards (answers, symbolic links, quarantine, duplicate IDs, private terms, the head branch's
// origin, the checks) and merges with the owner's delegated sign-off, or with their own yes as
// `hitld merge approve` recorded it for that head; only the chief of staff runs it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { delegatedTrackerScope } from '../lib/merge/answers.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { approveAhead, emptyPullState, runPullRequestQueue } from '../lib/merge/pull-request.mjs';
import { liveClaim, mergeTrackerOnly } from '../lib/merge/tracker-only.mjs';
import { checkCode } from '../lib/rights/flow.mjs';
import { decisionBody } from '../lib/tracker/files/tracker.mjs';
import { tempDir } from './helpers/tmp.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { main } from '../lib/cli/main.mjs';
import { STATUS_INPUT, item, makeConsumer } from './orchestrator-fixture.mjs';

const ID = {
  GIT_AUTHOR_NAME: 'Agent',
  GIT_AUTHOR_EMAIL: 'agent@example.com',
  GIT_COMMITTER_NAME: 'Agent',
  GIT_COMMITTER_EMAIL: 'agent@example.com',
};
const OWNER = 'Owner Person <owner@example.com>';
const POLICY = { merge: { mode: 'owner', owner_paths: ['**', '!work/**', 'work/releases/**'] } };
const AT = '2026-11-20T08:00:00.000Z';
// What the rights flow recorded: D-1 answered "A. Yes" at AT, and D-2 (a recorded choice) too.
const ANSWERS = [
  { event: 'answered', decision: 'D-1', at: AT, text: 'A. Yes' },
  { event: 'answered', decision: 'D-2', at: AT, text: 'A. Yes' },
];

/** The ask record of D-2, a choice the rights flow recorded, true to its own check code. */
const D2_ASKED = (() => {
  const rec = {
    deciders: ['owner'],
    area: null,
    basis: null,
    classification: 'public',
    offer: null,
    title: 'Decision D-2',
    question: 'Ship it this week?',
    context: 'The owner chose in conversation.',
    options: [
      { label: 'Yes', what_happens: 'it ships' },
      { label: 'No', what_happens: 'it waits' },
    ],
    recommendation: { option: 'A', why: 'It is ready.' },
  };
  return { ...rec, check: checkCode(rec) };
})();

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

/** @param {string} id @param {string} state @param {string} [done] @param {string} [extra] front matter lines */
const work = (id, state, done = `${id} works.`, extra = '') =>
  `---\nid: ${id}\ntitle: Item ${id}\nkind: work\nstate: ${state}\n${extra}---\n\n## Done when\n\n- ${done}\n`;

/** @param {string} id @param {string} [answer] @param {string} [question] */
const decision = (id, answer = '', question = 'Which?') =>
  `---\nid: ${id}\ntitle: Decision ${id}\nkind: decision\nstate: ${answer ? 'done' : 'planned'}\ndecider: owner\n${answer}---\n\n## Question\n\n${question}\n`;

/** @param {string} text @param {string} [by] */
const answered = (text, by = 'owner') =>
  `answer: "${text}"\nanswered_at: ${AT}\nanswered_via: main-session\nanswered_by: ${by}\n`;

/** D-2 as the rights flow writes a recorded choice: its body rendered from the ask record. */
const recordedChoice = (body = decisionBody(D2_ASKED), by = 'owner') =>
  `---\nid: D-2\ntitle: Decision D-2\nkind: decision\nstate: done\ndecider: owner\n${answered('A. Yes', by)}---\n${body}`;

const milestone = (/** @type {string} */ text) =>
  `---\nid: M-1\ntitle: A milestone\nkind: milestone\nstate: planned\n---\n\n${text}\n`;

/** W-1 as its claim and close leave it, claimed by D-1. @param {string} [done] @param {string} [extra] */
const ownDone = (done, extra = '') => work('W-1', 'done', done, `claimed_by: D-1\n${extra}`);

/**
 * A clone of a bare remote standing in for GitHub. Main holds W-1 to W-3 planned, P-1 proposed,
 * an open decision D-1 and a milestone M-1. `state` is the queue's state the command reads: the
 * owner's sign-off is known, and approvals are recorded with `approve`.
 * @param {{ checks?: Record<string, import('../lib/merge/github.mjs').Check[]> }} [o]
 */
function setup(o = {}) {
  const base = realpathSync(tempDir('hitld-tracker-only-'));
  const remote = join(base, 'remote.git');
  const root = join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'clone', '-q', remote, root);
  git(root, 'checkout', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Orchestrator');
  git(root, 'config', 'user.email', 'orchestrator@example.com');
  put(root, {
    'shared.txt': 'one\n',
    'work/items/W-1.md': work('W-1', 'planned'),
    'work/items/W-2.md': work('W-2', 'planned'),
    'work/items/W-3.md': work('W-3', 'planned'),
    'work/items/P-1.md': work('P-1', 'proposed'),
    'work/items/D-1.md': decision('D-1'),
    'work/milestones/M-1.md': milestone('First.'),
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  git(root, 'push', '-q', 'origin', 'main');
  const checks = o.checks ?? {};
  const github = fakeGitHub({
    remote,
    checks: ({ branch }) => checks[branch] ?? [{ name: 'test', state: 'success' }],
  });
  const state = emptyPullState();
  state.owner_signoff = OWNER;
  /**
   * A branch with these files, pushed, with its pull request open.
   * @param {string} name @param {Record<string, string>} files
   * @param {{ link?: string, message?: string }} [b] link: a symbolic link added at that path
   */
  const branch = (name, files, b = {}) => {
    git(root, 'checkout', '-q', '-B', name, 'main');
    put(root, files);
    if (b.link) {
      mkdirSync(dirname(join(root, b.link)), { recursive: true });
      symlinkSync('../../shared.txt', join(root, b.link));
    }
    git(root, 'add', '-A');
    git(
      root,
      'commit',
      '-q',
      '-m',
      b.message ?? `Tracker: ${name}`,
      '-m',
      'Agent-Role: chief-of-staff',
    );
    git(root, 'push', '-q', '-f', 'origin', name);
    git(root, 'checkout', '-q', 'main');
    return github.createPull({ head: name, base: 'main', title: `Tracker: ${name}`, body: '' });
  };
  /** The owner's yes to a pull request's head, as hitld merge approve --head records it. */
  const approve = (/** @type {{ number: number }} */ pr, /** @type {string} */ name) => {
    const pull = github.findPull(name, 'main');
    const r = approveAhead({
      state,
      branch: name,
      head: git(remote, 'rev-parse', name),
      pull,
      signedOffBy: OWNER,
      by: 'chief-of-staff',
      at: AT,
    });
    assert.equal(r.refused, null);
    assert.equal(pull?.number, pr.number);
  };
  /**
   * @param {number} number
   * @param {{ claim?: Record<string, { item: string, dispatch: string }>, classification?: any,
   *   trackerCheck?: (dir: string) => string[], delegatedBy?: string | null,
   *   asked?: Record<string, any> }} [x]
   */
  const merge = (number, x = {}) =>
    mergeTrackerOnly({
      repoRoot: root,
      number,
      github,
      settings: {
        mainBranch: 'main',
        remote: 'origin',
        checks: ['test'],
        workDir: 'work',
        answers: ANSWERS,
        delegatedBy: x.delegatedBy === undefined ? 'D-159' : x.delegatedBy,
        asked: (id) => x.asked?.[id] ?? null,
        ...(x.classification ? { classification: x.classification } : {}),
        ...(x.trackerCheck ? { trackerCheck: x.trackerCheck } : {}),
      },
      policy: POLICY,
      claimOf: (b) => x.claim?.[b] ?? null,
      state,
    });
  const mainMessage = () => git(remote, 'log', '-1', '--format=%B', 'main');
  const done = () => rmSync(base, { recursive: true, force: true });
  return { root, remote, github, checks, state, branch, approve, merge, mainMessage, done };
}

test('the scope rule: the claimed item within its claim and close, a recorded answer and a recorded choice pass; anything else waits; a promotion is refused', () => {
  const t = setup();
  try {
    const cases = {
      own: { 'work/items/W-1.md': work('W-1', 'done', 'W-1 works, and says so.') },
      ownConstraint: { 'work/items/W-1.md': work('W-1', 'done', 'x', 'constraint_of: [M-1 c1]\n') },
      ownProject: { 'work/items/W-1.md': work('W-1', 'done', 'x', 'project: P-9\n') },
      ownNeeds: { 'work/items/W-1.md': work('W-1', 'done', 'x', 'needs: [W-2]\n') },
      ownHolds: { 'work/items/W-1.md': work('W-1', 'done', 'x', 'holds: [W-3]\n') },
      ownDropped: { 'work/items/W-1.md': work('W-1', 'dropped', 'x', 'reason: no\n') },
      another: { 'work/items/W-2.md': work('W-2', 'planned', 'Something else entirely.') },
      added: { 'work/items/W-9.md': work('W-9', 'planned') },
      milestone: { 'work/milestones/M-1.md': milestone('Rewritten.') },
      view: { 'work/views/ready.md': '# Ready\n' },
      answer: { 'work/items/D-1.md': decision('D-1', answered('A. Yes')) },
      question: { 'work/items/D-1.md': decision('D-1', answered('A. Yes'), 'Another question?') },
      choice: { 'work/items/D-2.md': recordedChoice() },
      choiceRewritten: {
        'work/items/D-2.md': recordedChoice(decisionBody({ ...D2_ASKED, question: 'Ship it?' })),
      },
      choiceNotOwner: { 'work/items/D-2.md': recordedChoice(undefined, 'chief-of-staff') },
      newDecision: { 'work/items/D-3.md': decision('D-3', answered('A. Yes')) },
      promoted: { 'work/items/P-1.md': work('P-1', 'planned') },
    };
    /** @type {Record<string, { waits: string[], refused: string[] }>} */
    const got = {};
    for (const [name, files] of Object.entries(cases)) {
      t.branch(`t/${name}`, files);
      const head = git(t.root, 'rev-parse', `t/${name}`);
      const base = git(t.root, 'merge-base', 'main', head);
      const r = delegatedTrackerScope({
        dir: t.root,
        base,
        head,
        paths: Object.keys(files),
        claimed: 'W-1',
        asked: (id) => (id === 'D-2' ? D2_ASKED : null),
      });
      got[name] = { waits: r.waits.map((x) => x.path), refused: r.refused.map((x) => x.path) };
    }
    const w1 = { waits: ['work/items/W-1.md'], refused: [] };
    assert.deepEqual(got, {
      own: { waits: [], refused: [] },
      ownConstraint: w1,
      ownProject: w1,
      ownNeeds: w1,
      ownHolds: w1,
      ownDropped: w1,
      another: { waits: ['work/items/W-2.md'], refused: [] },
      added: { waits: ['work/items/W-9.md'], refused: [] },
      milestone: { waits: ['work/milestones/M-1.md'], refused: [] },
      view: { waits: ['work/views/ready.md'], refused: [] },
      answer: { waits: [], refused: [] },
      question: { waits: ['work/items/D-1.md'], refused: [] },
      choice: { waits: [], refused: [] },
      choiceRewritten: { waits: ['work/items/D-2.md'], refused: [] },
      choiceNotOwner: { waits: ['work/items/D-2.md'], refused: [] },
      newDecision: { waits: ['work/items/D-3.md'], refused: [] },
      promoted: { waits: [], refused: ['work/items/P-1.md'] },
    });
  } finally {
    t.done();
  }
});

test('the queue: a delegated merge changes only its own item within its claim and close; anything more waits for the owner, and a promotion goes back', async () => {
  const t = setup();
  try {
    /** @param {string} id @param {Record<string, string>} files @param {string} [extra] */
    const executor = (id, files, extra = '') => {
      const name = `hitld/${id}`;
      git(t.root, 'checkout', '-q', '-B', name, 'main');
      put(t.root, { [`work/items/${id}.md`]: work(id, 'done', undefined, extra), ...files });
      git(t.root, 'add', '-A');
      git(t.root, 'commit', '-q', '-m', id, '-m', `Work-Item: ${id}\nAgent-Role: executor`);
      git(t.root, 'push', '-q', '-f', 'origin', name);
      git(t.root, 'checkout', '-q', 'main');
      return { item: id, branch: name };
    };
    const own = executor('W-1', {});
    const other = executor('W-2', { 'work/items/W-3.md': work('W-3', 'planned', 'Rewritten.') });
    const promote = executor('W-3', { 'work/items/P-1.md': work('P-1', 'planned') });
    const r = await runPullRequestQueue({
      repoRoot: t.root,
      entries: [own, other, promote],
      settings: {
        mainBranch: 'main',
        remote: 'origin',
        checks: ['test'],
        checkTimeoutMinutes: 60,
        generated: [],
        delegatedBy: 'D-159',
        itemAt: (_dir, id) => ({ state: 'done', title: `Item ${id}`, body: '' }),
      },
      policy: POLICY,
      github: t.github,
      state: t.state,
    });
    assert.deepEqual(
      r.merged.map((m) => [m.item, m.delegated_by]),
      [['W-1', 'D-159']],
    );
    assert.deepEqual(
      r.awaiting_owner.map((x) => [x.item, (x.outside_claim ?? []).map((f) => f.path)]),
      [['W-2', ['work/items/W-3.md']]],
    );
    assert.deepEqual(
      r.rejected.map((x) => [x.item, x.reason, x.files]),
      [['W-3', 'owner_state', ['work/items/P-1.md']]],
    );
    assert.match(String(r.rejected[0].message), /P-1 goes from proposed to planned/);

    // An executor branch that changes its own item's constraint_of waits for the owner.
    git(t.root, 'fetch', '-q', 'origin');
    const reordered = executor('W-2', {}, 'constraint_of: [M-1 c1]\n');
    const again = await runPullRequestQueue({
      repoRoot: t.root,
      entries: [{ ...reordered, branch: 'hitld/W-2' }],
      settings: {
        mainBranch: 'main',
        remote: 'origin',
        checks: ['test'],
        checkTimeoutMinutes: 60,
        generated: [],
        delegatedBy: 'D-159',
        itemAt: (_dir, id) => ({ state: 'done', title: `Item ${id}`, body: '' }),
      },
      policy: POLICY,
      github: t.github,
      state: emptyPullState(),
    });
    assert.deepEqual(
      again.awaiting_owner.flatMap((x) => (x.outside_claim ?? []).map((f) => f.why)),
      ['W-2, the claimed item, changes beyond its claim and close: its constraint_of changes'],
    );
  } finally {
    t.done();
  }
});

test('--tracker-only: a recorded answer and a recorded choice merge under the delegation, with the owner sign-off and Delegated-by', () => {
  const t = setup();
  try {
    const pr = t.branch('tracker/answer', {
      'work/items/D-1.md': decision('D-1', answered('A. Yes')),
    });
    const r = t.merge(pr.number);
    assert.equal(r.refused, null, JSON.stringify(r.refused));
    assert.equal(r.merged?.delegated_by, 'D-159');
    assert.equal(r.merged?.claimed, null);
    assert.equal(r.merged?.approval, null);
    const message = t.mainMessage();
    assert.match(message, /^Tracker: tracker\/answer \(#1\)/);
    assert.match(message, /^Agent-Role: chief-of-staff$/m);
    assert.match(
      message,
      /^Signed-off-by: Owner Person <owner@example\.com>\nDelegated-by: D-159$/m,
    );
    assert.doesNotMatch(message, /Work-Item/);
    assert.match(String(r.merged?.reverse), /^git revert --no-edit /);

    // A choice the chief of staff recorded and published: the ask record and the answer agree.
    git(t.root, 'fetch', '-q', 'origin');
    git(t.root, 'reset', '-q', '--hard', 'origin/main');
    const choice = t.branch('tracker/choice', { 'work/items/D-2.md': recordedChoice() });
    const c = t.merge(choice.number, { asked: { 'D-2': D2_ASKED } });
    assert.equal(c.refused, null, JSON.stringify(c.refused));
    assert.equal(c.merged?.delegated_by, 'D-159');
  } finally {
    t.done();
  }
});

test('--tracker-only: a choice whose text is not the one recorded, or with no ask record, waits for the owner', () => {
  const t = setup();
  try {
    const off = t.branch('tracker/off', {
      'work/items/D-2.md': recordedChoice(`${decisionBody(D2_ASKED)}\nAlso: do something else.\n`),
    });
    const r = t.merge(off.number, { asked: { 'D-2': D2_ASKED } }).refused;
    assert.equal(r?.code, 'waits-for-owner');
    assert.match(String(r?.message), /its body is not the question recorded asking it/);
    const none = t.merge(off.number).refused;
    assert.match(String(none?.message), /no question under its ID is recorded as asked/);
    assert.equal(t.github.merges.length, 0);
  } finally {
    t.done();
  }
});

test('--tracker-only: the claimed item merges; another item, a forged answer or a link waits; only the owner recorded yes for that head merges it', () => {
  const t = setup();
  try {
    const claim = { item: 'W-1', dispatch: 'D-1' };
    const own = t.branch('hitld/W-1', { 'work/items/W-1.md': ownDone() });
    const ok = t.merge(own.number, { claim: { 'hitld/W-1': claim } });
    assert.equal(ok.refused, null, JSON.stringify(ok.refused));
    assert.equal(ok.merged?.claimed, 'W-1');
    git(t.root, 'fetch', '-q', 'origin');
    git(t.root, 'reset', '-q', '--hard', 'origin/main');

    const other = t.branch('hitld/W-2', { 'work/items/W-3.md': work('W-3', 'planned', 'Hm.') });
    const otherClaim = { 'hitld/W-2': { item: 'W-2', dispatch: 'D-2' } };
    const waits = t.merge(other.number, { claim: otherClaim }).refused;
    assert.equal(waits?.code, 'waits-for-owner');
    assert.deepEqual(
      waits?.findings?.map((f) => f.path),
      ['work/items/W-3.md'],
    );
    assert.match(
      String(waits?.message),
      /hitld merge approve --only hitld\/W-2 --head [0-9a-f]{40}/,
    );

    const forged = t.branch('tracker/forged', {
      'work/items/D-1.md': decision('D-1', answered('B. No')),
    });
    const f = t.merge(forged.number).refused;
    assert.equal(f?.code, 'waits-for-owner');
    assert.deepEqual(
      f?.findings?.map((x) => x.why),
      ['its answer differs from the one recorded'],
    );

    const link = t.branch('tracker/link', {}, { link: 'work/items/L-1.md' });
    const l = t.merge(link.number).refused;
    assert.equal(l?.code, 'waits-for-owner');
    assert.ok(l?.findings?.some((x) => x.why === 'a symbolic link is added, changed or removed'));

    // The owner's yes, recorded for the head, then the branch moves: the yes does not hold.
    t.approve(other, 'hitld/W-2');
    t.branch('hitld/W-2', {
      'work/items/W-3.md': work('W-3', 'planned', 'Something the owner never saw.'),
    });
    const moved = t.merge(other.number, { claim: otherClaim }).refused;
    assert.equal(moved?.code, 'waits-for-owner');
    assert.match(String(moved?.message), /was of another head: the branch moved since/);

    // Recorded again for the head as it is: it merges with their sign-off and no delegation, and
    // the approval is reported used.
    t.approve(other, 'hitld/W-2');
    const yes = t.merge(other.number, { claim: otherClaim });
    assert.equal(yes.refused, null, JSON.stringify(yes.refused));
    assert.equal(yes.merged?.delegated_by, null);
    assert.equal(yes.merged?.approved_by_owner, true);
    assert.equal(yes.merged?.approval?.source, 'ahead');
    assert.match(t.mainMessage(), /^Signed-off-by: Owner Person <owner@example\.com>$/m);
    assert.doesNotMatch(t.mainMessage(), /Delegated-by/);
  } finally {
    t.done();
  }
});

test('--tracker-only: a promotion out of proposed is refused under the delegation, and merges with the owner recorded yes', () => {
  const t = setup();
  try {
    const pr = t.branch('tracker/promote', { 'work/items/P-1.md': work('P-1', 'planned') });
    const r = t.merge(pr.number).refused;
    assert.equal(r?.code, 'owner-only-state');
    assert.match(String(r?.message), /P-1 goes from proposed to planned/);
    t.approve(pr, 'tracker/promote');
    assert.equal(t.merge(pr.number).refused, null);
  } finally {
    t.done();
  }
});

test('a claim: only a live dispatch on the branch, and only when the branch itself holds that claim', () => {
  const dispatched = (/** @type {string} */ d, /** @type {string} */ item) => ({
    event: 'dispatched',
    dispatch: d,
    item,
    branch: 'hitld/W-1',
  });
  assert.deepEqual(liveClaim([dispatched('D-1', 'W-1')], 'hitld/W-1'), {
    item: 'W-1',
    dispatch: 'D-1',
  });
  assert.equal(liveClaim([dispatched('D-1', 'W-1')], 'hitld/W-2'), null);
  // Its item merged: a branch pushed later under the same name claims nothing.
  assert.equal(
    liveClaim([dispatched('D-1', 'W-1'), { event: 'merged', item: 'W-1' }], 'hitld/W-1'),
    null,
  );
  assert.equal(
    liveClaim([dispatched('D-1', 'W-1'), { event: 'abandoned', dispatch: 'D-1' }], 'hitld/W-1'),
    null,
  );
  // A later dispatch on the branch (a follow-up) is the live one.
  assert.deepEqual(
    liveClaim(
      [dispatched('D-1', 'W-1'), { event: 'abandoned', dispatch: 'D-1' }, dispatched('D-2', 'W-1')],
      'hitld/W-1',
    ),
    { item: 'W-1', dispatch: 'D-2' },
  );

  // A live dispatch whose claim the branch does not hold (its item file names another claimant):
  // the branch claims nothing, and its change to the item waits.
  const t = setup();
  try {
    const pr = t.branch('hitld/W-1', {
      'work/items/W-1.md': work('W-1', 'done', undefined, 'claimed_by: D-9\n'),
    });
    const r = t.merge(pr.number, { claim: { 'hitld/W-1': { item: 'W-1', dispatch: 'D-1' } } });
    assert.equal(r.refused?.code, 'waits-for-owner');
    assert.match(String(r.refused?.message), /no dispatch claimed an item on this branch/);
  } finally {
    t.done();
  }
});

test('--tracker-only: code, a fork, the quarantine file, a duplicate ID, a private term and checks not green are refused', () => {
  const t = setup({
    checks: { 'tracker/red': [{ name: 'test', state: 'failure' }], 'tracker/slow': [] },
  });
  try {
    /** @param {string} b */
    const claimOn = (b) => ({ [b]: { item: 'W-1', dispatch: 'D-1' } });
    const code = t.branch('tracker/code', { 'work/items/W-1.md': ownDone(), 'a.txt': 'a\n' });
    const c = t.merge(code.number).refused;
    assert.equal(c?.code, 'not-tracker-only');
    assert.deepEqual(c?.files, ['a.txt']);

    const quarantine = t.branch('tracker/quarantine', {
      '.human-in-the-lead/quarantine.json': '{}\n',
    });
    assert.equal(t.merge(quarantine.number).refused?.code, 'not-tracker-only');

    const fork = t.branch('tracker/fork', {
      'work/items/D-1.md': decision('D-1', answered('A. Yes')),
    });
    const p = t.github.pulls.find((x) => x.number === fork.number);
    if (p) p.head_repo = 'stranger/project';
    assert.equal(t.merge(fork.number).refused?.code, 'foreign-head');

    const dup = t.branch('tracker/dup', { 'work/items/W-1.md': ownDone() });
    const d = t.merge(dup.number, {
      claim: claimOn('tracker/dup'),
      trackerCheck: () => ['W-1 is in two files'],
    }).refused;
    assert.equal(d?.code, 'duplicate-id');

    const term = 'Example Partner Co';
    const named = t.branch('tracker/term', { 'work/items/W-1.md': ownDone(`Ships for ${term}.`) });
    const n = t.merge(named.number, {
      claim: claimOn('tracker/term'),
      classification: {
        ceiling: 'public',
        defaultClassification: 'public',
        privatePaths: [],
        terms: compileTerms([{ term, kind: 'name', id: 'PT-1' }]),
      },
    }).refused;
    assert.equal(n?.code, 'classification');
    assert.doesNotMatch(JSON.stringify(n), new RegExp(term));

    const red = t.branch('tracker/red', { 'work/items/W-1.md': ownDone() });
    assert.equal(
      t.merge(red.number, { claim: claimOn('tracker/red') }).refused?.code,
      'checks-failed',
    );
    const slow = t.branch('tracker/slow', { 'work/items/W-1.md': ownDone() });
    assert.equal(
      t.merge(slow.number, { claim: claimOn('tracker/slow') }).refused?.code,
      'checks-pending',
    );

    // No sign-off of the owner's known yet, or no delegation: it is put to the owner.
    const own = t.branch('tracker/own', { 'work/items/W-1.md': ownDone() });
    assert.equal(
      t.merge(own.number, { claim: claimOn('tracker/own'), delegatedBy: null }).refused?.code,
      'no-signoff',
    );
    t.state.owner_signoff = null;
    assert.equal(
      t.merge(own.number, { claim: claimOn('tracker/own') }).refused?.code,
      'no-signoff',
    );
    // Nothing above merged.
    assert.equal(t.github.merges.length, 0);
  } finally {
    t.done();
  }
});

test('the command: the chief of staff only, no lease, the claim from the ledger, no --signoff, and the owner yes only as hitld merge approve recorded it', async () => {
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'owner',
        via: 'pull-request',
        owner_paths: ['**', '!work/**'],
        pull_request: { checks: ['test'], delegated_by: 'W-159' },
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
    /** @param {string[]} argv @param {Record<string, string>} [env] */
    const hitld = async (argv, env = { HITLD_ROLE: 'chief-of-staff' }) => {
      let out = '';
      const exit = await main(argv, {
        out: (s) => (out += s),
        err: () => {},
        cwd: c.root,
        env: { ...c.env, ...env },
        github: () => github,
      });
      return { exit, result: JSON.parse(out) };
    };
    recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
    assert.equal((await hitld(['run', 'start'], {})).exit, 0);
    const start = await hitld(['dispatch', 'start', 'W-1'], {});
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    const branch = start.result.branch;
    /** @param {string} name @param {Record<string, string>} files */
    const push = (name, files) => {
      git(c.root, 'switch', '-q', '-c', name, 'main');
      put(c.root, files);
      git(c.root, 'add', '-A');
      git(c.root, 'commit', '-q', '--no-verify', '-m', name);
      git(c.root, 'push', '-q', 'origin', name);
      git(c.root, 'switch', '-q', 'main');
      return github.createPull({ head: name, base: 'main', title: name, body: '' }).number;
    };
    const own = push(branch, {
      'work/items/W-1-add-numbers.md': item({
        id: 'W-1',
        title: 'Add numbers',
        kind: 'work',
        state: 'done',
        touches: ['src/calc.js'],
        claimed_by: start.result.dispatch,
      }),
    });
    const other = push('tracker/other', {
      'work/items/W-2-another-thing.md': item({
        id: 'W-2',
        title: 'Rewritten',
        kind: 'work',
        state: 'planned',
        touches: ['src/other.js'],
      }),
    });

    const executor = await hitld(['merge', '--tracker-only', String(own)], {
      HITLD_ROLE: 'executor',
      HITLD_DISPATCH: start.result.dispatch,
    });
    assert.equal(executor.result.error, 'not-permitted');
    // An orchestrator, or a session that names no role, may not: the right is the chief of staff's.
    for (const env of /** @type {Record<string, string>[]} */ ([
      { HITLD_ROLE: 'orchestrator' },
      {},
    ])) {
      const r = await hitld(['merge', '--tracker-only', String(own)], env);
      assert.equal(r.result.error, 'not-permitted', JSON.stringify(r.result));
      assert.match(r.result.message, /the chief of staff's right/);
    }
    const byFlag = await hitld(
      ['merge', '--tracker-only', String(own), '--role', 'chief-of-staff'],
      {},
    );
    assert.notEqual(byFlag.result.error, 'not-permitted');

    // A bare --signoff is no yes of the owner's: refused, nothing merged.
    const bare = await hitld(['merge', '--tracker-only', String(other), '--signoff', OWNER]);
    assert.equal(bare.result.error, 'usage', JSON.stringify(bare.result));
    assert.equal(github.merges.length, 0);

    // No sign-off of the owner's is known yet: put to the owner.
    const first = await hitld(['merge', '--tracker-only', String(own)]);
    assert.equal(first.result.error, 'no-signoff', JSON.stringify(first.result));

    const waits = await hitld(['merge', '--tracker-only', `#${other}`]);
    assert.equal(waits.result.error, 'waits-for-owner', JSON.stringify(waits.result));
    assert.deepEqual(
      waits.result.findings.map((/** @type {any} */ f) => f.item),
      ['W-2'],
    );
    // The owner's own yes, recorded for that head: it merges with their sign-off, and the
    // approval is used.
    const head = git(remote, 'rev-parse', 'tracker/other');
    const approved = await hitld([
      'merge',
      'approve',
      '--only',
      'tracker/other',
      '--head',
      head,
      '--signoff',
      OWNER,
    ]);
    assert.equal(approved.exit, 0, JSON.stringify(approved.result));
    const yes = await hitld(['merge', '--tracker-only', String(other)]);
    assert.equal(yes.exit, 0, JSON.stringify(yes.result));
    assert.equal(yes.result.merged.approved_by_owner, true);
    assert.equal(yes.result.merged.claimed, null);
    assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /^Signed-off-by: Owner/m);

    // That yes also recorded the owner's sign-off, so the claimed item now merges under the
    // delegation, its claim taken from the ledger.
    const claimed = await hitld(['merge', '--tracker-only', String(own)]);
    assert.equal(claimed.exit, 0, JSON.stringify(claimed.result));
    assert.equal(claimed.result.merged.claimed, 'W-1');
    assert.equal(claimed.result.merged.delegated_by, 'W-159');
    assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /^Work-Item: W-1$/m);
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});
