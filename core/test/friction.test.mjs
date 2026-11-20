// Friction signals are recorded from the session record (HITLD-595): a dropped question, a
// question asked again, a restart, an interrupt, a compaction, a reply lost while a box was open
// and a permission denial each become a friction event in the ledger, with a class, a source, an
// evidence reference and the decision count, and a second scan adds nothing. Semantic classes come
// only from an independent reader whose lines pass the checks, measured against a sample rated by
// hand. The fixture's messages are made up for the test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionFriction } from '../harness/claude-code/friction.mjs';
import {
  FRICTION_CLASSES,
  acceptClassified,
  agreement,
  decisionsAt,
  recordFriction,
} from '../lib/friction/friction.mjs';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { main } from '../lib/cli/main.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { tempDir } from './helpers/tmp.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'friction');
const RECORD = readFileSync(join(HERE, 'session-record.json'), 'utf8');
const SAMPLE = JSON.parse(readFileSync(join(HERE, 'rated-sample.json'), 'utf8')).sample;

/** What a reader that agrees with the hand-rated sample returns, with its quotes. */
const READER = [
  { ref: 'ev-02', class: null },
  { ref: 'ev-06', class: 'repeated-instruction', quote: 'as I said', confidence: 0.8 },
  {
    ref: 'ev-14',
    class: 'repeated-instruction',
    quote: 'Ask me one at a time, as I asked before.',
    confidence: 0.95,
  },
  { ref: 'ev-15', class: 'owner-correction', quote: 'that was already decided', confidence: 0.9 },
  {
    ref: 'ev-18',
    class: 'bundled-question',
    quote: 'and should it also file items, and where should it write?',
    confidence: 0.85,
  },
  { ref: 'ev-20', class: null },
];

/** A store with two owner decisions settled before the record starts and one during it. */
function storeWithDecisions() {
  const store = openStore(tempDir('hitld-friction-store-'));
  for (const [i, at] of ['2026-11-20T09:00:00.000Z', '2026-11-20T09:30:00.000Z'].entries()) {
    appendEvent(store, { event: 'answered', decision: `HITLD-${900 + i}`, at });
  }
  appendEvent(store, {
    event: 'answered',
    decision: 'HITLD-902',
    via: 'default',
    at: '2026-11-20T09:40:00.000Z',
  });
  appendEvent(store, { event: 'answered', decision: 'HITLD-903', at: '2026-11-20T10:06:30.000Z' });
  return store;
}

test('a session record yields one observation for each deterministic class, with its cause', () => {
  const { observations } = sessionFriction(RECORD);
  assert.deepEqual(
    observations.map((o) => [o.class, o.ref, o.cause ?? null]),
    [
      ['question-dropped', 'ev-03', 'restart'],
      ['worker-restart', 'ev-04', null],
      ['question-repeated', 'ev-05', 'dropped'],
      ['reply-lost', 'ev-06', 'box-open'],
      ['owner-interrupt', 'ev-09', null],
      ['permission-denied', 'ev-12', null],
      ['compaction', 'ev-13', null],
    ],
  );
  const deterministic = Object.entries(FRICTION_CLASSES)
    .filter(([, c]) => c.kind === 'deterministic')
    .map(([k]) => k);
  assert.deepEqual(new Set(observations.map((o) => o.class)), new Set(deterministic));
});

test("the reader is given the owner's own words and the questions, never notices or other sessions' messages", () => {
  const { messages } = sessionFriction(RECORD);
  assert.deepEqual(
    messages.map((m) => [m.ref, m.kind]),
    [
      ['ev-02', 'owner'],
      ['ev-03', 'question'],
      ['ev-05', 'question'],
      ['ev-06', 'owner'],
      ['ev-14', 'owner'],
      ['ev-15', 'owner'],
      ['ev-18', 'question'],
      ['ev-20', 'owner'],
    ],
  );
});

