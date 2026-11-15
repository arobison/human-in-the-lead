// The first-run setup (design part 13.4): until the person and machine files exist, autonomous
// dispatch waits and only work the person starts by hand runs, one executor at a time. Executors
// never run the setup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setupState } from '../lib/settings/layers.mjs';
import { settingsLocation } from '../lib/settings/files.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, makeConsumer } from './orchestrator-fixture.mjs';

test('setupState: done only when both files exist, and says which are missing', () => {
  const f = (/** @type {boolean} */ person, /** @type {boolean} */ machine) => ({
    person: { present: person },
    machine: { present: machine },
  });
  assert.deepEqual(setupState(f(true, true)), { done: true, missing: [], reason: null });
  const half = setupState(f(true, false));
  assert.equal(half.done, false);
  assert.deepEqual(half.missing, ['machine']);
  assert.match(half.reason ?? '', /^setup not done: run the first-run setup/);
  assert.deepEqual(setupState(f(false, false)).missing, ['person', 'machine']);
});

test('config explain --json reports whether setup is done', async () => {
  const c = makeConsumer({ setup: false });
  const before = await c.hitld(['config', 'explain', '--json']);
  assert.equal(before.result.setup.done, false);
  assert.deepEqual(before.result.setup.missing, ['person', 'machine']);
  const text = await c.hitld(['config', 'explain']);
  assert.match(text.result.text, /setup not done: run the first-run setup/);
  await c.hitld(['config', 'write', 'person', '--data', '{"schema_version":1}']);
  await c.hitld(['config', 'write', 'machine', '--data', '{"schema_version":1}']);
  const after = await c.hitld(['config', 'explain', '--json']);
  assert.equal(after.result.setup.done, true);
  assert.equal(after.result.setup.reason, null);
});

test('before setup, dispatch plan holds every item with the reason and a cap of one', async () => {
  const c = makeConsumer({ setup: false });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.result.setup.done, false);
  assert.equal(plan.result.cap, 1);
  assert.deepEqual(plan.result.start, []);
  assert.ok(plan.result.held.length > 0);
  for (const h of plan.result.held) {
    assert.equal(h.reason, 'setup');
    assert.match(h.why, /^setup not done: run the first-run setup/);
  }
  assert.match(plan.result.next, /first-run setup/);
});

test('before setup, only a hand-started item runs, and one at a time', async () => {
  const c = makeConsumer({ setup: false });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const auto = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(auto.result.error, 'not_planned');
  assert.match(auto.result.message, /setup not done/);
  const hand = await c.hitld(['dispatch', 'start', 'W-1', '--by-hand']);
  assert.equal(hand.result.ok, true);
  const second = await c.hitld(['dispatch', 'start', 'W-2', '--by-hand']);
  assert.equal(second.result.error, 'not_planned');
  assert.match(second.result.message, /cap 1/);
});

test('after setup, dispatch plan is unchanged: items start up to the cap', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.result.setup.done, true);
  assert.ok(plan.result.start.length > 0);
  assert.ok(plan.result.held.every((/** @type {{ reason: string }} */ h) => h.reason !== 'setup'));
});

test('a dispatched executor cannot run the setup, whichever command writes', async () => {
  const c = makeConsumer({ setup: false });
  for (const env of [{ HITLD_DISPATCH: 'D-1' }, { HITLD_ROLE: 'executor' }]) {
    for (const kind of ['person', 'machine']) {
      const r = await c.hitld(['config', 'write', kind, '--data', '{"schema_version":1}'], { env });
      assert.equal(r.result.error, 'refused');
      assert.match(r.result.message, /executors never write settings/);
    }
    const detect = await c.hitld(['machine', 'detect', '--write'], { env });
    assert.equal(detect.result.error, 'refused');
    assert.equal(detect.result.written, false);
  }
  for (const kind of /** @type {const} */ (['person', 'machine'])) {
    assert.equal(existsSync(settingsLocation(kind, { env: c.env }).path), false);
  }
});
