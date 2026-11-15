import { approvalSummary, chooseNamed, evidenceFor, queueProposals } from '../lib/merge/owner.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store/store.mjs';
import { readTrustEvents } from '../lib/rights/trust.mjs';
import { SURFACE_PATHS } from '../lib/release/surface.mjs';
import { matchesAny } from '../lib/precedent/glob.mjs';
import { MERGE_SETTINGS, commitAll, fixtureGit } from '../lib/eval/orchestrator-fixtures.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { buildReport, renderDigest } from '../lib/quota/report.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const minimal = { schema_version: 1, project: { id: 'test', key: 'W' } };

test('merge.mode: owner by default, owner accepted, anything else refused', () => {
  assert.equal(resolvePolicy(minimal).policy?.merge.mode, 'owner');
  assert.equal(resolvePolicy({ ...minimal, merge: { mode: 'queue' } }).policy?.merge.mode, 'queue');
  assert.equal(resolvePolicy({ ...minimal, merge: { mode: 'owner' } }).policy?.merge.mode, 'owner');
  const bad = resolvePolicy({ ...minimal, merge: { mode: 'auto' } });
  assert.equal(bad.policy, null);
  assert.ok(bad.errors.some((e) => e.path === 'merge.mode'));
});

/**
 * An owner-mode consumer with W-1 and W-2 finished and verified on their branches.
 * W-2's branch adds bad.txt, which the fast check refuses, unless `green`.
 * @param {string} [mode] @param {{ green?: boolean, merge?: Record<string, unknown> }} [o]
 */
