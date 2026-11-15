// The owner's attention budget (HITLD-84): where each open question goes (now, digest, hold or
// default), computed from the critical path, idle slots and quiet hours; the defaults that are due,
// applied by a sweep, recorded, reversible and listed in the digest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryGate, quietState } from '../lib/rights/budget.mjs';
import { decisionUrgency, readyWork } from '../lib/rights/urgency.mjs';
import { answerDecision, askQuestion, recordReversal, showQuestion } from '../lib/rights/flow.mjs';
import { listDefaults, pendingDecisions, sweepDefaults } from '../lib/rights/pending.mjs';
import { readTrustEvents, trustSummary } from '../lib/rights/trust.mjs';
import { LedgerError, appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { attentionDefaults } from '../lib/settings/attention.mjs';
import { settingsLocation } from '../lib/settings/files.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { makeProject } from './helpers/project.mjs';
import { item, makeConsumer } from './orchestrator-fixture.mjs';

const T0 = Date.parse('2026-11-14T12:00:00Z');
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
const MIN = 60_000;

/** The settings the gate reads: the defaults, in UTC, with quiet hours off unless a test sets them. */
const attention = (/** @type {Record<string, any>} */ over = {}) => ({
  ...attentionDefaults(),
  timezone: 'UTC',
  quiet_hours: [],
  ...over,
});

/** @param {Record<string, any>} over @returns {import('../lib/rights/budget.mjs').Candidate} */
const candidate = (over) => ({
  id: 'W-1',
  title: 'A question',
  asked_at: iso(T0 - 60 * MIN),
  sent_at: null,
  reversibility: null,
  default_if_unanswered: null,
  recommended: 'A',
  blocks: [],
  unblocks_ready: [],
  critical_path: false,
  cost_of_delay: 0,
  ...over,
});

/** @param {Record<string, any>} [over] */
const readings = (over = {}) => ({
  now: T0,
  attention: attention(),
  slots: { cap: 3, in_flight: 3, ready: 0 },
  interruptsUsed: 0,
  nonUrgentSent: 0,
  lastAnsweredAt: null,
  ...over,
});

/** @param {ReturnType<typeof deliveryGate>} g @param {string} id */
const of = (g, id) => {
  const d = g.decisions.find((x) => x.decision === id);
  assert.ok(d, `${id} is in the result`);
  return d;
};

// Quiet hours

test('quiet hours cross midnight, are read in the person’s zone, and say when they end', () => {
  const windows = [{ from: '22:00', to: '07:00' }];
  const at = (/** @type {string} */ t) => Date.parse(t);
  assert.equal(quietState(at('2026-11-14T12:00:00Z'), windows, 'UTC').active, false);
  const night = quietState(at('2026-11-14T23:30:00Z'), windows, 'UTC');
  assert.equal(night.active, true);
  assert.equal(night.until, '2026-11-15T07:00:00.000Z');
  assert.equal(night.until_local, '07:00');
  const early = quietState(at('2026-11-15T03:10:30Z'), windows, 'UTC');
  assert.equal(early.until, '2026-11-15T07:00:00.000Z');
  assert.equal(
    quietState(at('2026-11-15T07:00:00Z'), windows, 'UTC').active,
    false,
    'the end is open',
  );
  // 23:30 UTC is 00:30 in Paris on 15 November (UTC+1): quiet there, and until 07:00 Paris time.
  const paris = quietState(at('2026-11-14T23:30:00Z'), windows, 'Europe/Paris');
  assert.equal(paris.active, true);
  assert.equal(paris.until, '2026-11-15T06:00:00.000Z');
  assert.equal(paris.until_local, '07:00');
  // 12:00 UTC is 13:00 in Paris, and 21:30 UTC is 22:30 there.
  assert.equal(quietState(at('2026-11-14T21:30:00Z'), windows, 'Europe/Paris').active, true);
  assert.equal(quietState(at('2026-11-14T21:30:00Z'), windows, 'UTC').active, false);
  // No windows, or a window that starts and ends together, is no quiet hours.
  assert.equal(quietState(at('2026-11-14T23:30:00Z'), [], 'UTC').active, false);
  assert.equal(
    quietState(at('2026-11-14T23:30:00Z'), [{ from: '09:00', to: '09:00' }], 'UTC').active,
    false,
  );
  // Windows that touch are followed to the end of the last.
  const chained = quietState(
    at('2026-11-14T23:30:00Z'),
    [
      { from: '22:00', to: '02:00' },
      { from: '02:00', to: '06:00' },
    ],
    'UTC',
  );
  assert.equal(chained.until, '2026-11-15T06:00:00.000Z');
});

// The delivery gate, one outcome at a time

test('a question that blocks the critical path goes now, and uses an interrupt', () => {
  const g = deliveryGate(
    [candidate({ id: 'W-1', critical_path: true, blocks: ['W-8', 'W-9'], cost_of_delay: 4 })],
    readings(),
  );
  const d = of(g, 'W-1');
  assert.equal(d.deliver, 'now');
  assert.match(d.reason, /blocks the critical path \(2 items, cost of delay 4\); interrupt 1 of 3/);
  assert.equal(
    g.budget.interrupts_per_day.left,
    3,
    'the budget shown is what was left before this call',
  );
});

test('a question whose answer fills idle slots goes now; one that fills none does not', () => {
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', unblocks_ready: ['W-8'], cost_of_delay: 2 }),
      candidate({ id: 'W-2', unblocks_ready: [], cost_of_delay: 1 }),
    ],
    readings({ slots: { cap: 3, in_flight: 1, ready: 1 } }),
  );
  assert.equal(g.budget.slots.idle, 1);
  assert.equal(of(g, 'W-1').deliver, 'now');
  assert.match(of(g, 'W-1').reason, /no ready work is left for 1 idle slot/);
  assert.equal(of(g, 'W-2').deliver, 'digest');
  // With every slot busy there is nothing to idle.
  const busy = deliveryGate(
    [candidate({ id: 'W-1', unblocks_ready: ['W-8'] })],
    readings({ slots: { cap: 3, in_flight: 3, ready: 0 } }),
  );
  assert.equal(of(busy, 'W-1').deliver, 'digest');
});

