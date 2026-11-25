// A hand-over does not leave approved merges with no orchestrator to apply them (HITLD-823): the
// hand-over names every approved or presented pull request still waiting, first in its note and
// on the lease's release; the session that handed over may still run merge-only passes for those
// and nothing else, until a successor takes the lease; the successor's resume shows them first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { handoverSelection, keepOthers } from '../lib/cli/commands/orchestrator.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { pendingMerges } from '../lib/merge/pending.mjs';
import { PULL_STATE_KEY, emptyPullState, readPullState } from '../lib/merge/pull-request.mjs';
import { PRESENTED_KEY } from '../lib/merge/owner.mjs';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { handOver, handedOverMerges, releaseLease, startRun, takeLease } from '../lib/run/run.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { memoryStore } from './helpers/memory-store.mjs';
import { STATUS_INPUT, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const A = { session: 'orch-1', host: 'example-laptop' };
const B = { session: 'orch-2', host: 'example-laptop' };

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Agent',
      GIT_AUTHOR_EMAIL: 'agent@example.com',
      GIT_COMMITTER_NAME: 'Agent',
      GIT_COMMITTER_EMAIL: 'agent@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** @param {string} branch @param {string} item @param {number} number */
const presented = (branch, item, number) => ({
  item,
  branch,
  number,
  url: `https://github.com/o/r/pull/${number}`,
  head: 'abc',
  changed: ['src/x.js'],
  checks: ['test'],
});

test('pendingMerges: approved first, then presented, from the pull-request state and the local presentation; only what still waits', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A });
  store.write(
    PULL_STATE_KEY,
    JSON.stringify({
      ...emptyPullState(),
      branches: {
        'hitld/W-1': {
          item: 'W-1',
          number: 1,
          url: 'https://github.com/o/r/pull/1',
          head: 'abc',
          since: '2026-11-22T00:00:00Z',
          updates: [],
          approval: {
            number: 1,
            head: 'abc',
            signed_off_by: 'O <o@example.com>',
            at: 'x',
            by: 'cos',
          },
        },
      },
      presented: {
        at: '2026-11-22T00:00:00Z',
        branches: [presented('hitld/W-1', 'W-1', 1), presented('hitld/W-2', 'W-2', 2)],
      },
      approved_ahead: {
        'hitld/W-4': {
          number: 4,
          head: 'def',
          signed_off_by: 'O <o@example.com>',
          at: 'x',
          by: 'cos',
        },
      },
    }),
  );
  const events = readLedger(store).events;
  assert.deepEqual(
    pendingMerges(store, events).map((x) => [x.item, x.branch, x.status, x.number]),
    [
      ['W-1', 'hitld/W-1', 'approved', 1],
      [null, 'hitld/W-4', 'approved', 4],
      ['W-2', 'hitld/W-2', 'presented', 2],
    ],
  );
  // A branch no longer waiting (merged, or sent back) is not pending.
  assert.deepEqual(
    pendingMerges(store, events, [{ branch: 'hitld/W-2' }]).map((x) => x.branch),
    ['hitld/W-2'],
  );
  // The local queue's presentation, with the owner's answer recorded against it.
  const local = memoryStore();
  startRun(local, { ...A });
  local.write(
    PRESENTED_KEY,
    JSON.stringify({
      schema_version: 1,
      at: '2026-11-22T01:00:00Z',
      base: 'b',
      commit: 'abcdef1',
      question: 'q',
      branches: [
        { item: 'W-5', branch: 'hitld/W-5' },
        { item: 'W-6', branch: 'hitld/W-6' },
      ],
    }),
  );
  appendEvent(local, {
    event: 'merge-approved',
    run: run.state.run.id,
    branches: ['hitld/W-6'],
    presented_at: '2026-11-22T01:00:00Z',
    commit: 'abcdef1',
    by: 'cos',
  });
  assert.deepEqual(
    pendingMerges(local, readLedger(local).events).map((x) => [x.item, x.status]),
    [
      ['W-6', 'approved'],
      ['W-5', 'presented'],
    ],
  );
  assert.deepEqual(pendingMerges(memoryStore(), []), []);
});

