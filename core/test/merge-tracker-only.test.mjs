// Tracker-only merges without the owner (HITLD-871): the queue, and `hitld merge --tracker-only`,
// against a fake GitHub whose repository is a bare git remote. A merge the owner did not approve
// changes only the item its branch claimed and a decision's recorded answer; another item, a
// milestone, an added item or decision, a decision's question rewritten, a view or any other
// tracker file waits for the owner; an item promoted out of proposed is refused. The command runs
// the queue's guards (answers, symbolic links, quarantine, duplicate IDs, private terms, the head
// branch's origin, the checks) and merges with the owner's delegated sign-off, or with their own
// yes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { delegatedTrackerScope } from '../lib/merge/answers.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { emptyPullState, runPullRequestQueue } from '../lib/merge/pull-request.mjs';
import { mergeTrackerOnly } from '../lib/merge/tracker-only.mjs';
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
// What the rights flow recorded: D-1 answered "A. Yes" at AT.
const ANSWERS = [{ event: 'answered', decision: 'D-1', at: AT, text: 'A. Yes' }];

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

/** @param {string} id @param {string} state @param {string} [done] */
const work = (id, state, done = `${id} works.`) =>
  `---\nid: ${id}\ntitle: Item ${id}\nkind: work\nstate: ${state}\n---\n\n## Done when\n\n- ${done}\n`;

/** @param {string} id @param {string} [answer] @param {string} [question] */
const decision = (id, answer = '', question = 'Which?') =>
  `---\nid: ${id}\ntitle: Decision ${id}\nkind: decision\nstate: ${answer ? 'done' : 'planned'}\ndecider: owner\n${answer}---\n\n## Question\n\n${question}\n`;

/** @param {string} text */
const answered = (text) =>
  `answer: "${text}"\nanswered_at: ${AT}\nanswered_via: main-session\nanswered_by: owner\n`;

const milestone = (/** @type {string} */ text) =>
  `---\nid: M-1\ntitle: A milestone\nkind: milestone\nstate: planned\n---\n\n${text}\n`;

/**
 * A clone of a bare remote standing in for GitHub. Main holds W-1 to W-3 planned, P-1 proposed,
 * an open decision D-1 and a milestone M-1.
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
  /**
   * A branch with these files, pushed, with its pull request open.
   * @param {string} name @param {Record<string, string>} files
   * @param {{ link?: string, message?: string }} [b] link: a symbolic link added at that path
   */
  const branch = (name, files, b = {}) => {
    git(root, 'checkout', '-q', '-b', name, 'main');
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
    git(root, 'push', '-q', 'origin', name);
    git(root, 'checkout', '-q', 'main');
    return github.createPull({ head: name, base: 'main', title: `Tracker: ${name}`, body: '' });
  };
  /**
   * @param {number} number
   * @param {{ claimed?: Record<string, string>, signoff?: string | null, approved?: string,
   *   classification?: any, trackerCheck?: (dir: string) => string[], delegatedBy?: string | null }} [x]
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
        ...(x.classification ? { classification: x.classification } : {}),
        ...(x.trackerCheck ? { trackerCheck: x.trackerCheck } : {}),
      },
      policy: POLICY,
      claimedBy: (b) => x.claimed?.[b] ?? null,
      ownerSignoff: x.signoff === undefined ? OWNER : x.signoff,
      approvedSignoff: x.approved ?? null,
    });
  const mainMessage = () => git(remote, 'log', '-1', '--format=%B', 'main');
  const done = () => rmSync(base, { recursive: true, force: true });
  return { root, remote, github, checks, branch, merge, mainMessage, done };
}

test('the scope rule: only the claimed item and a recorded answer pass; anything else in the tracker waits; a promotion is refused', () => {
  const t = setup();
  try {
    const cases = {
      own: { 'work/items/W-1.md': work('W-1', 'done', 'W-1 works, and says so.') },
      another: { 'work/items/W-2.md': work('W-2', 'planned', 'Something else entirely.') },
      added: { 'work/items/W-9.md': work('W-9', 'planned') },
      milestone: { 'work/milestones/M-1.md': milestone('Rewritten.') },
      view: { 'work/views/ready.md': '# Ready\n' },
      answer: { 'work/items/D-1.md': decision('D-1', answered('A. Yes')) },
      question: { 'work/items/D-1.md': decision('D-1', answered('A. Yes'), 'Another question?') },
      newDecision: { 'work/items/D-2.md': decision('D-2', answered('A. Yes')) },
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
      });
      got[name] = { waits: r.waits.map((x) => x.path), refused: r.refused.map((x) => x.path) };
    }
    assert.deepEqual(got, {
      own: { waits: [], refused: [] },
      another: { waits: ['work/items/W-2.md'], refused: [] },
      added: { waits: ['work/items/W-9.md'], refused: [] },
      milestone: { waits: ['work/milestones/M-1.md'], refused: [] },
      view: { waits: ['work/views/ready.md'], refused: [] },
      answer: { waits: [], refused: [] },
      question: { waits: ['work/items/D-1.md'], refused: [] },
      newDecision: { waits: ['work/items/D-2.md'], refused: [] },
      promoted: { waits: [], refused: ['work/items/P-1.md'] },
    });
  } finally {
    t.done();
  }
});

test('the queue: a delegated merge changes only its own item; another item waits for the owner, and a promotion goes back', async () => {
  const t = setup();
  try {
    /** @param {string} id @param {Record<string, string>} files */
    const executor = (id, files) => {
      const name = `hitld/${id}`;
      git(t.root, 'checkout', '-q', '-b', name, 'main');
      put(t.root, { [`work/items/${id}.md`]: work(id, 'done'), ...files });
      git(t.root, 'add', '-A');
      git(t.root, 'commit', '-q', '-m', id, '-m', `Work-Item: ${id}\nAgent-Role: executor`);
      git(t.root, 'push', '-q', 'origin', name);
      git(t.root, 'checkout', '-q', 'main');
      return { item: id, branch: name };
    };
    const own = executor('W-1', {});
    const other = executor('W-2', { 'work/items/W-3.md': work('W-3', 'planned', 'Rewritten.') });
    const promote = executor('W-3', { 'work/items/P-1.md': work('P-1', 'planned') });
    const state = emptyPullState();
    state.owner_signoff = OWNER;
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
      state,
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
  } finally {
    t.done();
  }
});

