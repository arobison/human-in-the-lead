import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from './helpers/memory-store.mjs';
import {
  LEDGER_KEY,
  LedgerError,
  appendEvent,
  nextDispatchId,
  readLedger,
} from '../lib/ledger/ledger.mjs';
import { inflight, liveDispatch } from '../lib/ledger/inflight.mjs';
import { effectiveEvents, summarize, summary } from '../lib/ledger/summary.mjs';

const clock = (start = '2026-11-14T03:00:00Z', stepMs = 1000) => {
  let t = Date.parse(start);
  return () => new Date((t += stepMs));
};

/** @param {Record<string, unknown>} event */
const dispatched = (event) => ({ event: 'dispatched', role: 'executor', tier: 2, ...event });

test('a ledger written before HITLD-82 is read in the new names, and never rewritten', () => {
  const store = memoryStore();
  const old = [
    { event: 'dispatched', dispatch: 'D-1', item: 'W-1', role: 'executor' },
    { event: 'claimed', dispatch: 'D-1', item: 'W-1', harness: 'fake', handle: 'fake-1' },
    { event: 'question', decision: 'W-9', dispatch: 'D-1' },
    { event: 'reported', dispatch: 'D-1', item: 'W-1', outcome: 'done' },
    { event: 'verified', item: 'W-1', outcome: 'pass' },
    { event: 'released', item: 'W-2' },
  ].map((e, i) => ({ schema_version: 1, id: `E-${i + 1}`, at: '2026-11-01T00:00:00Z', ...e }));
  const text = old.map((e) => `${JSON.stringify(e)}\n`).join('');
  store.write(LEDGER_KEY, text);
  const { events, problems } = readLedger(store);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    events.map((e) => [e.event, e.result ?? null, e.harness_ref ?? null, e.schema_version]),
    [
      ['dispatched', null, null, 1],
      ['started', null, 'fake-1', 1],
      ['asked', null, null, 1],
      ['reported', 'done', null, 1],
      ['verified', 'pass', null, 1],
      ['unclaimed', null, null, 1],
    ],
  );
  assert.equal(
    events.some((e) => 'outcome' in e || 'handle' in e),
    false,
  );
  assert.deepEqual(inflight(events), []);
  appendEvent(store, { event: 'asked', decision: 'W-10' });
  assert.ok((store.read(LEDGER_KEY) ?? '').startsWith(text), 'old lines are kept as written');
});

test('append fills in the schema version, a unique ID and the time, and writes one line', () => {
  const store = memoryStore();
  const now = clock();
  const a = appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }), { now });
  const b = appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }), { now });
  assert.equal(a.event.id, 'E-1');
  assert.equal(b.event.id, 'E-2');
  assert.equal(a.event.schema_version, 2);
  assert.match(a.event.at, /^2026-11-14T03:00:01/);
  const lines = (store.read(LEDGER_KEY) ?? '').trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).dispatch, 'D-2');
});

test('append refuses invalid events with the reason', () => {
  const store = memoryStore();
  /** @param {Record<string, unknown>} e @param {RegExp} message */
  const refused = (e, message) =>
    assert.throws(
      () => appendEvent(store, e),
      (err) => err instanceof LedgerError && message.test(err.message),
    );
  refused({ event: 'exploded' }, /event/);
  refused({ event: 'dispatched', dispatch: 'D-1' }, /item is required for dispatched/);
  refused({ event: 'verified', item: 'W-1' }, /result is required for verified/);
  refused({ event: 'verified', item: 'W-1', result: 'done' }, /must be pass or fail/);
  refused({ event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'pass' }, /must be done/);
  refused({ event: 'merged', item: 'W-1', defects: 2 }, /only for a failed verification/);
  refused({ event: 'merged', item: 'W-1', surprise: 1 }, /not a known key/);
  refused({ event: 'merged', item: 'not an id' }, /item/);
  assert.equal(store.read(LEDGER_KEY), null, 'nothing was written');
});

test('an event with an ID already in the ledger is not appended twice', () => {
  const store = memoryStore();
  const event = dispatched({ id: 'dispatched-D-1', dispatch: 'D-1', item: 'W-1' });
  assert.equal(appendEvent(store, event, { now: clock() }).appended, true);
  const again = appendEvent(store, event, { now: clock('2026-11-14T09:00:00Z') });
  assert.equal(again.appended, false);
  assert.equal(readLedger(store).events.length, 1);
  assert.throws(
    () => appendEvent(store, { ...event, item: 'W-2' }),
    /already exists with different content/,
  );
});

