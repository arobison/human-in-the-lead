// Disposable orchestrators (design part 13.1): an orchestrator hands over and gives up the lease,
// the chief of staff retires a session that ended without a hand-over, and a successor takes the
// lease without the owner. Unit tests on the run module, then the commands in a fixture consumer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryStore } from './helpers/memory-store.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { LeaseError } from '../lib/run/lease.mjs';
import {
  handoverDue,
  leaseStatus,
  releaseLease,
  reportingHere,
  startRun,
  takeLease,
} from '../lib/run/run.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, makeConsumer, report } from './orchestrator-fixture.mjs';

const BASE = Date.parse('2026-11-14T03:00:00Z');
/** @param {number} [offset] */
const clock = (offset = 0) => {
  let n = 0;
  return () => new Date(BASE + (offset + n++) * 1000);
};
const EXPIRY = 1800;
const A = { session: 'orch-1', host: 'laptop' };
const B = { session: 'orch-2', host: 'laptop' };
const COS = { session: 'cos', host: 'phone-relay' };

test('a hand-over releases the lease: the holder can no longer record, a successor takes it at once', () => {
  const store = memoryStore();
  const first = startRun(store, { ...A, now: clock(), harnessRef: 'cloud-1' });
  assert.equal(first.state.lease.harness_ref, 'cloud-1');
  const r = releaseLease(store, { ...A, now: clock(10), reason: 'handover' });
  assert.equal(r.appended, true);
  assert.deepEqual(
    { reason: r.released.reason, by: r.released.by },
    { reason: 'handover', by: 'orch-1' },
  );
  assert.deepEqual(schemas().validateEntity('run-state', loadState(store).state), []);
  assert.throws(
    () => first.record({ event: 'asked', decision: 'W-1' }),
    (e) => e instanceof LeaseError && e.code === 'released',
  );
  assert.equal(
    releaseLease(store, { ...A, now: clock(11), reason: 'handover' }).appended,
    false,
    'releasing again changes nothing',
  );

  // Well before expiry, and without force: the released lease is free.
  const { run, tookOver } = takeLease(store, {
    ...B,
    now: clock(20),
    expirySeconds: EXPIRY,
    harnessRef: 'cloud-2',
  });
  assert.deepEqual(tookOver, { from: { session: 'orch-1', host: 'laptop' }, reason: 'handover' });
  assert.equal(run.state.lease.released, undefined);
  assert.equal(run.state.lease.harness_ref, 'cloud-2');
  assert.deepEqual(
    readLedger(store).events.map((e) => e.event),
    ['run-started', 'lease-released', 'lease-taken'],
  );
  assert.doesNotThrow(() => run.record({ event: 'asked', decision: 'W-1' }));
  assert.throws(
    () => first.record({ event: 'asked', decision: 'W-2' }),
    (e) => e instanceof LeaseError && e.code === 'lost',
  );
});

test('the chief of staff retires a session that ended; it cannot retire itself or a non-holder', () => {
  const store = memoryStore();
  const first = startRun(store, { ...A, now: clock() });
  assert.throws(
    () => releaseLease(store, { ...COS, reason: 'ended', holder: { session: 'someone-else' } }),
    (e) => e instanceof LeaseError && e.code === 'lost',
  );
  assert.throws(
    () => releaseLease(store, { ...A, reason: 'ended', holder: { session: 'orch-1' } }),
    (e) => e instanceof LeaseError && e.code === 'held',
    'a holder hands over; it does not retire itself',
  );
  // The holder's host defaults to the lease's.
  const r = releaseLease(store, {
    ...COS,
    now: clock(30),
    reason: 'ended',
    holder: { session: 'orch-1' },
  });
  assert.deepEqual(
    { reason: r.released.reason, by: r.released.by },
    { reason: 'ended', by: 'cos' },
  );
  const released = readLedger(store).events.at(-1);
  assert.equal(released?.event, 'lease-released');
  assert.equal(released?.session, 'orch-1');
  assert.equal(released?.host, 'laptop');
  const state = /** @type {Record<string, any>} */ (loadState(store).state);
  assert.equal(leaseStatus(state, new Date(BASE + 40_000), EXPIRY).free, true);

  const { tookOver } = takeLease(store, { ...B, now: clock(40), expirySeconds: EXPIRY });
  assert.equal(tookOver?.reason, 'ended');
  assert.throws(() => first.checkpoint(), LeaseError);
});