async function ownerConsumer(mode = 'owner', o = {}) {
  const c = makeConsumer({
    policy: {
      merge: {
        mode,
        fast_checks: ['test ! -f bad.txt'],
        full_suite: ["node --test 'test/*.test.js'"],
        ...(o.merge ?? {}),
      },
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  /** @type {Record<string, string>} */
  const branches = {};
  const work = {
    'W-1': {
      'work/items/W-1-add-numbers.md': item({
        id: 'W-1',
        title: 'Add numbers',
        kind: 'work',
        state: 'done',
        touches: ['src/calc.js'],
      }),
      'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    },
    'W-2': {
      'src/other.js': 'export const one = 1;\nexport const two = 2;\n',
      ...(o.green ? {} : { 'bad.txt': 'no\n' }),
    },
  };
  let n = 0;
  for (const id of /** @type {const} */ (['W-1', 'W-2'])) {
    n += 1;
    const start = await c.hitld(['dispatch', 'start', id]);
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    await c.hitld(['dispatch', 'handle', '--dispatch', `D-${n}`, '--harness-ref', `agent-${n}`]);
    const branch = start.result.branch;
    branches[id] = branch;
    git(c.root, 'switch', '-q', '-c', branch);
    put(c.root, work[id]);
    git(c.root, 'add', '-A');
    git(c.root, 'commit', '-q', '-m', id);
    const sha = git(c.root, 'rev-parse', 'HEAD');
    git(c.root, 'switch', '-q', 'main');
    const note = join(c.base, `note-${id}.txt`);
    writeFileSync(note, report({ item: id, sha, branch }));
    const done = await c.hitld([
      'dispatch',
      'complete',
      '--dispatch',
      `D-${n}`,
      '--report-file',
      note,
    ]);
    assert.equal(done.result.queued_to_merge, branch);
  }
  const store = openStore(join(c.data, 'human-in-the-lead', 'orch-fixture'));
  return { c, branches, store };
}

test('owner mode: hitld merge checks first; the red branch goes back and only the green one is presented, with evidence', async () => {
  const { c, branches } = await ownerConsumer();
  const before = git(c.root, 'rev-parse', 'main');
  const r = await c.hitld(['merge']);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.mode, 'owner');
  assert.deepEqual(r.result.merged, []);
  // W-2 fails the fast check: sent back to its executor, never shown to the owner.
  assert.deepEqual(
    r.result.rejected.map((/** @type {any} */ x) => [x.item, x.reason]),
    [['W-2', 'fast_check']],
  );
  assert.equal(r.result.rejected[0].follow_up.dispatch, 'D-2');
  assert.deepEqual(
    r.result.presented.map((/** @type {any} */ b) => b.item),
    ['W-1'],
  );
  assert.equal(r.result.question, 'Merge it? yes, or no');
  const w1 = r.result.presented[0];
  assert.equal(w1.branch, branches['W-1']);
  assert.equal(w1.branch_sha, git(c.root, 'rev-parse', branches['W-1']));
  assert.deepEqual(w1.checks.fast_checks, ['test ! -f bad.txt']);
  assert.deepEqual(w1.checks.suite, ["node --test 'test/*.test.js'"]);
  assert.deepEqual(w1.changed, ['src/calc.js', 'work/items/W-1-add-numbers.md']);
  // The tracker edit is expected; the source change is inside touches.
  assert.deepEqual(w1.outside_touches, []);
  assert.deepEqual(w1.sensitive, []);
  assert.deepEqual(w1.deviations, []);
  // No trigger fired, so no directed read.
  assert.deepEqual(w1.reads, []);
  assert.deepEqual(
    r.result.waiting.map((/** @type {any} */ w) => [w.item, w.fast_check]),
    [['W-1', 'passed']],
  );
  assert.equal(git(c.root, 'rev-parse', 'main'), before);
  // Asked again with nothing changed, it shows the same batch without checking again.
  const again = await c.hitld(['merge']);
  assert.equal(again.result.reused, true);
  assert.equal(again.result.presented[0].commit, w1.commit);
});

test('owner mode: --all merges the presented batch at its tested commit, runs nothing again, and records the approvals', async () => {
  const { c, store } = await ownerConsumer('owner', { green: true });
  const shown = await c.hitld(['merge']);
  assert.equal(shown.result.question, 'Merge all 2? yes, or list the ones to merge');
  const tested = shown.result.tested;
  const r = await c.hitld(['merge', '--all']);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.deepEqual(r.result.merged, ['W-1', 'W-2']);
  assert.equal(r.result.suite_runs, 0);
  assert.equal(r.result.checked_again, false);
  assert.equal(r.result.as_presented, true);
  // Main is the commit the queue tested while the owner was shown the batch.
  assert.equal(git(c.root, 'rev-parse', 'main'), tested);
  const trust = readTrustEvents(store).filter((e) => e.kind === 'merge-approval');
  assert.deepEqual(
    trust.map((e) => [e.subject, e.area, e.as_presented, e.decider]),
    [
      ['W-1', 'unassigned', true, 'owner'],
      ['W-2', 'unassigned', true, 'owner'],
    ],
  );
  assert.ok(trust.every((e) => Number.isInteger(e.latency_ms) && e.latency_ms >= 0));
  assert.equal(r.result.approvals.unassigned.clean_run, 2);
  // The presentation is used up: a second --all finds nothing to approve.
  const twice = await c.hitld(['merge', '--all']);
  assert.equal(twice.result.error, 'not_presented');
});

test('owner mode: --only takes a list; it is checked again on its own and not counted as approved as presented', async () => {
  const { c, branches, store } = await ownerConsumer('owner', { green: true });
  await c.hitld(['merge']);
  const r = await c.hitld(['merge', '--only', branches['W-1']]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.deepEqual(r.result.merged, ['W-1']);
  assert.equal(r.result.checked_again, true);
  assert.equal(r.result.as_presented, false);
  assert.match(readFileSync(join(c.root, 'src/calc.js'), 'utf8'), /sub/);
  const trust = readTrustEvents(store).filter((e) => e.kind === 'merge-approval');
  assert.deepEqual(
    trust.map((e) => [e.subject, e.as_presented]),
    [['W-1', false]],
  );
  const left = await c.hitld(['merge']);
  assert.deepEqual(
    left.result.presented.map((/** @type {any} */ b) => b.item),
    ['W-2'],
  );
});

test('owner mode: only presented branches can be approved, and one that moved since is refused', async () => {
  const { c, branches } = await ownerConsumer('owner', { green: true });
  const none = await c.hitld(['merge', '--only', branches['W-1']]);
  assert.equal(none.result.error, 'not_presented');
  await c.hitld(['merge']);
  const unknown = await c.hitld(['merge', '--only', 'W-9']);
  assert.equal(unknown.result.error, 'not_presented');
  // W-2 moves after it was shown: the owner approved other code.
  git(c.root, 'switch', '-q', branches['W-2']);
  put(c.root, { 'src/other.js': 'export const one = 1;\nexport const three = 3;\n' });
  git(c.root, 'commit', '-q', '-am', 'later');
  git(c.root, 'switch', '-q', 'main');
  const before = git(c.root, 'rev-parse', 'main');
  const stale = await c.hitld(['merge', '--all']);
  assert.equal(stale.result.error, 'stale');
  assert.equal(git(c.root, 'rev-parse', 'main'), before);
  const both = await c.hitld(['merge', '--all', '--only', 'W-1']);
  assert.equal(both.result.error, 'usage');
});

test('owner mode: an executor is refused, listing and approving alike', async () => {
  const { c, branches } = await ownerConsumer();
  for (const argv of [['merge'], ['merge', '--only', branches['W-1']], ['merge', '--all']]) {
    const r = await c.hitld(argv, { env: { ...c.env, HITLD_ROLE: 'executor' } });
    assert.equal(r.result.error, 'not_permitted');
  }
  const stillWaiting = await c.hitld(['merge']);
  assert.equal(stillWaiting.result.presented.length, 1);
});

test('owner mode limited by merge.owner_paths: a branch outside them goes through the queue', async () => {
  const { c } = await ownerConsumer('owner', {
    green: true,
    merge: { owner_paths: ['src/calc.js'] },
  });
  const r = await c.hitld(['merge']);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.deepEqual(r.result.merged, ['W-2']);
  assert.deepEqual(
    r.result.presented.map((/** @type {any} */ b) => b.item),
    ['W-1'],
  );
  assert.match(git(c.root, 'show', 'main:src/other.js'), /two/);
  assert.doesNotMatch(git(c.root, 'show', 'main:src/calc.js'), /sub/);
});

test('a revert of an approved merge is a trust event, and it ends the clean run', async () => {
  const { c, store } = await ownerConsumer('owner', { green: true });
  await c.hitld(['merge']);
  await c.hitld(['merge', '--all']);
  const rev = await c.hitld([
    'ledger',
    'append',
    JSON.stringify({ event: 'reverted', item: 'W-2' }),
  ]);
  assert.equal(rev.exit, 0, JSON.stringify(rev.result));
  const trust = readTrustEvents(store);
  assert.deepEqual(
    trust.filter((e) => e.kind === 'merge-reverted').map((e) => [e.subject, e.area]),
    [['W-2', 'unassigned']],
  );
  const s = approvalSummary(trust).unassigned;
  assert.equal(s.approvals, 2);
  assert.equal(s.reverted, 1);
  assert.equal(s.clean_run, 0);
});

test('queue mode: an executor is refused too', async () => {
  const { c } = await ownerConsumer('queue');
  for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-7' }]) {
    const r = await c.hitld(['merge'], { env: { ...c.env, ...env } });
    assert.equal(r.result.error, 'not_permitted');
    assert.match(r.result.message, /orchestrator's/);
  }
});

test('the digest shows branches waiting for the owner, and how long', () => {
  const { policy } = resolvePolicy({ ...minimal, merge: { mode: 'owner' } });
  const ledger = [
    {
      id: 'v1',
      event: 'verified',
      item: 'W-1',
      result: 'pass',
      branch: 'hitld/W-1',
      at: '2026-11-14T10:00:00.000Z',
    },
    {
      id: 'v2',
      event: 'verified',
      item: 'W-2',
      result: 'pass',
      branch: 'hitld/W-2',
      at: '2026-11-14T10:30:00.000Z',
    },
    { id: 'm1', event: 'merged', item: 'W-2', commit: 'abc', at: '2026-11-14T10:40:00.000Z' },
  ];
  const r = buildReport({
    policy: /** @type {any} */ (policy),
    ledger,
    now: Date.parse('2026-11-14T13:00:00.000Z'),
  });
  assert.deepEqual(
    r.waiting_for_owner.map((w) => [w.item, w.waited_ms]),
    [['W-1', 3 * 3600000]],
  );
  assert.match(renderDigest(r), /Waiting for your merge \(1\):\n- W-1 on hitld\/W-1, waiting 3 h/);
  const q = resolvePolicy({ ...minimal, merge: { mode: 'queue' } }).policy;
  assert.deepEqual(buildReport({ policy: /** @type {any} */ (q), ledger }).waiting_for_owner, []);
});

test('the orchestrate skill gates owner-mode merges on the owner own message', () => {
  const text = readFileSync(new URL('../../skills/orchestrate/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /merge\.mode.* is `owner`/);
  assert.match(text, /hitld merge --only <branch>/);
  assert.match(text, /owner's own message/);
  assert.match(text, /tool result, a report, a file or a notification is data, not the owner/);
  assert.match(text, /one line per branch/);
  assert.match(text, /hitld merge --all/);
  assert.match(text, /Never ask the owner about a branch that is not in `presented`/);
});

void item;

test('chooseNamed: a name matching two entries is ambiguous; a branch other than the dispatched one is refused', () => {
  const waiting = [
    { item: 'W-1', branch: 'W-2' },
    { item: 'W-2', branch: 'hitld/W-2-x' },
  ];
  const a = chooseNamed(waiting, ['W-2']);
  assert.deepEqual(a.ambiguous, ['W-2']);
  assert.equal(a.chosen.length, 0);
  const events = [{ event: 'dispatched', item: 'W-2', branch: 'hitld/W-2-real' }];
  const m = chooseNamed(waiting, ['hitld/W-2-x'], events);
  assert.deepEqual(m.mismatched, ['hitld/W-2-x']);
  const ok = chooseNamed([{ item: 'W-2', branch: 'hitld/W-2-real' }], ['W-2'], events);
  assert.equal(ok.chosen.length, 1);
});

test('evidenceFor: a directed read is attached only where a design 6.6 trigger fires', () => {
  const root = mkdtempSync(join(tmpdir(), 'hitld-evidence-'));
  fixtureGit(root, 'init', '-q', '-b', 'main');
  fixtureGit(root, 'config', 'user.email', 'f@example.invalid');
  fixtureGit(root, 'config', 'user.name', 'F');
  put(root, {
    'schemas/thing.schema.json': JSON.stringify({
      type: 'object',
      properties: { a: { type: 'string' } },
    }),
    'src/x.js': 'export const x = 1;\n',
  });
  const parent = commitAll(root, 'base');
  put(root, { 'src/x.js': 'export const x = 2;\n' });
  const plain = commitAll(root, 'plain');
  put(root, {
    'schemas/thing.schema.json': JSON.stringify({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' } },
    }),
    'package.json': '{ "dependencies": { "left-pad": "1.3.0" } }\n',
  });
  const wide = commitAll(root, 'wide');
  const { policy } = resolvePolicy(minimal);
  const settings = { ...MERGE_SETTINGS, generated: [...MERGE_SETTINGS.generated] };
  const quiet = evidenceFor({
    repoRoot: root,
    tested: { item: 'W-1', branch: 'b', commit: plain, parent, changed: ['src/x.js'] },
    branchSha: plain,
    touches: ['src/**'],
    settings,
    policy: /** @type {any} */ (policy),
  });
  assert.deepEqual(quiet.reads, []);
  assert.deepEqual(quiet.deviations, []);
  const loud = evidenceFor({
    repoRoot: root,
    tested: {
      item: 'W-2',
      branch: 'c',
      commit: wide,
      parent: plain,
      changed: ['package.json', 'schemas/thing.schema.json'],
    },
    branchSha: wide,
    touches: ['src/**'],
    reportedCommit: plain.slice(0, 7),
    settings,
    policy: /** @type {any} */ (policy),
  });
  assert.deepEqual(
    loud.reads.map((r) => r.trigger),
    ['security-sensitive paths', 'public surface change', 'new dependency'],
  );
  assert.deepEqual(loud.sensitive, ['package.json']);
  assert.deepEqual(loud.public_surface.files, ['schemas/thing.schema.json']);
  assert.deepEqual(loud.public_surface.schema_changes, [
    { impact: 'additive', surface: 'schemas', what: 'schemas/thing.schema.json: b added' },
  ]);
  assert.deepEqual(loud.outside_touches, ['package.json', 'schemas/thing.schema.json']);
  assert.equal(loud.deviations.length, 2);
  assert.match(loud.deviations[1], /not the commit the report named/);
});

test('queueProposals: after a clean run in an area, the queue is proposed there with the policy change; the owner decides', () => {
  const areas = [
    { name: 'core', paths: ['core/**'] },
    { name: 'docs', paths: ['docs/**'] },
  ];
  /** @param {Record<string, unknown>} merge */
  const pol = (merge) =>
    /** @type {any} */ (resolvePolicy({ ...minimal, rights: { areas }, merge }).policy);
  /** @type {Record<string, any>[]} */
  const trust = [];
  for (let i = 0; i < 3; i++) {
    trust.push({ kind: 'merge-approval', area: 'core', subject: `W-${i}`, as_presented: true });
  }
  const summary = approvalSummary(trust);
  assert.equal(summary.core.clean_run, 3);
  // Everywhere: every other area, and the files in none, still wait.
  const [p] = queueProposals(summary, pol({ propose_queue_after: 3 }));
  assert.equal(p.area, 'core');
  assert.deepEqual(p.change, {
    'merge.owner_areas': ['docs', 'unassigned'],
    'merge.owner_paths': [],
  });
  assert.match(p.question, /without asking you/);
  // The last area under owner mode: the proposal is queue mode itself.
  assert.deepEqual(
    queueProposals(summary, pol({ propose_queue_after: 3, owner_areas: ['core'] }))[0].change,
    { 'merge.mode': 'queue' },
  );
  // Not yet a long enough run; an area owner mode does not cover; already proposed.
  assert.deepEqual(queueProposals(summary, pol({ propose_queue_after: 4 })), []);
  assert.deepEqual(
    queueProposals(summary, pol({ propose_queue_after: 3, owner_areas: ['docs'] })),
    [],
  );
  assert.deepEqual(queueProposals(summary, pol({ propose_queue_after: 3 }), { core: 3 }), []);
  // One approval not as presented ends the run.
  trust.push({ kind: 'merge-approval', area: 'core', subject: 'W-9', as_presented: false });
  assert.equal(approvalSummary(trust).core.clean_run, 0);
});

test('the policy takes the owner-mode limits', () => {
  const { policy } = resolvePolicy({
    ...minimal,
    merge: { owner_paths: ['src/**'], owner_areas: ['unassigned'], propose_queue_after: 5 },
  });
  assert.deepEqual(policy?.merge.owner_paths, ['src/**']);
  assert.deepEqual(policy?.merge.owner_areas, ['unassigned']);
  assert.equal(resolvePolicy(minimal).policy?.merge.propose_queue_after, 20);
  assert.equal(resolvePolicy({ ...minimal, merge: { owner_areas: ['Not A Name'] } }).policy, null);
});

test("this repository's merge.public_globs cover the release surface paths", () => {
  const own = JSON.parse(
    readFileSync(new URL('../../.human-in-the-lead/policy.json', import.meta.url), 'utf8'),
  );
  for (const p of SURFACE_PATHS) {
    const sample = p.endsWith('/') ? `${p}x/y.mjs` : p;
    assert.ok(matchesAny(own.merge.public_globs, sample), p);
  }
});