test('a dispatch is dispatched once and ends once', () => {
  const store = memoryStore();
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }));
  assert.throws(
    () => appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' })),
    /already dispatched/,
  );
  appendEvent(store, { event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done' });
  assert.throws(
    () => appendEvent(store, { event: 'abandoned', dispatch: 'D-1', item: 'W-1' }),
    /already ended with reported/,
  );
  // work on it can still be verified and merged
  appendEvent(store, { event: 'verified', dispatch: 'D-1', item: 'W-1', result: 'pass' });
});

test('a correction names an event that exists', () => {
  const store = memoryStore();
  const { event } = appendEvent(store, { event: 'merged', item: 'W-1' });
  assert.throws(
    () => appendEvent(store, { event: 'merged', item: 'W-1', corrects: 'E-99' }),
    /E-99/,
  );
  assert.equal(
    appendEvent(store, { event: 'reverted', item: 'W-1', corrects: event.id }).appended,
    true,
  );
});

test('dispatch IDs continue from the ledger', () => {
  const store = memoryStore();
  assert.equal(nextDispatchId(store), 'D-1');
  appendEvent(store, dispatched({ dispatch: 'D-7', item: 'W-1' }));
  assert.equal(nextDispatchId(store), 'D-8');
});

test('a torn last line is ignored when reading and cut off by the next append', () => {
  const files = new Map();
  const store = memoryStore(files);
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }));
  files.set(LEDGER_KEY, (files.get(LEDGER_KEY) ?? '') + '{"schema_version":1,"id":"E-2","eve');
  const read = readLedger(store);
  assert.equal(read.events.length, 1);
  assert.equal(read.torn, true);
  assert.deepEqual(read.problems, []);
  appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }));
  const after = readLedger(store);
  assert.equal(after.events.length, 2);
  assert.equal(after.torn, false);
  assert.deepEqual(after.problems, []);
});

test('a whole last line that only lacks its newline is kept', () => {
  const files = new Map();
  const store = memoryStore(files);
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }));
  files.set(LEDGER_KEY, (files.get(LEDGER_KEY) ?? '').trimEnd());
  assert.equal(readLedger(store).events.length, 1);
  appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }));
  assert.equal(readLedger(store).events.length, 2);
});

test('lines that are not valid events are reported, not thrown', () => {
  const files = new Map([
    [LEDGER_KEY, '{"t":"2026-11-14","event":"dispatch","item":"v0a-foundation"}\nnot json\n'],
  ]);
  const read = readLedger(memoryStore(files));
  assert.deepEqual(read.events, []);
  assert.equal(read.problems.length, 2);
  assert.equal(read.problems[0].line, 1);
  assert.equal(summary(memoryStore(files)).ledger_problems.length, 2);
});

test('inflight: dispatches without a terminal event', () => {
  const store = memoryStore();
  const now = clock();
  appendEvent(
    store,
    dispatched({ dispatch: 'D-1', item: 'W-1', branch: 'hitld/W-1-a', host: 'example-laptop' }),
    { now },
  );
  appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }), { now });
  appendEvent(store, dispatched({ dispatch: 'D-3', item: 'W-3' }), { now });
  appendEvent(
    store,
    { event: 'started', dispatch: 'D-1', item: 'W-1', harness: 'fake', harness_ref: 'fake-1' },
    { now },
  );
  appendEvent(store, { event: 'reported', dispatch: 'D-2', item: 'W-2', result: 'done' }, { now });
  appendEvent(store, { event: 'abandoned', dispatch: 'D-3', item: 'W-3' }, { now });
  const list = inflight(store);
  assert.deepEqual(
    list.map((d) => [d.dispatch, d.item, d.harness, d.harness_ref, d.host, d.branch]),
    [['D-1', 'W-1', 'fake', 'fake-1', 'example-laptop', 'hitld/W-1-a']],
  );
});