test('the dropped and repeated questions of a run appear in the ledger, and a second scan adds nothing', () => {
  const store = storeWithDecisions();
  assert.equal(
    readLedger(store).events.filter((e) => e.event === 'friction').length,
    0,
    'no friction in the ledger before the scan',
  );
  const scan = { ...sessionFriction(RECORD), session: 'session-under-test' };
  const first = recordFriction(store, scan);
  assert.equal(first.appended.length, 7);
  const { events, problems } = readLedger(store);
  assert.deepEqual(problems, []);
  const friction = events.filter((e) => e.event === 'friction');
  for (const e of friction) {
    assert.deepEqual(schemas().validateEntity('ledger-entry', e), []);
    assert.equal(e.id, `friction-${e.friction_class}-${e.evidence.ref}`);
    assert.equal(e.at, e.evidence.at);
    assert.equal(e.session, 'session-under-test');
    assert.equal(e.evidence.quote, undefined, 'a deterministic class copies no text');
  }
  const dropped = friction.find((e) => e.friction_class === 'question-dropped');
  assert.deepEqual(
    {
      source: dropped?.source,
      evidence: dropped?.evidence,
      decisions: dropped?.decisions,
      cause: dropped?.cause,
    },
    {
      source: 'system',
      evidence: { ref: 'ev-03', at: '2026-11-20T10:02:00.000Z' },
      decisions: 2,
      cause: 'restart',
    },
  );
  assert.equal(friction.find((e) => e.friction_class === 'compaction')?.decisions, 3);
  assert.equal(friction.find((e) => e.friction_class === 'permission-denied')?.source, 'delegate');

  const again = recordFriction(store, scan);
  assert.equal(again.appended.length, 0);
  assert.equal(again.already, 7);
  assert.equal(readLedger(store).events.length, events.length);
});