test('idle slots are given out in order of cost of delay, one decision per slot', () => {
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', unblocks_ready: ['W-8'], cost_of_delay: 2 }),
      candidate({ id: 'W-2', unblocks_ready: ['W-9'], cost_of_delay: 6 }),
    ],
    readings({ slots: { cap: 2, in_flight: 1, ready: 0 } }),
  );
  assert.deepEqual(
    g.decisions.map((d) => [d.decision, d.deliver]),
    [
      ['W-2', 'now'],
      ['W-1', 'digest'],
    ],
  );
});

test('an urgent question is held through quiet hours, until they end', () => {
  const g = deliveryGate(
    [candidate({ id: 'W-1', critical_path: true, blocks: ['W-8'], cost_of_delay: 2 })],
    readings({
      now: Date.parse('2026-11-14T23:30:00Z'),
      attention: attention({ quiet_hours: [{ from: '22:00', to: '07:00' }] }),
    }),
  );
  const d = of(g, 'W-1');
  assert.equal(d.deliver, 'hold');
  assert.equal(d.hold_until, '2026-11-15T07:00:00.000Z');
  assert.match(d.reason, /quiet hours run until 07:00 \(UTC\); only a sev-1 breaks them/);
  assert.equal(g.budget.quiet_hours.active, true);
});

test('with no interrupt left, an urgent question goes in the next digest', () => {
  const g = deliveryGate(
    [candidate({ id: 'W-1', critical_path: true, blocks: ['W-8'] })],
    readings({ interruptsUsed: 3 }),
  );
  assert.equal(of(g, 'W-1').deliver, 'digest');
  assert.match(of(g, 'W-1').reason, /3 interrupts allowed in 24 hours are spent/);
  assert.equal(g.budget.interrupts_per_day.left, 0);
});

test('interrupts are given out in order of cost of delay until they run out', () => {
  const ids = ['W-1', 'W-2', 'W-3', 'W-4'];
  const g = deliveryGate(
    ids.map((id, i) => candidate({ id, critical_path: true, blocks: ['W-9'], cost_of_delay: i })),
    readings({ interruptsUsed: 1 }),
  );
  assert.deepEqual(
    g.decisions.map((d) => [d.decision, d.deliver]),
    [
      ['W-4', 'now'],
      ['W-3', 'now'],
      ['W-2', 'digest'],
      ['W-1', 'digest'],
    ],
  );
});

test('a question that is not urgent waits for the digest, in order of cost of delay, up to the places left', () => {
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', cost_of_delay: 1, reversibility: 'one-way' }),
      candidate({ id: 'W-2', cost_of_delay: 9, reversibility: 'one-way' }),
      candidate({ id: 'W-3', cost_of_delay: 5, reversibility: 'one-way' }),
    ],
    readings({ attention: attention({ decisions_per_digest: 2 }) }),
  );
  assert.deepEqual(
    g.decisions.map((d) => [d.decision, d.deliver]),
    [
      ['W-2', 'digest'],
      ['W-3', 'digest'],
      ['W-1', 'hold'],
    ],
  );
  assert.match(of(g, 'W-2').reason, /place 1 of 2/);
  assert.match(of(g, 'W-1').reason, /hard to undo always waits for the owner/);
  assert.equal(g.budget.decisions_per_digest.left, 2);
});

test('questions already shown and not answered are in front of the person, and use the digest places', () => {
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', sent_at: iso(T0 - 90 * MIN), cost_of_delay: 5 }),
      candidate({ id: 'W-2', sent_at: iso(T0 - 30 * MIN), cost_of_delay: 1 }),
      candidate({ id: 'W-3', cost_of_delay: 3, reversibility: 'one-way' }),
    ],
    readings({ attention: attention({ decisions_per_digest: 2 }) }),
  );
  assert.deepEqual(
    g.waiting.map((w) => [w.decision, w.waiting_minutes]),
    [
      ['W-1', 90],
      ['W-2', 30],
    ],
  );
  assert.equal(of(g, 'W-3').deliver, 'hold', 'two are in front of them already');
  assert.equal(g.budget.decisions_per_digest.in_front, 2);
  assert.equal(g.budget.decisions_per_digest.left, 0);
});