/** A ledger with known answers, as events. */
function fixtureEvents() {
  const store = memoryStore();
  const now = clock('2026-11-14T00:00:00Z', 60_000);
  /** @param {Record<string, unknown>} e */
  const add = (e) => appendEvent(store, e, { now });
  // W-1: accepted at first pass. 1000 executor tokens, 200 verifier tokens.
  add(dispatched({ dispatch: 'D-1', item: 'W-1' }));
  add({ event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 1000 });
  add({ event: 'verified', dispatch: 'D-1', item: 'W-1', result: 'pass' });
  add({ event: 'dispatched', dispatch: 'D-2', item: 'W-1', role: 'acceptance', tier: 1 });
  add({
    event: 'reported',
    dispatch: 'D-2',
    item: 'W-1',
    role: 'acceptance',
    result: 'done',
    tokens: 200,
  });
  add({ event: 'merged', item: 'W-1' });
  // W-2: failed verification, redone, accepted. D-3 (500) is waste; D-4 (700) is not.
  add(dispatched({ dispatch: 'D-3', item: 'W-2' }));
  add({ event: 'reported', dispatch: 'D-3', item: 'W-2', result: 'done', tokens: 500 });
  add({ event: 'verified', dispatch: 'D-3', item: 'W-2', result: 'fail', defects: 2 });
  add(dispatched({ dispatch: 'D-4', item: 'W-2' }));
  add({ event: 'reported', dispatch: 'D-4', item: 'W-2', result: 'done', tokens: 700 });
  add({ event: 'verified', dispatch: 'D-4', item: 'W-2', result: 'pass' });
  add({ event: 'merged', item: 'W-2' });
  // W-3: abandoned (300 tokens), never accepted.
  add(dispatched({ dispatch: 'D-5', item: 'W-3' }));
  add({ event: 'abandoned', dispatch: 'D-5', item: 'W-3', tokens: 300 });
  // W-4: merged, then reverted: not accepted; its 400 tokens are waste.
  add(dispatched({ dispatch: 'D-6', item: 'W-4' }));
  add({ event: 'reported', dispatch: 'D-6', item: 'W-4', result: 'done', tokens: 400 });
  add({ event: 'merged', item: 'W-4' });
  add({ event: 'reverted', dispatch: 'D-6', item: 'W-4' });
  // Two decisions: one answered after 10 minutes, one after 30, one still open.
  add({ event: 'asked', decision: 'W-90' });
  add({ event: 'asked', decision: 'W-91' });
  add({ event: 'asked', decision: 'W-92' });
  add({ event: 'answered', decision: 'W-90' });
  return readLedger(store).events;
}

test('summary: tokens per accepted item, first-pass yield, waste and decision latency', () => {
  const s = summarize(fixtureEvents());
  assert.equal(s.items_accepted, 2);
  assert.deepEqual(s.tokens_per_accepted_item.by_item, { 'W-1': 1200, 'W-2': 1200 });
  assert.equal(s.tokens_per_accepted_item.mean, 1200);
  // W-1 first-pass; W-2 had two executor dispatches and a failed verification.
  assert.deepEqual(
    [s.first_pass_yield.value, s.first_pass_yield.passed, s.first_pass_yield.of],
    [0.5, 1, 2],
  );
  assert.equal(s.waste.tokens, 500 + 300 + 400);
  assert.deepEqual(s.waste.by_cause, { abandoned: 300, failed_verification: 500, reverted: 400 });
  assert.equal(s.waste.dispatches, 3);
  assert.equal(s.waste.share_of_tokens, 1200 / 3100);
  assert.equal(s.decision_latency_ms.answered, 1);
  assert.equal(s.decision_latency_ms.open, 2);
  assert.equal(s.decision_latency_ms.median, 3 * 60_000);
});

test('summary: a correction replaces the event it names', () => {
  const store = memoryStore();
  const now = clock();
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }), { now });
  const wrong = appendEvent(
    store,
    { event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 9999 },
    { now },
  );
  appendEvent(
    store,
    {
      event: 'reported',
      dispatch: 'D-1',
      item: 'W-1',
      result: 'done',
      tokens: 900,
      corrects: wrong.event.id,
    },
    { now },
  );
  appendEvent(store, { event: 'merged', item: 'W-1' }, { now });
  assert.equal(summarize(readLedger(store).events).tokens_per_accepted_item.total, 900);
});