test("semantic classes are recorded only from the reader's lines that pass, and nothing is guessed", () => {
  const { messages } = sessionFriction(RECORD);
  const sloppy = [
    ...READER.filter((l) => l.ref !== 'ev-15' && l.ref !== 'ev-18' && l.ref !== 'ev-06'),
    { ref: 'ev-15', class: 'owner-correction', quote: 'the owner disagreed', confidence: 0.9 },
    {
      ref: 'ev-18',
      class: 'owner-correction',
      quote: 'Should the scan run nightly',
      confidence: 1,
    },
    { ref: 'ev-06', class: 'repeated-instruction', quote: 'as I said', confidence: 0.4 },
    { ref: 'ev-99', class: 'owner-correction', quote: 'x', confidence: 1 },
    { ref: 'ev-20', class: 'compaction', quote: 'go ahead', confidence: 1 },
  ];
  const r = acceptClassified(messages, sloppy);
  assert.deepEqual(
    r.accepted.map((a) => [a.ref, a.class]),
    [['ev-14', 'repeated-instruction']],
  );
  assert.deepEqual(
    r.rejected.map((x) => x.ref),
    ['ev-15', 'ev-18', 'ev-99', 'ev-20'],
  );
  assert.match(r.rejected[0].reason, /exact part of the message/);
  assert.match(r.rejected[1].reason, /is read from the owner's messages, not questions/);
  assert.ok(r.unclassified.includes('ev-06'), 'below the confidence is left unclassified');

  const long = acceptClassified(messages, [
    { ref: 'ev-14', class: 'repeated-instruction', quote: 'a'.repeat(121), confidence: 1 },
  ]);
  assert.equal(long.accepted.length, 0);
  assert.equal(long.rejected.length, 1);
});

test('a reader is measured against the hand-rated sample', () => {
  const { messages } = sessionFriction(RECORD);
  const good = acceptClassified(messages, READER);
  assert.deepEqual(good.rejected, []);
  const fit = agreement(SAMPLE, good.accepted);
  assert.equal(fit.rate, 1);
  assert.equal(fit.total, SAMPLE.length);

  const partial = acceptClassified(
    messages,
    READER.map((l) => (l.ref === 'ev-15' ? { ref: 'ev-15', class: null } : l)),
  );
  const off = agreement(SAMPLE, partial.accepted);
  assert.equal(off.agreed, SAMPLE.length - 1);
  assert.deepEqual(off.disagreed, [{ ref: 'ev-15', rated: 'owner-correction', read: null }]);
});

test('accepted semantic lines become friction events with their quote and confidence', () => {
  const store = storeWithDecisions();
  const read = sessionFriction(RECORD);
  const { accepted } = acceptClassified(read.messages, READER);
  recordFriction(store, { observations: read.observations, accepted });
  const correction = readLedger(store).events.find((e) => e.friction_class === 'owner-correction');
  assert.deepEqual(
    {
      source: correction?.source,
      evidence: correction?.evidence,
      confidence: correction?.confidence,
      decisions: correction?.decisions,
    },
    {
      source: 'owner',
      evidence: { ref: 'ev-15', at: '2026-11-20T10:12:00.000Z', quote: 'that was already decided' },
      confidence: 0.9,
      decisions: 3,
    },
  );
  assert.equal(decisionsAt(readLedger(store).events, '2026-11-20T09:45:00.000Z'), 2);
});

test('hitld friction scan records the events once, and is refused to an executor', async () => {
  const dir = tempDir('hitld-friction-cli-');
  const record = join(dir, 'record.json');
  const classified = join(dir, 'classified.json');
  writeFileSync(record, RECORD);
  writeFileSync(classified, JSON.stringify(READER));
  const store = join(dir, 'store');
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
  const hitld = async (argv, env = {}) => {
    let out = '';
    const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd: dir, env });
    return { code, result: JSON.parse(out) };
  };
  const args = ['friction', 'scan', '--session-record', record, '--classified', classified];
  const first = await hitld([...args, '--store', store]);
  assert.equal(first.code, 0, JSON.stringify(first.result));
  assert.equal(first.result.appended, 11);
  assert.equal(first.result.by_class['question-dropped'], 1);
  assert.equal(first.result.by_class['repeated-instruction'], 2);
  assert.equal(first.result.unclassified, 4);
  const second = await hitld([...args, '--store', store]);
  assert.equal(second.result.appended, 0);
  assert.equal(second.result.already, 11);

  const refused = await hitld([...args, '--store', store], { HITLD_ROLE: 'executor' });
  assert.equal(refused.result.error, 'not-permitted');

  const messages = await hitld(['friction', 'messages', '--session-record', record]);
  assert.equal(messages.result.messages.length, 8);
});

test('the chief of staff records a correction it recognizes, marked self-recognized, with the decision count', async () => {
  const dir = tempDir('hitld-friction-self-');
  const store = join(dir, 'store');
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    let out = '';
    const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd: dir, env: {} });
    return { code, result: JSON.parse(out) };
  };
  const me = ['--store', store, '--session', 's-1', '--host', 'example-laptop'];
  const started = await hitld(['run', 'start', ...me, '--scope', '{"items":["W-1"]}']);
  assert.equal(started.code, 0, JSON.stringify(started.result));
  await hitld(['ledger', 'append', JSON.stringify({ event: 'answered', decision: 'W-50' }), ...me]);
  const at = new Date(Date.now() + 1000).toISOString();
  const friction = {
    event: 'friction',
    friction_class: 'repeated-instruction',
    source: 'owner',
    evidence: { ref: 'msg-1', at, quote: 'one at a time' },
  };
  // the mark and the count are set here, never by the caller
  const forged = { ...friction, self_recognized: false, decisions: 99 };
  const refused = await hitld(['ledger', 'append', JSON.stringify(forged), ...me]);
  assert.equal(refused.result.error, 'forbidden-field');
  const r = await hitld(['ledger', 'append', JSON.stringify(friction), ...me]);
  assert.equal(r.code, 0, JSON.stringify(r.result));
  assert.equal(r.result.event.self_recognized, true);
  assert.equal(r.result.event.decisions, 1);
  assert.equal(r.result.event.session, 's-1');
});