test('a full digest lets an easy-to-undo question take its default, or the recommendation', () => {
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', sent_at: iso(T0 - 30 * MIN) }),
      candidate({
        id: 'W-2',
        reversibility: 'two-way',
        default_if_unanswered: { option: 'B', deadline: iso(T0 + 600 * MIN) },
        cost_of_delay: 2,
      }),
      candidate({ id: 'W-3', reversibility: 'two-way', recommended: 'A', cost_of_delay: 1 }),
      candidate({ id: 'W-4', reversibility: 'one-way', cost_of_delay: 0 }),
      candidate({ id: 'W-5', reversibility: 'two-way', recommended: null, cost_of_delay: 0 }),
    ],
    readings({ attention: attention({ decisions_per_digest: 1 }) }),
  );
  const w2 = of(g, 'W-2');
  assert.equal(w2.deliver, 'default');
  assert.deepEqual(w2.default, {
    option: 'B',
    deadline: iso(T0 + 600 * MIN),
    source: 'default_if_unanswered',
  });
  assert.match(
    w2.reason,
    /the digest is full \(1 decisions in front of the person\) and this one is easy to undo, so it takes its default B/,
  );
  const w3 = of(g, 'W-3');
  assert.equal(w3.deliver, 'default');
  assert.equal(w3.default?.source, 'recommendation');
  assert.equal(of(g, 'W-4').deliver, 'hold', 'hard to undo: always waits');
  assert.equal(of(g, 'W-5').deliver, 'hold', 'nothing to take');
});

test('a default whose deadline has passed is due, shown or not; one on a one-way door is never applied', () => {
  const past = { option: 'B', deadline: iso(T0 - 5 * MIN) };
  const g = deliveryGate(
    [
      candidate({ id: 'W-1', reversibility: 'two-way', default_if_unanswered: past }),
      candidate({
        id: 'W-2',
        reversibility: 'two-way',
        default_if_unanswered: past,
        sent_at: iso(T0 - 50 * MIN),
      }),
      candidate({ id: 'W-3', reversibility: 'one-way', default_if_unanswered: past }),
      candidate({
        id: 'W-4',
        reversibility: 'two-way',
        default_if_unanswered: { option: 'B', deadline: iso(T0 + 5 * MIN) },
      }),
    ],
    readings(),
  );
  assert.equal(of(g, 'W-1').deliver, 'default');
  assert.match(
    of(g, 'W-1').reason,
    /no answer by .*so it takes B, logged and listed in the next digest/,
  );
  assert.equal(of(g, 'W-2').deliver, 'default', 'a shown question still takes its default');
  assert.notEqual(of(g, 'W-3').deliver, 'default');
  assert.match(of(g, 'W-3').reason, /its default is not applied/);
  assert.equal(of(g, 'W-4').deliver, 'digest', 'not yet due');
});

test('a non-urgent question goes now only when the person allows it and is answering quickly', () => {
  const recent = iso(T0 - 10 * MIN);
  const allowed = attention({ non_urgent_at_once: 1 });
  const base = [
    candidate({ id: 'W-1', cost_of_delay: 3 }),
    candidate({ id: 'W-2', cost_of_delay: 1 }),
  ];
  // Allowed, answering quickly: one goes now (the limit), the other waits for the digest.
  const g = deliveryGate(base, readings({ attention: allowed, lastAnsweredAt: recent }));
  assert.deepEqual(
    g.decisions.map((d) => [d.decision, d.deliver]),
    [
      ['W-1', 'now'],
      ['W-2', 'digest'],
    ],
  );
  assert.match(of(g, 'W-1').reason, /not urgent, but the person answered 10 minutes ago/);
  assert.equal(g.budget.answering_quickly, true);
  // The default setting is 0: nothing non-urgent goes at once, however fast they answer.
  const never = deliveryGate(base, readings({ lastAnsweredAt: recent }));
  assert.ok(never.decisions.every((d) => d.deliver === 'digest'));
  // Not answering quickly: the digest.
  const slow = deliveryGate(
    base,
    readings({ attention: allowed, lastAnsweredAt: iso(T0 - 31 * MIN) }),
  );
  assert.equal(slow.budget.answering_quickly, false);
  assert.ok(slow.decisions.every((d) => d.deliver === 'digest'));
  // One already sent at once and still unanswered uses the allowance.
  const full = deliveryGate(
    base,
    readings({ attention: allowed, lastAnsweredAt: recent, nonUrgentSent: 1 }),
  );
  assert.ok(full.decisions.every((d) => d.deliver === 'digest'));
  // Quiet hours hold it back from going at once; it still goes in the digest.
  const quiet = deliveryGate(
    base,
    readings({
      attention: attention({
        non_urgent_at_once: 1,
        quiet_hours: [{ from: '11:00', to: '13:00' }],
      }),
      lastAnsweredAt: recent,
    }),
  );
  assert.ok(quiet.decisions.every((d) => d.deliver === 'digest'));
  assert.match(of(quiet, 'W-1').reason, /quiet hours keep it from going at once/);
});

