import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHarnessAdapter } from '../harness/interface.mjs';
import { createFakeAdapter, FAKE_PROFILES } from '../harness/fake/fake.mjs';

/** @param {string} dispatch @param {Partial<import('../harness/interface.mjs').DispatchRequest>} [extra] */
const request = (dispatch, extra = {}) => ({
  dispatch,
  item: 'W-1',
  brief: 'You are implementing W-1.',
  tier: /** @type {const} */ (1),
  role: 'executor',
  isolation: /** @type {const} */ ('worktree'),
  classification: /** @type {const} */ ('public'),
  ...extra,
});

test('the fake adapter implements the interface, in every profile', () => {
  for (const capabilities of Object.values(FAKE_PROFILES)) {
    assert.deepEqual(checkHarnessAdapter(createFakeAdapter({ capabilities })), []);
  }
});

test('checkHarnessAdapter names what is missing or invalid', () => {
  const problems = checkHarnessAdapter({
    id: 'Bad Name',
    capabilities: () => ({ ...FAKE_PROFILES.full, hooks: 'some', extra: true }),
  });
  assert.ok(problems.includes('id must be a lower-case name such as "claude-code"'));
  assert.ok(problems.includes('dispatch must be a function'));
  assert.ok(problems.some((p) => /capabilities: hooks must be one of/.test(p)));
  assert.ok(problems.some((p) => /capabilities: extra is not a known key/.test(p)));
});

test('a dispatch completes when the test completes it', async () => {
  const fake = createFakeAdapter();
  const handle = await fake.dispatch(request('D-1'));
  assert.deepEqual(fake.inFlight(), ['D-1']);
  const done = fake.onComplete(handle);
  fake.complete('D-1', {
    report: 'item: W-1\nresult: done',
    commit: 'abc1234',
    usage: { tokens: 1000, toolCalls: 5, durationMs: 2000 },
  });
  const completion = await done;
  assert.equal(completion.dispatch, 'D-1');
  assert.equal(completion.usage?.tokens, 1000);
  assert.deepEqual(fake.inFlight(), []);
  assert.deepEqual(
    fake.calls.map((c) => c.method),
    ['dispatch', 'onComplete'],
  );
});

test('a respond function completes dispatches on its own', async () => {
  const fake = createFakeAdapter({
    respond: (r) => ({ report: `item: ${r.item}\nresult: done`, usage: null }),
  });
  const completion = await fake.onComplete(await fake.dispatch(request('D-2')));
  assert.match(completion.report, /result: done/);
});

test('without parallel subagents, one dispatch at a time', async () => {
  const fake = createFakeAdapter({ capabilities: FAKE_PROFILES.minimal });
  await fake.dispatch(request('D-1'));
  await assert.rejects(fake.dispatch(request('D-2')), /one dispatch at a time/);
  fake.complete('D-1', { report: 'r', usage: null });
  await fake.dispatch(request('D-2'));
});

test('an item above the harness classification limit is refused', async () => {
  const fake = createFakeAdapter({ capabilities: FAKE_PROFILES.minimal });
  await assert.rejects(
    fake.dispatch(request('D-1', { classification: 'internal' })),
    /above this harness's public/,
  );
});

test('usage is null when the harness does not report it', async () => {
  const fake = createFakeAdapter({ capabilities: FAKE_PROFILES.minimal });
  const handle = await fake.dispatch(request('D-1'));
  fake.complete('D-1', { report: 'r', usage: { tokens: 5, toolCalls: 1, durationMs: 1 } });
  assert.equal((await fake.onComplete(handle)).usage, null);
});

test('questions, notifications and follow-ups are recorded', async () => {
  const fake = createFakeAdapter();
  const handle = await fake.dispatch(request('D-1'));
  await fake.followUp(handle, 'Please fix the failing test.');
  const ref = await fake.ask({ decision: 'W-412', text: 'Include it?', classification: 'public' });
  await fake.notify({ text: 'digest', classification: 'public' }, 'digest');
  assert.equal(ref.channel, 'fake');
  assert.deepEqual(
    fake.calls.map((c) => c.method),
    ['dispatch', 'followUp', 'ask', 'notify'],
  );
});
