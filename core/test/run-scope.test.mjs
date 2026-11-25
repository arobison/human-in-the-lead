// The owner's run scope (HITLD-877): one decision in the owner's own words names items, a token
// budget and an end time, and the chief of staff starts those items itself, without the lease,
// within the cap and the quota gate. A start outside the scope, after its end time or past its
// budget is refused. Unit tests on run/scope.mjs, then the commands in a fixture consumer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import {
  checkScopeStart,
  readScope,
  scopeStatus,
  spentOf,
  unnamedItems,
  writeScope,
} from '../lib/run/scope.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const HOUR = 3600_000;

/** @returns {import('../lib/run/scope.mjs').RunScope} */
const scope = (over = {}) => ({
  run: 'R-1',
  decision: 'W-9',
  items: ['W-1', 'W-2'],
  budget_tokens: 100_000,
  until: new Date(NOW + HOUR).toISOString(),
  granted_at: new Date(NOW - HOUR).toISOString(),
  granted_by: 'cos',
  ...over,
});

/** @param {import('../lib/run/scope.mjs').RunScope | null} s @param {Record<string, unknown>} [over] */
const start = (s, over = {}) =>
  checkScopeStart(s, {
    decision: 'W-9',
    item: 'W-1',
    estimate: 40_000,
    now: NOW,
    run: 'R-1',
    events: [],
    ...over,
  });

test('the owner names each item in their own words, as a whole ID', () => {
  assert.deepEqual(
    unnamedItems('Yes: run W-1 and W-2 with 400k tokens until Friday', ['W-1', 'W-2']),
    [],
  );
  assert.deepEqual(unnamedItems('Yes, w-1 only', ['W-1', 'W-2']), ['W-2']);
  assert.deepEqual(unnamedItems('W-12 and W-10', ['W-1']), ['W-1'], 'W-12 does not name W-1');
  assert.deepEqual(unnamedItems('(W-1)', ['W-1']), []);
});

test('a start inside the scope passes; outside it, expired, ended, another run or past the budget it is refused', () => {
  const s = scope();
  assert.deepEqual(start(s), { ok: true, spent: 0, left: 100_000 });

  const outside = start(s, { item: 'W-3' });
  assert.equal(outside.ok, false);
  assert.equal(!outside.ok && outside.code, 'outside-scope');
  const other = start(s, { decision: 'W-8' });
  assert.equal(!other.ok && other.code, 'outside-scope', 'another decision is not the scope');

  const expired = start(s, { now: NOW + 2 * HOUR });
  assert.equal(!expired.ok && expired.code, 'scope-expired');

  const ended = start(
    scope({ ended: { at: new Date(NOW).toISOString(), by: 'cos', reason: 'stop' } }),
  );
  assert.equal(!ended.ok && ended.code, 'scope-ended');
  const nextRun = start(s, { run: 'R-2' });
  assert.equal(!nextRun.ok && nextRun.code, 'scope-ended', 'a scope is per run, never standing');

  const none = start(null);
  assert.equal(!none.ok && none.code, 'no-scope');

  // Spent: a start in flight counts at its estimate, a reported one at its tokens.
  const events = /** @type {any[]} */ ([
    {
      event: 'dispatched',
      run: 'R-1',
      dispatch: 'D-1',
      item: 'W-1',
      decision: 'W-9',
      estimate_tokens: 40_000,
    },
    {
      event: 'dispatched',
      run: 'R-1',
      dispatch: 'D-2',
      item: 'W-2',
      decision: 'W-9',
      estimate_tokens: 40_000,
    },
    { event: 'reported', run: 'R-1', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 55_000 },
    { event: 'dispatched', run: 'R-1', dispatch: 'D-3', item: 'W-2', estimate_tokens: 40_000 },
  ]);
  assert.deepEqual(spentOf(s, events), { spent: 95_000, starts: ['D-1', 'D-2'] });
  const over = start(s, { item: 'W-2', events });
  assert.equal(!over.ok && over.code, 'scope-budget', 'this start would pass the budget');
  const spent = scopeStatus(scope({ budget_tokens: 90_000 }), { now: NOW, run: 'R-1', events });
  assert.equal(spent.active, false);
  assert.equal(spent.code, 'scope-budget', 'an exhausted budget ends the scope');
});

// --- The commands ---------------------------------------------------------------------------

/** A decision the owner answered in their own words, naming the scope. @param {string} answer */
const decisionFile = (answer) =>
  item(
    {
      id: 'W-9',
      title: 'Run scope for the next items',
      kind: 'decision',
      state: 'done',
      decider: 'owner',
      answer: JSON.stringify(answer),
      answered_at: '2026-11-25T10:00:00.000Z',
      answered_via: 'chat',
      answered_by: 'owner',
    },
    '\n## Question\n\nWhich items may the chief of staff start in this run?\n',
  );