test('summary: what cannot be computed is null, not zero', () => {
  const s = summary(memoryStore());
  assert.equal(s.items_accepted, 0);
  assert.equal(s.tokens_per_accepted_item.mean, null);
  assert.equal(s.first_pass_yield.value, null);
  assert.equal(s.waste.share_of_tokens, null);
  assert.equal(s.decision_latency_ms.median, null);
});

test('summary: dispatches without token counts are counted, not treated as zero', () => {
  const store = memoryStore();
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }));
  appendEvent(store, {
    event: 'reported',
    dispatch: 'D-1',
    item: 'W-1',
    result: 'done',
    tokens: null,
  });
  appendEvent(store, { event: 'merged', item: 'W-1' });
  assert.equal(summary(store).tokens_per_accepted_item.dispatches_without_token_counts, 1);
});

test('liveDispatch: only a claimed dispatch that has not ended, with its role and grants', () => {
  const store = memoryStore();
  const now = clock();
  /** @param {Record<string, unknown>} e */
  const add = (e) => appendEvent(store, e, { now });
  add(
    dispatched({
      dispatch: 'D-1',
      item: 'W-1',
      run: 'R1',
      serial_resources: ['gpu'],
      host: 'example-laptop',
    }),
  );
  assert.equal(liveDispatch(store, 'D-1', 'R1'), null, 'not claimed yet');
  add({ event: 'started', dispatch: 'D-1', item: 'W-1', harness: 'fake', harness_ref: 'fake-1' });
  const live = liveDispatch(store, 'D-1', 'R1');
  assert.deepEqual(
    [live?.role, live?.grants, live?.harness_ref, live?.item],
    ['executor', ['gpu'], 'fake-1', 'W-1'],
  );
  assert.equal(liveDispatch(store, 'D-9', 'R1'), null, 'unknown');
  add({ event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done' });
  assert.equal(liveDispatch(store, 'D-1', 'R1'), null, 'reported');
  add(dispatched({ dispatch: 'D-2', item: 'W-2', run: 'R1' }));
  add({ event: 'started', dispatch: 'D-2', item: 'W-2', harness: 'fake', harness_ref: 'fake-2' });
  add({ event: 'abandoned', dispatch: 'D-2', item: 'W-2' });
  assert.equal(liveDispatch(store, 'D-2', 'R1'), null, 'abandoned');
});

test('liveDispatch: a dispatch recorded under another run is not live', () => {
  const store = memoryStore();
  const now = clock();
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1', run: 'R-old' }), { now });
  appendEvent(
    store,
    { event: 'started', dispatch: 'D-1', item: 'W-1', harness: 'fake', harness_ref: 'h' },
    { now },
  );
  assert.equal(liveDispatch(store, 'D-1', 'R-old')?.dispatch, 'D-1');
  assert.equal(liveDispatch(store, 'D-1', 'R-new'), null);
  appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }), { now }); // no run at all
  appendEvent(
    store,
    { event: 'started', dispatch: 'D-2', item: 'W-2', harness: 'fake', harness_ref: 'h' },
    { now },
  );
  assert.equal(liveDispatch(store, 'D-2', 'R-new'), null);
});

test('summary: a stray correction (another kind, or another item) hides nothing', () => {
  const store = memoryStore();
  const now = clock();
  appendEvent(store, dispatched({ dispatch: 'D-1', item: 'W-1' }), { now });
  const reported = appendEvent(
    store,
    { event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 900 },
    { now },
  );
  // a verified event (another kind) and a reported event about another item both name it
  appendEvent(
    store,
    { event: 'verified', item: 'W-1', result: 'pass', corrects: reported.event.id },
    { now },
  );
  appendEvent(store, dispatched({ dispatch: 'D-2', item: 'W-2' }), { now });
  appendEvent(
    store,
    {
      event: 'reported',
      dispatch: 'D-2',
      item: 'W-2',
      result: 'done',
      tokens: 1,
      corrects: reported.event.id,
    },
    { now },
  );
  appendEvent(store, { event: 'merged', item: 'W-1' }, { now });
  const events = readLedger(store).events;
  assert.equal(effectiveEvents(events).length, events.length);
  assert.equal(summarize(events).tokens_per_accepted_item.total, 900);
});