test('a hand-over names its pending merges first and on the release; only that session may still apply them, until a successor takes the lease', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A });
  const pending = [
    {
      item: 'W-1',
      branch: 'hitld/W-1',
      number: 1,
      url: null,
      status: /** @type {const} */ ('approved'),
    },
  ];
  const h = handOver(run.state, readLedger(store).events, pending);
  assert.equal(h.text.split('\n')[0], 'Merges pending (1): W-1 approved (#1).');
  assert.deepEqual(h.merges_pending, pending);
  assert.doesNotMatch(handOver(run.state, readLedger(store).events).text, /Merges pending/);

  assert.equal(handedOverMerges(store, A), null, 'the holder has not handed over');
  const at = Date.parse('2026-11-24T10:00:00Z');
  releaseLease(store, {
    ...A,
    reason: 'handover',
    branches: ['hitld/W-1'],
    now: () => new Date(at),
  });
  const released = readLedger(store).events.findLast((e) => e.event === 'lease-released');
  assert.deepEqual(released?.branches, ['hitld/W-1']);
  /** @param {number} seconds after the release */
  const after = (seconds) => () => new Date(at + seconds * 1000);
  assert.deepEqual(handedOverMerges(store, A, { now: after(60) }), {
    branches: ['hitld/W-1'],
    until: '2026-11-24T10:30:00.000Z',
    open: true,
  });
  // The window closes run.lease_expiry_seconds after the release: 1800 by default.
  assert.equal(handedOverMerges(store, A, { now: after(1800) })?.open, false);
  assert.equal(handedOverMerges(store, A, { now: after(119), windowSeconds: 120 })?.open, true);
  assert.equal(handedOverMerges(store, A, { now: after(120), windowSeconds: 120 })?.open, false);
  assert.equal(handedOverMerges(store, B), null, 'another session did not hand over');

  takeLease(store, { ...B });
  assert.equal(handedOverMerges(store, A), null, 'once a successor holds the lease, it merges');
});

test('handoverSelection: after a hand-over, --all approves only the named branches among those presented', () => {
  const named = ['hitld/W-1', 'hitld/W-2'];
  const shown = (/** @type {string[]} */ ...b) => b.map((branch) => ({ branch }));
  // Everything presented was named: --all stands.
  assert.deepEqual(
    handoverSelection(named, shown('hitld/W-1', 'hitld/W-2'), { all: true, names: null }),
    {
      all: true,
      names: null,
    },
  );
  // A branch presented that the hand-over did not name is left out.
  assert.deepEqual(
    handoverSelection(named, shown('hitld/W-1', 'hitld/W-7'), { all: true, names: null }),
    { all: false, names: ['hitld/W-1'] },
  );
  assert.throws(
    () => handoverSelection(named, shown('hitld/W-7'), { all: true, names: null }),
    /--all may approve only hitld\/W-1, hitld\/W-2/,
  );
  assert.throws(
    () => handoverSelection(named, [], { all: true, names: null }),
    /none of them is presented/,
  );
  // A list is checked against the named branches by the caller, and passes through.
  assert.deepEqual(handoverSelection(named, [], { all: false, names: ['hitld/W-2'] }), {
    all: false,
    names: ['hitld/W-2'],
  });
});

test('keepOthers: a merge-only pass keeps what the queue remembers about every branch it did not see', () => {
  const prior = {
    ...emptyPullState(),
    branches: {
      'hitld/W-1': { item: 'W-1', number: 1, url: 'u1', head: 'a', since: 's', updates: [] },
      'hitld/W-3': { item: 'W-3', number: 3, url: 'u3', head: 'c', since: 's', updates: [] },
    },
    presented: {
      at: 'then',
      branches: [presented('hitld/W-1', 'W-1', 1), presented('hitld/W-3', 'W-3', 3)],
    },
    approved_ahead: {
      'hitld/W-3': { number: 3, head: 'c', signed_off_by: 'O <o@example.com>', at: 'x', by: 'cos' },
    },
  };
  // The pass saw only W-1, merged it, and so forgot every other branch.
  const next = { ...emptyPullState(), branches: {}, presented: null, approved_ahead: {} };
  const kept = keepOthers(prior, next, new Set(['hitld/W-1']));
  assert.deepEqual(Object.keys(kept.branches), ['hitld/W-3']);
  assert.deepEqual(Object.keys(kept.approved_ahead ?? {}), ['hitld/W-3']);
  assert.deepEqual(
    kept.presented?.branches.map((b) => b.branch),
    ['hitld/W-3'],
  );
  assert.equal(kept.presented?.at, 'then');
});