// What a decision blocks

test('urgency: what a decision blocks, what it makes ready, the critical path and the cost', () => {
  const work = (/** @type {string} */ id, /** @type {Record<string, any>} */ more = {}) => ({
    id,
    kind: 'work',
    state: 'planned',
    ...more,
  });
  const items = [
    { id: 'W-1', kind: 'decision', state: 'planned' },
    { id: 'W-2', kind: 'decision', state: 'planned' },
    { id: 'W-3', kind: 'decision', state: 'planned' },
    work('W-10', { needs: ['W-1'], estimate_tokens: 50000, priority: 'high' }),
    work('W-11', { needs: ['W-10'], estimate_tokens: 40000 }),
    work('W-12', { needs: ['W-2', 'W-13'], estimate_tokens: 1000, priority: 'low' }),
    work('W-13', { estimate_tokens: 1000 }),
  ];
  const u = decisionUrgency(items);
  assert.deepEqual(u.get('W-1')?.blocks, ['W-10', 'W-11']);
  assert.deepEqual(u.get('W-1')?.unblocks_ready, ['W-10']);
  assert.equal(u.get('W-1')?.critical_path, true, 'it heads the heaviest chain');
  assert.equal(u.get('W-1')?.cost_of_delay, 4 + 2, 'high 4, no priority counts as medium 2');
  assert.deepEqual(u.get('W-2')?.blocks, ['W-12']);
  assert.deepEqual(u.get('W-2')?.unblocks_ready, [], 'W-12 also needs W-13, which is open');
  assert.equal(u.get('W-2')?.critical_path, false);
  assert.equal(u.get('W-2')?.cost_of_delay, 1);
  assert.deepEqual(u.get('W-3'), {
    blocks: [],
    unblocks_ready: [],
    critical_path: false,
    cost_of_delay: 0,
  });
  assert.deepEqual(readyWork(items), ['W-13']);
  assert.deepEqual(readyWork(items, ['W-13']), []);
});

// The whole path: ask, pending, sweep, digest, reverse

/** A project with a clock the test sets, and work items waiting on decisions. */
function setup(start = '2026-11-14T12:00:00Z') {
  const project = makeProject();
  let t = Date.parse(start);
  const set = (/** @type {string} */ time) => {
    t = Date.parse(time);
  };
  const deps = { ...project, now: () => iso(t) };
  /** @param {string} title @param {Record<string, any>} [more] */
  const work = (title, more = {}) =>
    project.tracker.create({
      schema_version: 1,
      kind: 'work',
      title,
      state: 'planned',
      classification: 'public',
      ...more,
    });
  return { project, deps, set, work, advance: (/** @type {number} */ min) => (t += min * MIN) };
}

const question = (/** @type {Record<string, any>} */ more = {}) => ({
  title: 'Add left-pad as a dependency?',
  question: 'May we add left-pad (MIT) as a runtime dependency?',
  context: 'The string padding in the report writer is hand-rolled and has two bugs.',
  options: [
    { label: 'Add it', what_happens: 'one small dependency, MIT licensed' },
    { label: 'Hand-roll', what_happens: 'no dependency; we fix the bugs ourselves' },
  ],
  recommendation: { option: 'A', why: 'A permissive licence and a tiny surface.' },
  triggers: [{ basis: 'security', reason: 'it adds a dependency' }],
  paths: ['package.json'],
  item_kind: 'work',
  classification: 'public',
  reversibility: 'two-way',
  ...more,
});

const settings = (/** @type {Record<string, any>} */ over = {}) => ({
  attention: attention(over),
  cap: 3,
});

test('pending orders the open decisions by cost of delay and says where each goes', () => {
  const { deps, work } = setup();
  const w1 = work('Fix report padding');
  const w2 = work('Pad the footer');
  const w3 = work('Pad the header');
  const cheap = askQuestion(deps, question({ title: 'Cheap one', blocks: [w1] }));
  const costly = askQuestion(deps, question({ title: 'Costly one', blocks: [w2, w3] }));
  const none = askQuestion(deps, question({ title: 'Blocks nothing' }));
  const p = pendingDecisions(deps, settings());
  assert.equal(p.ok, true);
  assert.equal(p.open, 3);
  assert.deepEqual(
    p.decisions.map((d) => d.decision),
    [costly.decision, cheap.decision, none.decision],
    'what waits on it, most first',
  );
  assert.deepEqual(
    p.decisions.map((d) => d.cost_of_delay),
    [4, 2, 0],
  );
  // Every slot is busy or has no ready work: nothing idles, and no estimates make a critical path
  // that picks one chain, so the work behind the costly one is the longest.
  assert.equal(p.budget.interrupts_per_day.left, 3);
  assert.equal(p.budget.decisions_per_digest.left, 5);
  for (const d of p.decisions) assert.ok(['now', 'digest', 'hold', 'default'].includes(d.deliver));
});