test('--tracker-only: a recorded answer merges under the delegation, with the owner sign-off and Delegated-by', () => {
  const t = setup();
  try {
    const pr = t.branch('tracker/answer', {
      'work/items/D-1.md': decision('D-1', answered('A. Yes')),
    });
    const r = t.merge(pr.number);
    assert.equal(r.refused, null, JSON.stringify(r.refused));
    assert.equal(r.merged?.delegated_by, 'D-159');
    assert.equal(r.merged?.claimed, null);
    const message = t.mainMessage();
    assert.match(message, /^Tracker: tracker\/answer \(#1\)/);
    assert.match(message, /^Agent-Role: chief-of-staff$/m);
    assert.match(
      message,
      /^Signed-off-by: Owner Person <owner@example\.com>\nDelegated-by: D-159$/m,
    );
    assert.doesNotMatch(message, /Work-Item/);
    assert.match(String(r.merged?.reverse), /^git revert --no-edit /);
  } finally {
    t.done();
  }
});

test('--tracker-only: the claimed item merges; another item, a forged answer or a link waits for the owner, and their yes merges it', () => {
  const t = setup();
  try {
    const own = t.branch('hitld/W-1', { 'work/items/W-1.md': work('W-1', 'done') });
    assert.equal(t.merge(own.number, { claimed: { 'hitld/W-1': 'W-1' } }).refused, null);

    const other = t.branch('hitld/W-2', { 'work/items/W-3.md': work('W-3', 'planned', 'Hm.') });
    const waits = t.merge(other.number, { claimed: { 'hitld/W-2': 'W-2' } }).refused;
    assert.equal(waits?.code, 'waits-for-owner');
    assert.deepEqual(
      waits?.findings?.map((f) => f.path),
      ['work/items/W-3.md'],
    );
    assert.match(String(waits?.message), /item W-3 changes, and the branch claimed W-2/);

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

    // With the owner's own yes, the one that waited merges with their sign-off and no delegation.
    const yes = t.merge(other.number, { claimed: { 'hitld/W-2': 'W-2' }, approved: OWNER });
    assert.equal(yes.refused, null, JSON.stringify(yes.refused));
    assert.equal(yes.merged?.delegated_by, null);
    assert.equal(yes.merged?.approved_by_owner, true);
    assert.match(t.mainMessage(), /^Signed-off-by: Owner Person <owner@example\.com>$/m);
    assert.doesNotMatch(t.mainMessage(), /Delegated-by/);
  } finally {
    t.done();
  }
});

test('--tracker-only: a promotion out of proposed is refused under the delegation, and merges with the owner yes', () => {
  const t = setup();
  try {
    const pr = t.branch('tracker/promote', { 'work/items/P-1.md': work('P-1', 'planned') });
    const r = t.merge(pr.number).refused;
    assert.equal(r?.code, 'owner-only-state');
    assert.match(String(r?.message), /P-1 goes from proposed to planned/);
    assert.equal(t.merge(pr.number, { approved: OWNER }).refused, null);
  } finally {
    t.done();
  }
});

test('--tracker-only: code, a fork, the quarantine file, a duplicate ID, a private term and checks not green are refused', () => {
  const t = setup({
    checks: { 'tracker/red': [{ name: 'test', state: 'failure' }], 'tracker/slow': [] },
  });
  try {
    const code = t.branch('tracker/code', {
      'work/items/W-1.md': work('W-1', 'done'),
      'a.txt': 'a\n',
    });
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

    const dup = t.branch('tracker/dup', { 'work/items/W-1.md': work('W-1', 'done') });
    const d = t.merge(dup.number, {
      claimed: { 'tracker/dup': 'W-1' },
      trackerCheck: () => ['W-1 is in two files'],
    }).refused;
    assert.equal(d?.code, 'duplicate-id');

    const term = 'Example Partner Co';
    const named = t.branch('tracker/term', {
      'work/items/W-1.md': work('W-1', 'done', `Ships for ${term}.`),
    });
    const n = t.merge(named.number, {
      claimed: { 'tracker/term': 'W-1' },
      classification: {
        ceiling: 'public',
        defaultClassification: 'public',
        privatePaths: [],
        terms: compileTerms([{ term, kind: 'name', id: 'PT-1' }]),
      },
    }).refused;
    assert.equal(n?.code, 'classification');
    assert.doesNotMatch(JSON.stringify(n), new RegExp(term));

    const red = t.branch('tracker/red', { 'work/items/W-1.md': work('W-1', 'done') });
    assert.equal(
      t.merge(red.number, { claimed: { 'tracker/red': 'W-1' } }).refused?.code,
      'checks-failed',
    );
    const slow = t.branch('tracker/slow', { 'work/items/W-1.md': work('W-1', 'done') });
    assert.equal(
      t.merge(slow.number, { claimed: { 'tracker/slow': 'W-1' } }).refused?.code,
      'checks-pending',
    );

    // No sign-off of the owner's known yet, or no delegation: it is put to the owner.
    const own = t.branch('tracker/own', { 'work/items/W-1.md': work('W-1', 'done') });
    const claim = { 'tracker/own': 'W-1' };
    assert.equal(
      t.merge(own.number, { claimed: claim, signoff: null }).refused?.code,
      'no-signoff',
    );
    assert.equal(
      t.merge(own.number, { claimed: claim, delegatedBy: null }).refused?.code,
      'no-signoff',
    );
    // Nothing above merged.
    assert.equal(t.github.merges.length, 0);
  } finally {
    t.done();
  }
});

test('the command: no lease needed, executors refused, the claimed item from the ledger, the owner sign-off or their own yes', async () => {
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
    const hitld = async (argv, env = {}) => {
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
    assert.equal((await hitld(['run', 'start'])).exit, 0);
    const start = await hitld(['dispatch', 'start', 'W-1']);
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
      }),
    });
    const other = push('tracker/other', {
      'work/items/W-2-another-thing.md': item({
        id: 'W-2',
        title: 'Rewritten',
        kind: 'work',
        state: 'planned',
      }),
    });

    const executor = await hitld(['merge', '--tracker-only', String(own)], {
      HITLD_ROLE: 'executor',
      HITLD_DISPATCH: start.result.dispatch,
    });
    assert.equal(executor.result.error, 'not-permitted');

    // No sign-off of the owner's is known yet: put to the owner.
    const first = await hitld(['merge', '--tracker-only', String(own)]);
    assert.equal(first.result.error, 'no-signoff', JSON.stringify(first.result));

    const waits = await hitld(['merge', '--tracker-only', `#${other}`]);
    assert.equal(waits.result.error, 'waits-for-owner', JSON.stringify(waits.result));
    assert.deepEqual(
      waits.result.findings.map((/** @type {any} */ f) => f.item),
      ['W-2'],
    );
    // The owner's own yes merges it with their sign-off.
    const yes = await hitld(['merge', '--tracker-only', String(other), '--signoff', OWNER]);
    assert.equal(yes.exit, 0, JSON.stringify(yes.result));
    assert.equal(yes.result.merged.approved_by_owner, true);
    assert.equal(yes.result.merged.claimed, null);
    assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /^Signed-off-by: Owner/m);

    const claimed = await hitld(['merge', '--tracker-only', String(own), '--signoff', OWNER]);
    assert.equal(claimed.exit, 0, JSON.stringify(claimed.result));
    assert.equal(claimed.result.merged.claimed, 'W-1');
    assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /^Work-Item: W-1$/m);
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});