test('commands: a hand-over with nothing pending says so, and the session can merge nothing after it', async () => {
  const c = makeConsumer();
  try {
    recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
    const orch1 = { env: { HITLD_SESSION: 'orch-1' } };
    assert.equal((await c.hitld(['run', 'start'], orch1)).exit, 0);
    const handed = await c.hitld(['handover'], orch1);
    assert.equal(handed.exit, 0, JSON.stringify(handed.result));
    assert.deepEqual(handed.result.merges_pending, []);
    assert.doesNotMatch(handed.result.text, /Merges pending/);
    assert.doesNotMatch(handed.result.next, /hitld merge/);
    const after = await c.hitld(['merge'], orch1);
    assert.equal(after.result.error, 'lease-released', JSON.stringify(after.result));
    const resumed = await c.hitld(['run', 'resume', '--live', 'none'], {
      env: { HITLD_SESSION: 'orch-2' },
    });
    assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
    assert.deepEqual(resumed.result.merges_pending, []);
    assert.equal(resumed.result.first, undefined);
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});

/**
 * A consumer in owner mode through pull requests, with W-1 and W-2 finished and presented, the
 * owner's approval of W-1 recorded by the chief of staff, and orch-1 handed over.
 * @param {{ onChecks?: () => void }} [o] called each time the fake GitHub is asked for checks
 */
async function handedOverWithTwo(o = {}) {
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
  const remote = join(c.base, 'remote.git');
  git(c.base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(c.root, 'remote', 'add', 'origin', remote);
  git(c.root, 'push', '-q', 'origin', 'main');
  let armed = false;
  const github = fakeGitHub({
    remote,
    checks: () => {
      if (armed) o.onChecks?.();
      return [{ name: 'test', state: 'success' }];
    },
  });
  /** @param {string[]} argv @param {string} [session] */
  const hitld = async (argv, session = 'orch-1') => {
    let out = '';
    const exit = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: c.root,
      env: { ...c.env, HITLD_SESSION: session },
      github: () => github,
    });
    return { exit, result: JSON.parse(out) };
  };
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await hitld(['run', 'start'])).exit, 0);
  /** @param {string} id @param {string} file @param {string} slug */
  const finish = async (id, file, slug) => {
    const start = await hitld(['dispatch', 'start', id]);
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    const { dispatch, branch } = start.result;
    await hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', `agent-${id}`]);
    git(c.root, 'switch', '-q', '-c', branch);
    put(c.root, {
      [`work/items/${id}-${slug}.md`]: item({
        id,
        title: id,
        kind: 'work',
        state: 'done',
        touches: [file],
      }),
      [file]: `export const x${id.slice(2)} = 1;\n`,
    });
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
    const note = join(c.base, `note-${id}.txt`);
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
  const one = await finish('W-1', 'src/calc.js', 'add-numbers');
  const two = await finish('W-2', 'src/other.js', 'another-thing');
  const shown = await hitld(['merge']);
  assert.equal(shown.exit, 0, JSON.stringify(shown.result));
  assert.deepEqual(shown.result.presented.map((/** @type {any} */ b) => b.item).sort(), [
    'W-1',
    'W-2',
  ]);
  const approved = await hitld(
    ['merge', 'approve', '--only', one, '--signoff', 'Owner Person <owner@example.com>'],
    'cos',
  );
  assert.equal(approved.exit, 0, JSON.stringify(approved.result));
  const handed = await hitld(['handover']);
  assert.equal(handed.exit, 0, JSON.stringify(handed.result));
  armed = true;
  const store = openStore(join(c.data, 'human-in-the-lead', 'orch-fixture'));
  return { c, remote, hitld, store, handed, one, two };
}