test('pending: a decision on the critical path goes now, and sending it uses the day’s interrupts', () => {
  const { deps, work, advance } = setup();
  const head = work('Head of the chain', { estimate_tokens: 90000 });
  const tail = work('Tail of the chain', { estimate_tokens: 90000, needs: [head] });
  const side = work('A side job', { estimate_tokens: 1000 });
  const critical = askQuestion(deps, question({ title: 'On the chain', blocks: [head] }));
  const other = askQuestion(deps, question({ title: 'Off the chain', blocks: [side] }));
  assert.ok(tail);
  const s = settings({ interrupts_per_day: 1 });
  const before = pendingDecisions(deps, s);
  const c = before.decisions.find((d) => d.decision === critical.decision);
  assert.equal(c?.critical_path, true);
  assert.equal(c?.deliver, 'now');
  assert.equal(before.decisions.find((d) => d.decision === other.decision)?.deliver, 'digest');

  // Showing it as an interrupt uses the only one; the next urgent question waits for a digest.
  advance(1);
  const shown = showQuestion(deps, { decision: critical.decision, interrupt: true });
  assert.equal(
    readLedger(deps.store).events.find((e) => e.event === 'sent')?.delivery,
    'interrupt',
  );
  assert.equal(shown.first_showing, true);
  const after = pendingDecisions(deps, s);
  assert.equal(after.budget.interrupts_per_day.used, 1);
  assert.equal(after.budget.interrupts_per_day.left, 0);
  assert.deepEqual(
    after.waiting.map((w) => w.decision),
    [critical.decision],
  );
  // Fresh interrupts return 24 hours later.
  advance(24 * 60);
  assert.equal(pendingDecisions(deps, s).budget.interrupts_per_day.used, 0);
});

test('pending: asking with send is an interrupt; showing for a digest is not', () => {
  const { deps } = setup();
  const sent = askQuestion(deps, question({ title: 'Sent now' }), { send: true });
  const queued = askQuestion(deps, question({ title: 'For the digest' }));
  showQuestion(deps, { decision: queued.decision });
  const sentEvents = readLedger(deps.store).events.filter((e) => e.event === 'sent');
  assert.deepEqual(
    sentEvents.map((e) => [e.decision, e.delivery]),
    [
      [sent.decision, 'interrupt'],
      [queued.decision, 'digest'],
    ],
  );
  const p = pendingDecisions(deps, settings());
  assert.equal(p.budget.interrupts_per_day.used, 1);
  assert.equal(p.budget.decisions_per_digest.in_front, 2);
  assert.equal(p.budget.decisions_per_digest.left, 3);
});

test('pending: quiet hours hold an urgent question, and a person who answered quickly may get others now', () => {
  const { deps, work, set } = setup('2026-11-14T23:30:00Z');
  const w = work('Blocked job', { estimate_tokens: 5000 });
  const urgent = askQuestion(deps, question({ title: 'Urgent', blocks: [w] }));
  const quiet = { quiet_hours: [{ from: '22:00', to: '07:00' }] };
  const held = pendingDecisions(deps, settings(quiet));
  assert.equal(held.decisions[0].deliver, 'hold');
  assert.equal(held.decisions[0].hold_until, '2026-11-15T07:00:00.000Z');
  set('2026-11-15T07:00:00Z');
  assert.equal(pendingDecisions(deps, settings(quiet)).decisions[0].deliver, 'now');
  assert.equal(urgent.ok, true);
});

test('pending: the person answering quickly gets non-urgent questions now, when they allow it', () => {
  const { deps, work, advance } = setup();
  const first = askQuestion(deps, question({ title: 'Answered first' }), { send: true });
  advance(5);
  answerDecision(deps, { decision: first.decision, answer: 'A' });
  advance(5);
  // A heavier chain is the critical path, and its one ready item fills the one slot.
  work('Big job', { estimate_tokens: 90000 });
  const w = work('Blocked job', { estimate_tokens: 1000 });
  askQuestion(deps, question({ title: 'A routine one', blocks: [w] }));
  const allowed = { ...settings({ non_urgent_at_once: 2, interrupts_per_day: 3 }), cap: 1 };
  const p = pendingDecisions(deps, allowed);
  assert.equal(p.decisions[0].critical_path, false);
  assert.equal(p.budget.slots.idle, 0);
  assert.equal(p.budget.answering_quickly, true);
  assert.equal(p.decisions[0].deliver, 'now');
  // The same project with the default settings: it waits for the digest.
  assert.equal(pendingDecisions(deps, { ...settings(), cap: 1 }).decisions[0].deliver, 'digest');
});