/** @param {string} answer */
function consumerWithScope(answer) {
  const c = makeConsumer();
  put(c.root, { 'work/items/W-9-run-scope.md': decisionFile(answer) });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'The owner names a run scope');
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  return c;
}

const ORCH1 = { env: { HITLD_SESSION: 'orch-1' } };
const ORCH2 = { env: { HITLD_SESSION: 'orch-2' } };
const COS = { env: { HITLD_SESSION: 'cos' } };
const until = () => new Date(Date.now() + 4 * HOUR).toISOString();
const setScope = (/** @type {string[]} */ extra = []) => [
  'run',
  'scope',
  'set',
  '--decision',
  'W-9',
  '--items',
  'W-1,W-2',
  '--budget-tokens',
  '2000000',
  '--until',
  until(),
  ...extra,
];

test('commands: the scope holds only what the owner answered; the chief of staff starts inside it without the lease, and nothing outside it', async () => {
  const c = consumerWithScope('Yes: start W-1 and W-2, 2M tokens, until tonight');
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1)).exit, 0);

  // The answer names W-1 and W-2, not W-3; a decision the owner did not answer is no scope.
  const unnamed = await c.hitld(
    [
      'run',
      'scope',
      'set',
      '--decision',
      'W-9',
      '--items',
      'W-1,W-3',
      '--budget-tokens',
      '1000',
      '--until',
      until(),
    ],
    COS,
  );
  assert.equal(unnamed.result.error, 'scope-not-in-answer', JSON.stringify(unnamed.result));
  const notDecision = await c.hitld(
    [
      'run',
      'scope',
      'set',
      '--decision',
      'W-1',
      '--items',
      'W-1',
      '--budget-tokens',
      '1000',
      '--until',
      until(),
    ],
    COS,
  );
  assert.equal(notDecision.result.error, 'not-found');
  const standing = await c.hitld(
    [
      'run',
      'scope',
      'set',
      '--decision',
      'W-9',
      '--items',
      'W-1',
      '--budget-tokens',
      '1000',
      '--until',
      new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
    ],
    COS,
  );
  assert.equal(standing.result.error, 'usage', 'never standing');
  const executor = await c.hitld(setScope(), {
    env: { HITLD_SESSION: 'x', HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' },
  });
  assert.equal(executor.result.error, 'not-permitted');

  // Before a scope is set, the chief of staff starts nothing.
  const early = await c.hitld(['dispatch', 'start', 'W-1', '--scope', 'W-9'], COS);
  assert.equal(early.result.error, 'no-scope', JSON.stringify(early.result));

  const set = await c.hitld(setScope(), COS);
  assert.equal(set.exit, 0, JSON.stringify(set.result));
  assert.deepEqual(set.result.scope.items, ['W-1', 'W-2']);

  // Inside the scope: started by the chief of staff, which does not hold the lease.
  const inside = await c.hitld(['dispatch', 'start', 'W-1', '--scope', 'W-9'], COS);
  assert.equal(inside.exit, 0, JSON.stringify(inside.result));
  assert.equal(inside.result.scope.decision, 'W-9');
  assert.match(inside.result.then, /--scope W-9/);
  const d1 = inside.result.dispatch;
  const handled = await c.hitld(
    ['dispatch', 'handle', '--dispatch', d1, '--harness-ref', 'agent-1', '--scope', 'W-9'],
    COS,
  );
  assert.equal(handled.exit, 0, JSON.stringify(handled.result));
  const store = openStore(privateStorePath('orch-fixture', { env: c.env, repoRoot: c.root }));
  const dispatched = readLedger(store).events.find(
    (e) => e.event === 'dispatched' && e.dispatch === d1,
  );
  assert.equal(dispatched?.decision, 'W-9');
  assert.equal(dispatched?.by, 'cos');

  // The orchestrator holding the lease sees it in flight and handles its completion.
  const status = await c.hitld(['run', 'status'], COS);
  assert.equal(status.result.lease.free, false);
  const again = await c.hitld(['dispatch', 'start', 'W-1'], ORCH1);
  assert.equal(again.result.error, 'not-planned', 'W-1 is in flight');
  const note = join(c.base, 'report.txt');
  writeFileSync(
    note,
    report({
      item: 'W-1',
      sha: git(c.root, 'rev-parse', 'HEAD'),
      branch: inside.result.branch,
      result: 'blocked',
    }),
  );
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d1, '--report-file', note, '--tokens', '1000'],
    ORCH1,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));

  // Outside the scope: refused, and nothing is recorded.
  const before = readLedger(store).events.length;
  const outside = await c.hitld(['dispatch', 'start', 'W-3', '--scope', 'W-9'], COS);
  assert.equal(outside.result.error, 'outside-scope', JSON.stringify(outside.result));
  const otherDecision = await c.hitld(['dispatch', 'start', 'W-2', '--scope', 'W-8'], COS);
  assert.equal(otherDecision.result.error, 'outside-scope');
  // Without --scope the chief of staff is not the lease holder, as before.
  const noScope = await c.hitld(['dispatch', 'start', 'W-2'], COS);
  assert.equal(noScope.result.error, 'lease-lost');
  assert.equal(readLedger(store).events.length, before);

  // The owner's word ends it.
  const ended = await c.hitld(['run', 'scope', 'end', '--reason', 'enough for today'], COS);
  assert.equal(ended.exit, 0, JSON.stringify(ended.result));
  const after = await c.hitld(['dispatch', 'start', 'W-2', '--scope', 'W-9'], COS);
  assert.equal(after.result.error, 'scope-ended');
});