test('commands: a hand-over with an approved and a presented pull request names both first; the session merges the approved one and starts nothing; the successor sees the other first', async () => {
  const t = await handedOverWithTwo();
  const { remote, hitld, store, handed, one, two } = t;
  try {
    // The hand-over names both, approved first, in the note's first lines and on the release.
    assert.deepEqual(
      handed.result.merges_pending.map((/** @type {any} */ x) => [x.item, x.status]),
      [
        ['W-1', 'approved'],
        ['W-2', 'presented'],
      ],
    );
    const lines = readFileSync(handed.result.file, 'utf8').split('\n');
    assert.match(lines[2], /^Merges pending \(2\): W-1 approved \(#1\); W-2 presented \(#2\)\./);
    assert.match(lines[2], /may still run hitld merge for them, and nothing else/);
    assert.match(handed.result.next, /this session may still run hitld merge for W-1/);
    const release = readLedger(store).events.findLast((e) => e.event === 'lease-released');
    assert.deepEqual(release?.branches, [one, two]);

    // Merge-only: nothing else is recorded, nothing is started, nothing outside the note merges.
    assert.equal((await hitld(['run', 'checkpoint'])).result.error, 'lease-released');
    const outside = await hitld(['merge', '--only', 'hitld/W-9-elsewhere']);
    assert.equal(outside.result.error, 'lease-released', JSON.stringify(outside.result));
    assert.match(outside.result.message, /not hitld\/W-9-elsewhere/);

    const merged = await hitld(['merge']);
    assert.equal(merged.exit, 0, JSON.stringify(merged.result));
    assert.deepEqual(merged.result.merged, ['W-1']);
    assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /^Work-Item: W-1$/m);
    const events = readLedger(store).events;
    assert.ok(events.some((e) => e.event === 'merged' && e.item === 'W-1'));
    const state = JSON.parse(readFileSync(join(store.root, 'run-state.json'), 'utf8'));
    assert.ok(state.lease.released, 'the lease stays released for a successor');
    assert.equal(state.lease.session, 'orch-1');
    assert.deepEqual(
      readPullState(store).presented?.branches.map((b) => b.item),
      ['W-2'],
    );

    // The successor sees what is still pending first, and the old session can merge no more.
    const resumed = await hitld(['run', 'resume', '--live', 'none'], 'orch-2');
    assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
    assert.equal(Object.keys(resumed.result)[1], 'merges_pending');
    assert.deepEqual(
      resumed.result.merges_pending.map((/** @type {any} */ x) => [x.item, x.status]),
      [['W-2', 'presented']],
    );
    assert.match(resumed.result.first, /^Merges pending \(1\): W-2 presented/);
    assert.match(resumed.result.handover.text.split('\n')[0], /^Merges pending \(1\)/);
    const late = await hitld(['merge']);
    assert.equal(late.result.error, 'lease-lost', JSON.stringify(late.result));
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('commands: a successor taking the lease during a merge-only pass: the pass overwrites none of its state and names the merge it could not record', async () => {
  /** @type {import('../lib/store/store.mjs').PrivateStore | null} */
  let target = null;
  let taken = false;
  const t = await handedOverWithTwo({
    onChecks: () => {
      if (taken || !target) return;
      taken = true;
      takeLease(target, { session: 'orch-2', host: 'example-laptop' });
    },
  });
  const { hitld, store, handed } = t;
  target = store;
  try {
    const before = store.read(PULL_STATE_KEY);
    const merged = await hitld(['merge']);
    assert.ok(taken, 'the successor took the lease while the pass ran');
    assert.equal(merged.exit, 1, JSON.stringify(merged.result));
    assert.equal(merged.result.error, 'lease-lost', JSON.stringify(merged.result));
    assert.deepEqual(
      merged.result.merged_unrecorded.map((/** @type {any} */ m) => [m.item, m.number]),
      [['W-1', 1]],
    );
    assert.match(merged.result.message, /W-1 \(#1, [0-9a-f]{12}\)/);
    // Nothing written over the successor's state, and nothing recorded.
    assert.equal(store.read(PULL_STATE_KEY), before);
    assert.ok(!readLedger(store).events.some((e) => e.event === 'merged'));
    // The hand-over note says it, for the successor.
    assert.equal(merged.result.handover_file, handed.result.file);
    assert.match(
      readFileSync(handed.result.file, 'utf8'),
      /Merged after the hand-over but not recorded, since the lease was taken meanwhile: W-1 \(#1, /,
    );
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('commands: the merge-only window closes run.lease_expiry_seconds after the hand-over', async () => {
  const t = await handedOverWithTwo();
  try {
    const later = new Date(Date.now() + 1801 * 1000);
    let out = '';
    await main(['merge'], {
      out: (x) => (out += x),
      err: () => {},
      cwd: t.c.root,
      env: { ...t.c.env, HITLD_SESSION: 'orch-1' },
      now: () => later,
    });
    const r = JSON.parse(out);
    assert.equal(r.error, 'lease-released', out);
    assert.match(r.message, /merge-only window after its hand-over closed at/);
    assert.deepEqual(r.merges_pending, [t.one, t.two]);
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});