test('asking refuses a default on a door that is hard to undo, or one that names no option', () => {
  const { deps } = setup();
  const soon = { option: 'B', deadline: '2026-11-15T12:00:00Z' };
  const oneWay = askQuestion(
    deps,
    question({ reversibility: 'one-way', default_if_unanswered: soon }),
  );
  assert.equal(oneWay.error, 'invalid-default');
  assert.match(oneWay.message, /two-way door only/);
  const unsaid = /** @type {Record<string, any>} */ (question({ default_if_unanswered: soon }));
  delete unsaid.reversibility;
  const noReversibility = askQuestion(deps, unsaid);
  assert.equal(noReversibility.error, 'invalid-default');
  const noOption = askQuestion(
    deps,
    question({ default_if_unanswered: { option: 'Z', deadline: soon.deadline } }),
  );
  assert.equal(noOption.error, 'invalid-default');
  assert.match(noOption.message, /must name one of the options/);
  assert.equal(
    askQuestion(
      deps,
      question({ default_if_unanswered: { option: 'Hand-roll', deadline: soon.deadline } }),
    ).ok,
    true,
    'by label',
  );
});

test('a due default is applied by the sweep, recorded as given by default, and listed in the digest', () => {
  const { deps, project, set } = setup();
  const w = deps.tracker.create({
    schema_version: 1,
    kind: 'work',
    title: 'Waiting job',
    state: 'planned',
    classification: 'public',
  });
  const asked = askQuestion(
    deps,
    question({
      blocks: [w],
      default_if_unanswered: { option: 'B', deadline: '2026-11-14T18:00:00Z' },
    }),
  );
  assert.equal(asked.ok, true);
  // Before the deadline nothing is due.
  let swept = sweepDefaults(deps, settings());
  assert.deepEqual(swept.applied, []);
  assert.equal(project.tracker.get(asked.decision).state, 'planned');

  set('2026-11-14T18:00:01Z');
  const p = pendingDecisions(deps, settings());
  assert.equal(p.decisions[0].deliver, 'default');
  swept = sweepDefaults(deps, settings());
  assert.equal(swept.applied.length, 1);
  assert.equal(swept.applied[0].decision, asked.decision);
  assert.equal(swept.applied[0].reverse_with, `hitld rights reverse ${asked.decision}`);

  const d = project.tracker.get(asked.decision);
  assert.equal(d.state, 'done');
  assert.equal(d.answered_via, 'default');
  assert.equal(d.answered_by, undefined, 'no one answered');
  assert.match(
    String(d.answer),
    /Default applied \(no answer by 2026-11-14T18:00:00Z\): B\. Hand-roll: no dependency/,
  );
  assert.equal(d.answered_at, '2026-11-14T18:00:01.000Z');

  const answered = readLedger(deps.store).events.filter((e) => e.event === 'answered');
  assert.deepEqual(
    answered.map((e) => [e.decision, e.via]),
    [[asked.decision, 'default']],
  );
  const trust = readTrustEvents(deps.store);
  assert.deepEqual(
    trust.filter((e) => e.kind === 'default').map((e) => e.subject),
    [asked.decision],
  );
  assert.equal(
    trust.some((e) => e.kind === 'answered'),
    false,
    'a default is not an answer',
  );
  const area = trustSummary(trust).unassigned ?? Object.values(trustSummary(trust))[0];
  assert.equal(area.defaults, 1);
  assert.equal(area.answered, 0);

  // It is listed in the digest with the way to reverse it.
  assert.deepEqual(
    listDefaults(deps).map((x) => [x.decision, x.reversed, x.reverse_with]),
    [[asked.decision, false, `hitld rights reverse ${asked.decision}`]],
  );
  assert.deepEqual(listDefaults(deps, { since: '2026-11-14T19:00:00Z' }), []);

  // Sweeping again changes nothing.
  assert.deepEqual(sweepDefaults(deps, settings()).applied, []);
  assert.equal(readLedger(deps.store).events.filter((e) => e.event === 'answered').length, 1);
});

test('a full digest sweeps an easy-to-undo question to the recommendation, and a hard-to-undo one waits', () => {
  const { deps, project } = setup();
  const easy = askQuestion(deps, question({ title: 'Easy to undo' }));
  const hard = askQuestion(deps, question({ title: 'Hard to undo', reversibility: 'one-way' }));
  const tiny = settings({ decisions_per_digest: 1 });
  // One place: the first (equal cost, so by age) takes it; the next two cannot.
  const shown = askQuestion(deps, question({ title: 'In front already' }), { send: true });
  assert.equal(shown.ok, true);
  const swept = sweepDefaults(deps, tiny);
  assert.deepEqual(
    swept.applied.map((/** @type {any} */ a) => [a.decision, a.source]),
    [[easy.decision, 'recommendation']],
  );
  assert.match(
    swept.applied[0].answer,
    /Default applied \(the digest was full and it is easy to undo, so it took the recommendation\): A\. Add it/,
  );
  assert.equal(
    project.tracker.get(hard.decision).state,
    'planned',
    'hard to undo: waits for the owner',
  );
  assert.equal(
    project.tracker.get(shown.decision).state,
    'planned',
    'shown: it is the owner’s now',
  );
});