test('the hand-over is due after enough completions since the lease was taken, or a full context', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  for (const n of [1, 2]) {
    run.record({ event: 'dispatched', dispatch: `D-${n}`, item: `W-${n}`, tier: 2 });
    run.record({ event: 'reported', dispatch: `D-${n}`, item: `W-${n}`, result: 'done' });
  }
  const events = () => readLedger(store).events;
  assert.equal(handoverDue(run.state, events(), { afterCompletions: 3 }).due, false);
  const due = handoverDue(run.state, events(), { afterCompletions: 2 });
  assert.equal(due.due, true);
  assert.equal(due.completions, 2);
  const ctx = handoverDue(run.state, events(), { contextShare: 0.7, contextUsed: 0.72 });
  assert.equal(ctx.due, true);
  assert.match(ctx.reasons[0], /72% of the context/);

  // A successor counts from its own takeover.
  releaseLease(store, { ...A, reason: 'handover' });
  const next = takeLease(store, { ...B, expirySeconds: EXPIRY }).run;
  assert.equal(handoverDue(next.state, events(), { afterCompletions: 2 }).completions, 0);
});

test('only work whose notice reaches this session holds a hand-over up', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock() });
  run.record({ event: 'dispatched', dispatch: 'D-1', item: 'W-1', tier: 2, host: 'laptop' });
  run.record({
    event: 'dispatched',
    dispatch: 'D-2',
    item: 'W-2',
    tier: 3,
    mode: 'interactive',
    host: 'laptop',
  });
  run.record({ event: 'dispatched', dispatch: 'D-3', item: 'W-3', tier: 3, mode: 'headless' });
  run.record({ event: 'dispatched', dispatch: 'D-4', item: 'W-4', tier: 2, host: 'desktop' });
  assert.deepEqual(
    reportingHere(run.state, 'laptop').map((d) => d.dispatch),
    ['D-1', 'D-3'],
  );
  assert.equal(
    run.state.in_flight.find((/** @type {any} */ d) => d.dispatch === 'D-2').mode,
    'interactive',
  );
});

// --- The commands ---------------------------------------------------------------------------

test('commands: the chief of staff reads the lease, retires a killed orchestrator, and a successor resumes without force', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const orch1 = { env: { HITLD_SESSION: 'orch-1' } };
  const orch2 = { env: { HITLD_SESSION: 'orch-2' } };
  const cos = { env: { HITLD_SESSION: 'cos' } };
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], orch1)).exit, 0);
  await c.hitld(['dispatch', 'start', 'W-1'], orch1); // killed before the Agent call
  await c.hitld(['dispatch', 'start', 'W-2'], orch1); // the agent was started

  const status = await c.hitld(['run', 'status'], cos);
  assert.equal(status.exit, 0, JSON.stringify(status.result));
  assert.equal(status.result.wake_to, 'cloud-orch-1');
  assert.equal(status.result.lease.free, false);
  assert.equal(status.result.in_flight, 2);

  const early = await c.hitld(['run', 'resume', '--live', 'D-2'], orch2);
  assert.equal(early.result.error, 'lease_held', 'a fresh lease is not taken without cause');

  const retired = await c.hitld(['run', 'retire', '--holder', 'orch-1'], cos);
  assert.equal(retired.exit, 0, JSON.stringify(retired.result));
  assert.equal(retired.result.released.reason, 'ended');
  assert.deepEqual(retired.result.reported_to_it, ['D-1', 'D-2']);
  const free = await c.hitld(['run', 'status'], cos);
  assert.equal(free.result.wake_to, null);
  assert.match(free.result.next, /start a successor/);

  const resumed = await c.hitld(
    ['run', 'resume', '--live', 'D-2', '--harness-ref', 'cloud-orch-2'],
    orch2,
  );
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.equal(resumed.result.took_over.reason, 'ended');
  assert.deepEqual(resumed.result.abandoned, ['D-1']);
  assert.deepEqual(resumed.result.adopted, ['D-2']);
  assert.equal((await c.hitld(['run', 'status'], cos)).result.wake_to, 'cloud-orch-2');
  const stale = await c.hitld(['dispatch', 'start', 'W-1'], orch1);
  assert.equal(stale.result.error, 'lease_lost');

  const executor = await c.hitld(['run', 'retire', '--holder', 'orch-2'], {
    env: { HITLD_SESSION: 'x', HITLD_ROLE: 'executor' },
  });
  assert.equal(executor.result.error, 'not_permitted');
});

