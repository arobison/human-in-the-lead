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
const A = { session: 'orch-1', host: 'example-laptop' };
const B = { session: 'orch-2', host: 'example-laptop' };
const COS = { session: 'cos', host: 'phone-relay' };

test('releasing a lease right after a renewal keeps the renewal time', () => {
  const store = memoryStore();
  const run = startRun(store, { ...A, now: clock(600) });
  const taken = run.state.lease.renewed_at;
  const renewed = run.checkpoint().lease.renewed_at;
  assert.ok(renewed > taken, 'the checkpoint renewed the lease');
  const r = releaseLease(store, { ...A, now: clock(900), reason: 'handover' });
  assert.equal(r.appended, true);
  assert.equal(r.released.reason, 'handover');
  assert.equal(r.state.lease.renewed_at, renewed, 'not reset to when the lease was taken');
  assert.equal(loadState(store).state?.lease.renewed_at, renewed);
});

test('a hand-over releases the lease: the holder can no longer record, a successor takes it at once', () => {
  const store = memoryStore();
  const first = startRun(store, { ...A, now: clock(), harnessRef: 'example-host-1' });
  assert.equal(first.state.lease.harness_ref, 'example-host-1');
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
    harnessRef: 'example-host-2',
  });
  assert.deepEqual(tookOver, {
    from: { session: 'orch-1', host: 'example-laptop' },
    reason: 'handover',
  });
  assert.equal(run.state.lease.released, undefined);
  assert.equal(run.state.lease.harness_ref, 'example-host-2');
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
  assert.equal(released?.host, 'example-laptop');
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
  run.record({
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    tier: 2,
    host: 'example-laptop',
  });
  run.record({
    event: 'dispatched',
    dispatch: 'D-2',
    item: 'W-2',
    tier: 3,
    mode: 'interactive',
    host: 'example-laptop',
  });
  run.record({ event: 'dispatched', dispatch: 'D-3', item: 'W-3', tier: 3, mode: 'headless' });
  run.record({ event: 'dispatched', dispatch: 'D-4', item: 'W-4', tier: 2, host: 'desktop' });
  assert.deepEqual(
    reportingHere(run.state, 'example-laptop').map((d) => d.dispatch),
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
  // The first dispatch is killed before the Agent call; the second's agent was started.
  const d1 = (await c.hitld(['dispatch', 'start', 'W-1'], orch1)).result.dispatch;
  const d2 = (await c.hitld(['dispatch', 'start', 'W-2'], orch1)).result.dispatch;

  const status = await c.hitld(['run', 'status'], cos);
  assert.equal(status.exit, 0, JSON.stringify(status.result));
  assert.equal(status.result.wake_to, 'cloud-orch-1');
  assert.equal(status.result.lease.free, false);
  assert.equal(status.result.in_flight, 2);

  const early = await c.hitld(['run', 'resume', '--live', d2], orch2);
  assert.equal(early.result.error, 'lease-held', 'a fresh lease is not taken without cause');

  const retired = await c.hitld(['run', 'retire', '--holder', 'orch-1'], cos);
  assert.equal(retired.exit, 0, JSON.stringify(retired.result));
  assert.equal(retired.result.released.reason, 'ended');
  assert.deepEqual(retired.result.reported_to_it, [d1, d2]);
  const free = await c.hitld(['run', 'status'], cos);
  assert.equal(free.result.wake_to, null);
  assert.match(free.result.next, /start a successor/);

  const resumed = await c.hitld(
    ['run', 'resume', '--live', d2, '--harness-ref', 'cloud-orch-2'],
    orch2,
  );
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.equal(resumed.result.took_over.reason, 'ended');
  assert.deepEqual(resumed.result.abandoned, [d1]);
  assert.deepEqual(resumed.result.adopted, [d2]);
  assert.equal((await c.hitld(['run', 'status'], cos)).result.wake_to, 'cloud-orch-2');
  const stale = await c.hitld(['dispatch', 'start', 'W-1'], orch1);
  assert.equal(stale.result.error, 'lease-lost');

  const executor = await c.hitld(['run', 'retire', '--holder', 'orch-2'], {
    env: { HITLD_SESSION: 'x', HITLD_ROLE: 'executor' },
  });
  assert.equal(executor.result.error, 'not-permitted');
});

test('commands: after enough completions the refill is held, the hand-over waits for its own work, then releases the lease', async () => {
  const c = makeConsumer({ policy: { orchestrator: { handover_after_completions: 1 } } });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const orch1 = { env: { HITLD_SESSION: 'orch-1' } };
  const orch2 = { env: { HITLD_SESSION: 'orch-2' } };
  await c.hitld(['run', 'start'], orch1);
  const d1 = (await c.hitld(['dispatch', 'start', 'W-1'], orch1)).result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d1, '--harness-ref', 'agent-1'], orch1);
  const d2 = (await c.hitld(['dispatch', 'start', 'W-2'], orch1)).result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d2, '--harness-ref', 'agent-2'], orch1);

  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha: 'abc1234', branch: 'hitld/W-1-add-numbers' }));
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d1, '--report-file', note],
    orch1,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.handover.due, true);
  assert.deepEqual(done.result.refill.start, []);
  assert.match(
    done.result.refill.next,
    new RegExp(`process the completions of ${d2}, then hitld handover`),
  );
  const refused = await c.hitld(['dispatch', 'start', 'W-3'], orch1);
  assert.equal(refused.result.error, 'handover-due');

  const early = await c.hitld(['handover'], orch1);
  assert.equal(early.result.error, 'draining');
  assert.deepEqual(early.result.reporting_here, [d2]);

  writeFileSync(note, report({ item: 'W-2', sha: 'def5678', branch: 'hitld/W-2-another-thing' }));
  await c.hitld(['dispatch', 'complete', '--dispatch', d2, '--report-file', note], orch1);
  const handed = await c.hitld(['handover'], orch1);
  assert.equal(handed.exit, 0, JSON.stringify(handed.result));
  assert.equal(handed.result.released.reason, 'handover');
  assert.match(handed.result.text, /The lease is released/);
  const status = await c.hitld(['run', 'status'], { env: { HITLD_SESSION: 'cos' } });
  assert.equal(status.result.handover_file, handed.result.file);
  assert.equal(status.result.lease.free, true);
  const after = await c.hitld(['run', 'checkpoint'], orch1);
  assert.equal(after.result.error, 'lease-released');

  const resumed = await c.hitld(['run', 'resume', '--live', 'none'], orch2);
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.equal(resumed.result.took_over.reason, 'handover');
  // The successor counts from its own lease: W-3 is refused only for not being ready yet.
  const next = await c.hitld(['dispatch', 'start', 'W-3'], orch2);
  assert.equal(next.result.error, 'not-planned');
});