test('a default is read from the ask record, so editing the decision item cannot make one apply', () => {
  const { deps, project, set } = setup();
  const asked = askQuestion(deps, question());
  const version = String(project.tracker.get(asked.decision)._version);
  project.tracker.update(
    asked.decision,
    { default_if_unanswered: { option: 'B', deadline: '2026-11-14T12:00:00Z' } },
    version,
  );
  set('2026-11-15T12:00:00Z');
  const swept = sweepDefaults(deps, settings());
  assert.deepEqual(swept.applied, []);
  assert.equal(project.tracker.get(asked.decision).state, 'planned');
});

test('a default can be reversed once, counted in the trust record, and tells the orchestrator to undo it', () => {
  const { deps, set } = setup();
  const asked = askQuestion(
    deps,
    question({ default_if_unanswered: { option: 'B', deadline: '2026-11-14T13:00:00Z' } }),
  );
  set('2026-11-14T14:00:00Z');
  sweepDefaults(deps, settings());
  const r = recordReversal(deps, { subject: asked.decision, note: 'use the library after all' });
  assert.equal(r.ok, true);
  assert.equal(r.recorded.subject_kind, 'default');
  assert.equal(r.default_reversed, asked.decision);
  assert.match(
    r.next,
    /Undo what that default started and apply the owner's choice \(their note: use the library after all\)/,
  );
  assert.equal(recordReversal(deps, { subject: asked.decision }).error, 'already-reversed');
  const summary = Object.values(trustSummary(readTrustEvents(deps.store)))[0];
  assert.equal(summary.defaults, 1);
  assert.equal(summary.defaults_reversed, 1);
  assert.equal(summary.default_reversal_rate, 1);
  assert.deepEqual(
    listDefaults(deps).map((x) => [x.decision, x.reversed, x.reverse_with]),
    [[asked.decision, true, undefined]],
  );
});

test('a default is not the person’s answer: it is out of decision latency and cannot be rated', () => {
  const { deps, set } = setup();
  const defaulted = askQuestion(
    deps,
    question({ default_if_unanswered: { option: 'B', deadline: '2026-11-14T13:00:00Z' } }),
  );
  const answered = askQuestion(deps, question({ title: 'Answered by the person' }), { send: true });
  set('2026-11-14T12:10:00Z');
  assert.equal(answerDecision(deps, { decision: answered.decision, answer: 'A' }).ok, true);
  set('2026-11-14T14:00:00Z');
  sweepDefaults(deps, settings());
  const s = summarize(readLedger(deps.store).events);
  assert.equal(s.decision_latency_ms.answered, 1);
  assert.equal(s.decision_latency_ms.defaulted, 1);
  assert.equal(s.decision_latency_ms.median, 10 * MIN);
  // The rating after an answer rates the one the person answered, not the default after it.
  const commands = makeCommands({ openTracker: () => deps.tracker });
  const rate = commands.find((c) => c.name === 'rights rate');
  assert.ok(rate?.run);
  return Promise.resolve(
    rate.run({ 'worth-asking': 'yes' }, { cwd: deps.root, env: deps.env }),
  ).then((r) => {
    assert.equal(/** @type {any} */ (r).decision, answered.decision);
    assert.notEqual(/** @type {any} */ (r).decision, defaulted.decision);
  });
});

test('the ledger takes via only on answered, and a delivery only on sent', () => {
  const { deps } = setup();
  assert.throws(
    () =>
      appendEvent(deps.store, { event: 'answered', decision: 'W-1', via: 'someone', at: iso(T0) }),
    LedgerError,
  );
  assert.throws(
    () => appendEvent(deps.store, { event: 'sent', decision: 'W-1', delivery: 'owl', at: iso(T0) }),
    LedgerError,
  );
  assert.equal(
    appendEvent(deps.store, { event: 'sent', decision: 'W-1', delivery: 'interrupt', at: iso(T0) })
      .appended,
    true,
  );
});

// The commands

/** A person file for the commands to read. @param {NodeJS.ProcessEnv} env @param {Record<string, any>} data */
function person(env, data) {
  const loc = settingsLocation('person', { env });
  mkdirSync(loc.dir, { recursive: true });
  writeFileSync(loc.path, JSON.stringify(data), { mode: 0o600 });
}