test('commands: an expired scope and an exhausted budget start nothing', async () => {
  const c = consumerWithScope('Yes: W-1 and W-2, with a small budget');
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1)).exit, 0);
  const store = openStore(privateStorePath('orch-fixture', { env: c.env, repoRoot: c.root }));

  // A budget smaller than the item's estimate.
  const small = await c.hitld(
    [
      'run',
      'scope',
      'set',
      '--decision',
      'W-9',
      '--items',
      'W-1,W-2',
      '--budget-tokens',
      '10',
      '--until',
      until(),
    ],
    COS,
  );
  assert.equal(small.exit, 0, JSON.stringify(small.result));
  const over = await c.hitld(['dispatch', 'start', 'W-1', '--scope', 'W-9'], COS);
  assert.equal(over.result.error, 'scope-budget', JSON.stringify(over.result));

  // The end time has passed (the scope as the store holds it, an hour later).
  const s = /** @type {import('../lib/run/scope.mjs').RunScope} */ (readScope(store));
  writeScope(store, {
    ...s,
    budget_tokens: 2_000_000,
    until: new Date(Date.now() - 1000).toISOString(),
  });
  const expired = await c.hitld(['dispatch', 'start', 'W-1', '--scope', 'W-9'], COS);
  assert.equal(expired.result.error, 'scope-expired', JSON.stringify(expired.result));
  const shown = await c.hitld(['run', 'scope', 'show'], COS);
  assert.equal(shown.result.status.active, false);
  assert.equal(readLedger(store).events.filter((e) => e.event === 'dispatched').length, 0);
});

test('commands: across a hand-over the chief of staff starts the scope with no typed start line, and the successor completes it', async () => {
  const c = consumerWithScope('Yes, W-1 and W-2 within 2M tokens today');
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1)).exit, 0);
  assert.equal((await c.hitld(setScope(), COS)).exit, 0);
  const handed = await c.hitld(['handover'], ORCH1);
  assert.equal(handed.exit, 0, JSON.stringify(handed.result));
  assert.equal((await c.hitld(['run', 'status'], COS)).result.lease.free, true);

  // No orchestrator holds the lease, and the start goes ahead.
  const started = await c.hitld(['dispatch', 'start', 'W-2', '--scope', 'W-9'], COS);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  const d = started.result.dispatch;
  assert.match(started.result.then, /relay its report/i);

  // The successor takes the lease, keeps the start live, and handles its completion.
  const resumed = await c.hitld(
    ['run', 'resume', '--live', d, '--harness-ref', 'cloud-orch-2'],
    ORCH2,
  );
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.deepEqual(resumed.result.adopted, [d]);
  const note = join(c.base, 'report.txt');
  writeFileSync(
    note,
    report({
      item: 'W-2',
      sha: git(c.root, 'rev-parse', 'HEAD'),
      branch: started.result.branch,
      result: 'blocked',
    }),
  );
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d, '--report-file', note, '--tokens', '1000'],
    ORCH2,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));
});

test('commands: a session the chief of staff starts under the scope reports to the orchestrator holding the lease', async () => {
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 4 } } },
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/redesign.js'],
      }),
      'work/items/W-9-run-scope.md': decisionFile('Yes: W-4, 2M tokens, today'),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1)).exit, 0);
  const set = await c.hitld(
    [
      'run',
      'scope',
      'set',
      '--decision',
      'W-9',
      '--items',
      'W-4',
      '--budget-tokens',
      '2000000',
      '--until',
      until(),
    ],
    COS,
  );
  assert.equal(set.exit, 0, JSON.stringify(set.result));
  const started = await c.hitld(
    ['dispatch', 'start', 'W-4', '--mode', 'interactive', '--scope', 'W-9'],
    COS,
  );
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  assert.equal(started.result.instruction.tool, 'session');
  assert.equal(started.result.scope.report_to, 'cloud-orch-1');
  assert.match(readFileSync(started.result.brief_file, 'utf8'), /cloud-orch-1/);
  assert.match(started.result.then, /the orchestrator holding the lease, which completes it/);
});