test('commands: after enough completions the refill is held, the hand-over waits for its own work, then releases the lease', async () => {
  const c = makeConsumer({ policy: { orchestrator: { handover_after_completions: 1 } } });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const orch1 = { env: { HITLD_SESSION: 'orch-1' } };
  const orch2 = { env: { HITLD_SESSION: 'orch-2' } };
  await c.hitld(['run', 'start'], orch1);
  await c.hitld(['dispatch', 'start', 'W-1'], orch1);
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1'], orch1);
  await c.hitld(['dispatch', 'start', 'W-2'], orch1);
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-2', '--harness-ref', 'agent-2'], orch1);

  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha: 'abc1234', branch: 'hitld/W-1-add-numbers' }));
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note],
    orch1,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.handover.due, true);
  assert.deepEqual(done.result.refill.start, []);
  assert.match(done.result.refill.next, /process the completions of D-2, then hitld handover/);
  const refused = await c.hitld(['dispatch', 'start', 'W-3'], orch1);
  assert.equal(refused.result.error, 'handover_due');

  const early = await c.hitld(['handover'], orch1);
  assert.equal(early.result.error, 'draining');
  assert.deepEqual(early.result.reporting_here, ['D-2']);

  writeFileSync(note, report({ item: 'W-2', sha: 'def5678', branch: 'hitld/W-2-another-thing' }));
  await c.hitld(['dispatch', 'complete', '--dispatch', 'D-2', '--report-file', note], orch1);
  const handed = await c.hitld(['handover'], orch1);
  assert.equal(handed.exit, 0, JSON.stringify(handed.result));
  assert.equal(handed.result.released.reason, 'handover');
  assert.match(handed.result.text, /The lease is released/);
  const status = await c.hitld(['run', 'status'], { env: { HITLD_SESSION: 'cos' } });
  assert.equal(status.result.handover_file, handed.result.file);
  assert.equal(status.result.lease.free, true);
  const after = await c.hitld(['run', 'checkpoint'], orch1);
  assert.equal(after.result.error, 'lease_released');

  const resumed = await c.hitld(['run', 'resume', '--live', 'none'], orch2);
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.equal(resumed.result.took_over.reason, 'handover');
  // The successor counts from its own lease: W-3 is refused only for not being ready yet.
  const next = await c.hitld(['dispatch', 'start', 'W-3'], orch2);
  assert.equal(next.result.error, 'not_planned');
});

test('commands: in owner merge mode the chief of staff records the approval and the holder sees it', async () => {
  const c = makeConsumer({ policy: { merge: { mode: 'owner', full_suite: [] } } });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const orch = { env: { HITLD_SESSION: 'orch-1' } };
  const cos = { env: { HITLD_SESSION: 'cos' } };
  await c.hitld(['run', 'start'], orch);
  await c.hitld(['dispatch', 'start', 'W-1'], orch);
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1'], orch);
  const note = join(c.base, 'note.txt');
  const branch = 'hitld/W-1-add-numbers';
  writeFileSync(note, report({ item: 'W-1', sha: 'abc1234', branch }));
  await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note], orch);

  const before = await c.hitld(['merge'], orch);
  assert.equal(before.result.waiting[0].approved, null);
  const unknown = await c.hitld(['merge', 'approve', '--only', 'W-9'], cos);
  assert.equal(unknown.result.error, 'not_waiting');
  const approved = await c.hitld(['merge', 'approve', '--only', 'W-1'], cos);
  assert.equal(approved.exit, 0, JSON.stringify(approved.result));
  assert.deepEqual(approved.result.approved, [{ item: 'W-1', branch, already: false }]);
  const again = await c.hitld(['merge', 'approve', '--only', branch], cos);
  assert.equal(again.result.approved[0].already, true);
  const listed = await c.hitld(['merge'], orch);
  assert.equal(listed.result.waiting[0].approved.by, 'cos');
  assert.match(listed.result.next, new RegExp(`hitld merge --only ${branch}`));
  const executor = await c.hitld(['merge', 'approve', '--only', 'W-1'], {
    env: { HITLD_SESSION: 'x', HITLD_DISPATCH: 'D-1' },
  });
  assert.equal(executor.result.error, 'not_permitted');
});