test('hitld rights pending and sweep read the person file and the project’s ceilings', async () => {
  const { deps, project, work } = setup();
  const base = mkdtempSync(join(tmpdir(), 'hitld-budget-'));
  const env = { ...project.env, XDG_CONFIG_HOME: join(base, 'config') };
  const commands = makeCommands({ openTracker: () => project.tracker });
  const ctx = { cwd: project.root, env };
  /** @param {string} name @param {Record<string, unknown>} [input] */
  const run = async (name, input = {}) => {
    const c = commands.find((x) => x.name === name);
    assert.ok(c?.run, name);
    return /** @type {Record<string, any>} */ (await c.run(input, ctx));
  };
  const w = work('Blocked job', { estimate_tokens: 9000 });
  askQuestion(deps, question({ blocks: [w] }));

  // No person file: the conservative defaults.
  let p = await run('rights pending');
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.budget.decisions_per_digest.limit, 5);
  assert.equal(p.budget.interrupts_per_day.limit, 3);
  assert.equal(p.budget.non_urgent_at_once.limit, 0);

  // The person's own values.
  person(env, {
    schema_version: 2,
    attention: { decisions_per_digest: 7, interrupts_per_day: 1, quiet_hours: [], timezone: 'UTC' },
  });
  p = await run('rights pending');
  assert.equal(p.budget.decisions_per_digest.limit, 7);
  assert.equal(p.budget.interrupts_per_day.limit, 1);
  assert.equal(p.decisions[0].deliver, 'now');

  // A broken person file stops it with the reason.
  person(env, { schema_version: 4 });
  const bad = await run('rights pending');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'settings');
  assert.match(bad.errors[0].message, /upgrade human-in-the-lead/);
  person(env, { schema_version: 2, attention: { quiet_hours: [], timezone: 'UTC' } });

  // The sweep applies a default once it is due (the commands run on the real clock), and the
  // digest lists it. The question on the critical path is not touched.
  assert.deepEqual((await run('rights sweep')).applied, []);
  const asked = askQuestion(
    deps,
    question({
      title: 'A default that is due',
      default_if_unanswered: { option: 'B', deadline: iso(Date.now() - 60 * MIN) },
    }),
  );
  const swept = await run('rights sweep');
  assert.deepEqual(
    swept.applied.map((/** @type {any} */ a) => a.decision),
    [asked.decision],
  );
  assert.equal(project.tracker.get(asked.decision).answered_via, 'default');
  const digest = await run('rights digest');
  assert.deepEqual(
    digest.defaults.map((/** @type {any} */ d) => d.decision),
    [asked.decision],
  );
  const reversed = await run('rights reverse', { subject: asked.decision, note: 'wanted A' });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.recorded.subject_kind, 'default');
});

test('rights pending and rights sweep are the orchestrator’s: an executor is refused', async () => {
  const { project } = setup();
  const commands = makeCommands({ openTracker: () => project.tracker });
  for (const name of ['rights pending', 'rights sweep']) {
    const c = commands.find((x) => x.name === name);
    const r = /** @type {any} */ (
      await c?.run?.({}, { cwd: project.root, env: { ...project.env, HITLD_ROLE: 'executor' } })
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-permitted');
  }
});

test('with the files tracker: pending ranks what is blocked, and a due default closes the decision file', async () => {
  const c = makeConsumer({
    files: {
      'work/initiatives/W-6-tools.md': item(
        { id: 'W-6', title: 'Tools', kind: 'initiative', state: 'planned', owner: 'owner' },
        '\n## Goal\n\n',
      ),
      'work/projects/W-7-dependencies.md': item(
        {
          id: 'W-7',
          title: 'Dependencies',
          kind: 'project',
          state: 'planned',
          initiative: 'W-6',
          owner: 'owner',
        },
        '\n## Summary\n\n',
      ),
    },
  });
  const ask = (/** @type {Record<string, any>} */ more) =>
    c.hitld([
      'rights',
      'ask',
      '--question',
      JSON.stringify({ ...question(), parent: 'W-7', ...more }),
    ]);
  const blocking = await ask({ title: 'Blocks W-2', blocks: ['W-2'] });
  assert.equal(blocking.result.outcome, 'asked', JSON.stringify(blocking.result));
  const due = await ask({
    title: 'Due',
    default_if_unanswered: { option: 'B', deadline: iso(Date.now() - 60 * MIN) },
  });
  assert.equal(due.result.outcome, 'asked', JSON.stringify(due.result));

  const pending = await c.hitld(['rights', 'pending']);
  assert.equal(pending.result.ok, true, JSON.stringify(pending.result));
  assert.equal(pending.result.open, 2);
  const byId = Object.fromEntries(
    pending.result.decisions.map((/** @type {any} */ d) => [d.decision, d]),
  );
  assert.deepEqual(byId[blocking.result.decision].blocks, ['W-2']);
  assert.equal(byId[due.result.decision].deliver, 'default');
  assert.equal(pending.result.decisions[0].decision, blocking.result.decision, 'costlier first');

  const swept = await c.hitld(['rights', 'sweep']);
  assert.deepEqual(
    swept.result.applied.map((/** @type {any} */ a) => a.decision),
    [due.result.decision],
    JSON.stringify(swept.result),
  );
  const shown = (await c.hitld(['work', 'show', due.result.decision, '--json'])).result.entity;
  assert.equal(shown.state, 'done');
  assert.equal(shown.answered_via, 'default');
  assert.equal(shown.answered_by, undefined);
  assert.match(shown.answer, /^Default applied \(no answer by /);
  const check = await c.hitld(['work', 'check']);
  const mine = (check.result.problems ?? []).filter((/** @type {string} */ p) =>
    new RegExp(due.result.decision).test(p),
  );
  assert.deepEqual(mine, []);
  const digest = await c.hitld(['rights', 'digest']);
  assert.deepEqual(
    digest.result.defaults.map((/** @type {any} */ d) => d.decision),
    [due.result.decision],
  );
});
