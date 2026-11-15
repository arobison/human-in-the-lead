// Attention telemetry (HITLD-85): asked, sent and answered in the ledger, the open decisions in
// the run state and the hand-over, logged calls with a way to reverse each, what an answer records
// about the recommendation and the time taken, and the rubber-stamp indicator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerDecision,
  askQuestion,
  listLoggedCalls,
  logCall,
  rateWorthAsking,
  recordReversal,
  showQuestion,
} from '../lib/rights/flow.mjs';
import { readTrustEvents, rubberStamps, trustSummary } from '../lib/rights/trust.mjs';
import { formatQuestion } from '../lib/rights/format.mjs';
import { LedgerError, appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { handOver, startRun } from '../lib/run/run.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { policyDefaults } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { makeProject } from './helpers/project.mjs';

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

/** A project whose clock the test sets. @param {string} start */
function clocked(start = '2026-11-14T10:00:00Z') {
  const project = makeProject();
  let t = Date.parse(start);
  const at = (/** @type {number} */ secondsLater) => {
    t = Date.parse(start) + secondsLater * 1000;
  };
  return { project: { ...project, now: () => new Date(t).toISOString() }, at };
}

const events = (/** @type {any} */ project, /** @type {string} */ kind) =>
  readLedger(project.store).events.filter((e) => e.event === kind);

test('asking writes asked; showing writes sent once; answering writes answered', () => {
  const { project, at } = clocked();
  const asked = askQuestion(project, question());
  assert.equal(asked.outcome, 'asked');
  assert.deepEqual(
    events(project, 'asked').map((e) => [e.decision, e.at]),
    [[asked.decision, '2026-11-14T10:00:00.000Z']],
  );
  assert.deepEqual(events(project, 'sent'), [], 'asking alone is not showing');

  at(600);
  const shown = showQuestion(project, { decision: asked.decision });
  assert.equal(shown.ok, true);
  assert.equal(shown.first_showing, true);
  assert.equal(shown.text, asked.text, 'the text is the one asking returned');
  assert.equal(events(project, 'sent')[0].at, '2026-11-14T10:10:00.000Z');

  at(900);
  const again = showQuestion(project, { decision: asked.decision });
  assert.equal(again.first_showing, false);
  assert.equal(again.sent_at, '2026-11-14T10:10:00.000Z', 'the first showing stands');
  assert.equal(events(project, 'sent').length, 1);

  at(1200);
  assert.equal(answerDecision(project, { decision: asked.decision, answer: 'A' }).ok, true);
  const answered = events(project, 'answered');
  assert.deepEqual(
    answered.map((e) => [e.decision, e.at]),
    [[asked.decision, '2026-11-14T10:20:00.000Z']],
  );
  // The ledger reads clean: every line is valid against the schema.
  assert.deepEqual(readLedger(project.store).problems, []);
});

test('asking with send records the question as sent at once', () => {
  const { project } = clocked();
  const asked = askQuestion(project, question(), { send: true });
  assert.equal(events(project, 'sent')[0].decision, asked.decision);
  assert.equal(events(project, 'sent')[0].at, events(project, 'asked')[0].at);
});

test('showing refuses what it cannot show', () => {
  const { project } = clocked();
  assert.equal(showQuestion(project, { decision: 'W-99' }).error, 'not-found');
  const asked = askQuestion(project, question());
  answerDecision(project, { decision: asked.decision, answer: 'A' });
  assert.equal(showQuestion(project, { decision: asked.decision }).error, 'not-open');
  const bare = project.tracker.create({
    schema_version: 1,
    kind: 'decision',
    title: 'Made by hand',
    state: 'planned',
    classification: 'public',
  });
  assert.equal(showQuestion(project, { decision: bare }).error, 'no-question-record');
});

test('a decision a precedent resolves is neither asked nor answered in the ledger', () => {
  const { project } = clocked();
  const offer = {
    summary: 'new dependencies with permissive licences',
    rule: 'When a new dependency has a permissive licence, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-licence'] },
  };
  const first = askQuestion(
    project,
    question({ tags: ['dependency-licence'], precedent_offer: offer }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  const second = askQuestion(project, question({ tags: ['dependency-licence', 'x'] }));
  assert.equal(second.outcome, 'precedent');
  assert.deepEqual([events(project, 'asked').length, events(project, 'answered').length], [1, 1]);
  assert.equal(
    events(project, 'asked').some((e) => e.decision === second.decision),
    false,
  );
});

test('an event is written once per decision, even when the orchestrator recorded it first', () => {
  const { project } = clocked();
  appendEvent(project.store, { event: 'asked', decision: 'W-1' });
  project.tracker.create({
    schema_version: 1,
    kind: 'decision',
    title: 'Pre-recorded',
    state: 'planned',
    classification: 'public',
  });
  // W-1 is the tracker's first ID: asking it again must not add a second asked.
  const shown = showQuestion(project, { decision: 'W-1' });
  assert.equal(shown.error, 'no-question-record');
  assert.equal(events(project, 'asked').length, 1);
});

test('queue time and owner time are told apart in the ledger summary', () => {
  const at = (/** @type {number} */ s) =>
    new Date(Date.parse('2026-11-14T10:00:00Z') + s * 1000).toISOString();
  const e = (/** @type {Record<string, any>} */ x, /** @type {number} */ i) => ({
    schema_version: 2,
    id: `E-${i}`,
    ...x,
  });
  const s = summarize([
    // W-1: held 600 s for a digest, then the owner took 60 s.
    e({ event: 'asked', decision: 'W-1', at: at(0) }, 1),
    e({ event: 'sent', decision: 'W-1', at: at(600) }, 2),
    e({ event: 'sent', decision: 'W-1', at: at(650) }, 3),
    e({ event: 'answered', decision: 'W-1', at: at(660) }, 4),
    // W-2: never recorded as shown, so its whole wait is the owner's.
    e({ event: 'asked', decision: 'W-2', at: at(100) }, 5),
    e({ event: 'answered', decision: 'W-2', at: at(400) }, 6),
    // W-3: still open.
    e({ event: 'asked', decision: 'W-3', at: at(200) }, 7),
  ]);
  const latency = s.decision_latency_ms;
  assert.equal(latency.answered, 2);
  assert.equal(latency.open, 1);
  assert.deepEqual(
    [latency.queue.count, latency.queue.median],
    [1, 600_000],
    'only a decision shown has queue time',
  );
  assert.deepEqual([latency.owner.count, latency.owner.median], [2, 60_000]);
  assert.equal(latency.owner.p90, 300_000);
  assert.equal(latency.median, 300_000);
});

test('run state lists open decisions from the ledger, and the hand-over shows them', () => {
  const { project, at } = clocked();
  const run = startRun(project.store, {
    session: 's-1',
    host: 'example-laptop',
    now: () => new Date(project.now()),
  });
  const first = askQuestion(project, question());
  const second = askQuestion(project, question({ title: 'Another?' }));
  at(300);
  showQuestion(project, { decision: second.decision });

  // Written by another process, without the lease: the next checkpoint absorbs it.
  const state = run.checkpoint();
  assert.deepEqual(
    state.decisions_open.map((/** @type {any} */ q) => [q.decision, q.sent_at ?? null]),
    [
      [first.decision, null],
      [second.decision, '2026-11-14T10:05:00.000Z'],
    ],
  );
  assert.deepEqual(schemas().validateEntity('run-state', state), []);
  const text = handOver(state, readLedger(project.store).events).text;
  assert.match(text, /Decisions open \(2\): /);
  assert.match(text, new RegExp(`${first.decision} \\(asked [^,]+, not sent yet\\)`));
  assert.match(text, new RegExp(`${second.decision} \\(asked [^,]+, sent 2026-11-14T10:05`));

  answerDecision(project, { decision: first.decision, answer: 'A' });
  const after = run.checkpoint();
  assert.deepEqual(
    after.decisions_open.map((/** @type {any} */ q) => q.decision),
    [second.decision],
  );
  assert.equal(after.decisions_answered.length, 1);
});

test('the answered trust event records the recommendation and how long the owner took', () => {
  const { project, at } = clocked();
  const taken = askQuestion(project, question(), { send: true });
  at(45);
  const result = answerDecision(project, { decision: taken.decision, answer: 'A' });
  assert.equal(result.took_recommendation, true);
  assert.equal(result.latency_ms, 45_000);
  const line = readTrustEvents(project.store).find(
    (e) => e.kind === 'answered' && e.subject === taken.decision,
  );
  assert.deepEqual([line?.took_recommendation, line?.latency_ms], [true, 45_000]);

  // The clock runs from the question being shown, not from its being asked.
  at(1000);
  const held = askQuestion(project, question({ title: 'Held for a digest?' }));
  at(1600);
  showQuestion(project, { decision: held.decision });
  at(1630);
  const other = answerDecision(project, { decision: held.decision, answer: 'B' });
  assert.equal(other.took_recommendation, false);
  assert.equal(other.latency_ms, 30_000);

  // A decision with no options has none to compare an answer with; one never asked has no time.
  at(2000);
  const free = project.tracker.create({
    schema_version: 1,
    kind: 'decision',
    title: 'Free text?',
    state: 'planned',
    classification: 'public',
  });
  const text = answerDecision(project, { decision: free, answer: 'let us talk first' });
  assert.equal(text.took_recommendation, null);
  const bare = project.tracker.create({
    schema_version: 1,
    kind: 'decision',
    title: 'By hand',
    state: 'planned',
    classification: 'public',
    options: question().options,
    recommendation: question().recommendation,
  });
  const noClock = answerDecision(project, { decision: bare, answer: 'A' });
  assert.equal(noClock.took_recommendation, true);
  assert.equal(noClock.latency_ms, null);
  const stored = readTrustEvents(project.store).filter((e) => e.kind === 'answered');
  assert.equal(stored.at(-2)?.took_recommendation, undefined);
  assert.equal(stored.at(-1)?.latency_ms, undefined);
});

/** One answered trust event. @param {string} area @param {boolean | undefined} took @param {number | undefined} ms @param {string} subject */
const answeredEvent = (area, took, ms, subject) => ({
  schema_version: 1,
  kind: 'answered',
  at: '2026-11-14T10:00:00Z',
  area,
  subject,
  ...(took === undefined ? {} : { took_recommendation: took }),
  ...(ms === undefined ? {} : { latency_ms: ms }),
});

test('the rubber-stamp indicator: the share of answers that took the recommendation quickly', () => {
  const log = [
    answeredEvent('cache', true, 10_000, 'W-1'), // quick, taken
    answeredEvent('cache', true, 59_000, 'W-2'), // quick, taken
    answeredEvent('cache', true, 5 * 60_000, 'W-3'), // taken after thought
    answeredEvent('cache', false, 3_000, 'W-4'), // quick, but chose another option
    answeredEvent('cache', true, undefined, 'W-5'), // no time: left out of the share
    answeredEvent('cache', undefined, 2_000, 'W-6'), // no recommendation outcome: left out
    answeredEvent('api', false, 90_000, 'W-7'),
  ];
  const summary = trustSummary(log);
  assert.deepEqual(
    [
      summary.cache.stamp_known,
      summary.cache.stamped,
      summary.cache.rubber_stamp_rate,
      summary.cache.recommendation_known,
      summary.cache.recommendation_taken_rate,
    ],
    [4, 2, 0.5, 5, 0.8],
  );
  assert.equal(summary.api.rubber_stamp_rate, 0);
  assert.equal(trustSummary([]).cache, undefined);
  // The threshold is a setting: with 5 minutes, the slow one counts too.
  assert.equal(trustSummary(log, { rubberStampSeconds: 300 }).cache.rubber_stamp_rate, 0.75);

  const report = rubberStamps(log);
  assert.deepEqual(
    report.map((r) => [r.area, r.rubber_stamp_rate, r.quick_and_agreeing, r.answers]),
    [
      ['cache', 0.5, 2, 4],
      ['api', 0, 0, 1],
    ],
  );
  assert.equal(report[0].quick_seconds, 60);
  assert.deepEqual(rubberStamps([answeredEvent('cache', undefined, undefined, 'W-1')]), []);
  assert.equal(policyDefaults().trust?.rubber_stamp_seconds, 60);
});

test('the indicator comes from real answers, by area', () => {
  const { project, at } = clocked();
  for (const [i, answer] of ['A', 'A', 'B'].entries()) {
    at(i * 1000);
    const q = askQuestion(project, question({ title: `Q${i}?`, paths: ['src/cache/a.ts'] }), {
      send: true,
    });
    at(i * 1000 + 20);
    answerDecision(project, { decision: q.decision, answer });
  }
  const cache = trustSummary(readTrustEvents(project.store)).cache;
  assert.deepEqual([cache.stamp_known, cache.stamped, cache.rubber_stamp_rate], [3, 2, 0.667]);
});

test('"worth asking?": a rating right after an answer rates that decision; a later one replaces it', () => {
  const { project, at } = clocked();
  assert.equal(
    /** @type {any} */ (rateWorthAsking(project, { worth: false })).error,
    'nothing-to-rate',
  );
  const one = askQuestion(project, question({ title: 'One?' }), { send: true });
  const two = askQuestion(project, question({ title: 'Two?' }), { send: true });
  at(30);
  answerDecision(project, { decision: one.decision, answer: 'A', worth_asking: true });
  answerDecision(project, { decision: two.decision, answer: 'A' });
  // "That was not worth asking", said right after the second answer.
  const rated = rateWorthAsking(project, { worth: false });
  assert.equal(rated.decision, two.decision);
  assert.deepEqual(
    readTrustEvents(project.store)
      .filter((e) => e.kind === 'worth-asking')
      .map((e) => [e.subject, e.worth_asking]),
    [
      [one.decision, true],
      [two.decision, false],
    ],
  );
  // The owner changes their mind about the first: it counts once, as no.
  rateWorthAsking(project, { decision: one.decision, worth: false });
  const a = trustSummary(readTrustEvents(project.store)).unassigned;
  assert.deepEqual([a.rated, a.worth_asking, a.escalation_worth], [2, 0, 0]);
});

test('every question offers the optional "worth asking?" tap', () => {
  const { project } = clocked();
  const asked = askQuestion(project, question());
  assert.match(asked.text, /Optional, after you answer: was this worth asking\?/);
  assert.match(formatQuestion({ id: 'W-1', question: 'Q?' }), /worth asking/);
});

test('logged calls: a ledger event with the way to reverse it, listed for the digest', () => {
  const { project, at } = clocked();
  assert.equal(logCall(project, { text: '' }).error, 'invalid-call');
  assert.equal(logCall(project, { text: 'x'.repeat(501) }).error, 'invalid-call');
  assert.equal(
    logCall(project, { text: 'Ordered W-3 before W-4', item: 'not an id' }).error,
    'invalid-call',
  );

  const first = logCall(project, {
    text: 'Chose the in-memory cache for the report writer',
    item: 'W-3',
    area: 'cache',
  });
  assert.equal(first.ok, true);
  at(120);
  const second = logCall(project, { text: 'Kept the default timeout', dispatch: 'D-2' });
  const stored = events(project, 'logged');
  assert.deepEqual(
    stored.map((e) => [e.id, e.text, e.item ?? null, e.dispatch ?? null, e.area ?? null]),
    [
      [first.id, 'Chose the in-memory cache for the report writer', 'W-3', null, 'cache'],
      [second.id, 'Kept the default timeout', null, 'D-2', null],
    ],
  );
  assert.equal(first.reverse_with, `hitld rights reverse ${first.id}`);

  const listed = listLoggedCalls(project);
  assert.deepEqual(
    listed.map((c) => [c.id, c.area, c.reversed, c.reverse_with]),
    [
      [first.id, 'cache', false, `hitld rights reverse ${first.id}`],
      [second.id, 'unassigned', false, `hitld rights reverse ${second.id}`],
    ],
  );
  assert.deepEqual(
    listLoggedCalls(project, { since: stored[0].at }).map((c) => c.id),
    [second.id],
    'a digest lists only what is newer than the last one',
  );

  // Reversing by the ID the digest gave: the kind and the area are the call's.
  const reversed = recordReversal(project, { subject: first.id, note: 'wrong default' });
  assert.equal(reversed.ok, true);
  assert.deepEqual(
    [reversed.recorded.subject_kind, reversed.recorded.area, reversed.logged_call],
    ['logged-call', 'cache', 'Chose the in-memory cache for the report writer'],
  );
  assert.equal(recordReversal(project, { subject: first.id }).error, 'already-reversed');
  const after = listLoggedCalls(project);
  assert.deepEqual(
    after.map((c) => [c.id, c.reversed, c.reverse_with === undefined]),
    [
      [first.id, true, true],
      [second.id, false, false],
    ],
  );
  assert.equal(trustSummary(readTrustEvents(project.store)).cache.reversals, 1);
});

test('a logged call records the session and host that made it; the digest and the summary show them', () => {
  const { project } = clocked();
  const deps = { ...project, who: { session: 's-7', host: 'example-laptop' } };
  const made = logCall(deps, { text: 'Chose the in-memory cache', item: 'W-3', area: 'cache' });
  assert.equal(made.ok, true);
  assert.deepEqual([made.event.session, made.event.host], ['s-7', 'example-laptop']);
  assert.deepEqual(schemas().validateEntity('ledger-entry', made.event), []);
  // A caller may name them; one made by hand with no session has the host only.
  const named = logCall(deps, { text: 'Kept the timeout', session: 's-8', host: 'example-cloud' });
  assert.deepEqual([named.event.session, named.event.host], ['s-8', 'example-cloud']);
  const bare = logCall(project, { text: 'Ordered W-3 before W-4' });
  assert.deepEqual([bare.event.session, bare.event.host], [undefined, undefined]);

  assert.deepEqual(
    listLoggedCalls(project).map((c) => [c.session ?? null, c.host ?? null]),
    [
      ['s-7', 'example-laptop'],
      ['s-8', 'example-cloud'],
      [null, null],
    ],
  );
  assert.deepEqual(summarize(readLedger(project.store).events).logged_calls, {
    total: 3,
    by_session: [
      { session: 's-7', host: 'example-laptop', calls: 1 },
      { session: 's-8', host: 'example-cloud', calls: 1 },
      { session: null, host: null, calls: 1 },
    ],
  });
  // A decision's events carry them too, when the caller knows them.
  const asked = askQuestion(deps, question({ title: 'Who asked?' }));
  const [askedEvent] = events(project, 'asked').filter((e) => e.decision === asked.decision);
  assert.deepEqual([askedEvent.session, askedEvent.host], ['s-7', 'example-laptop']);
});

test('the digest says who made each logged call', async () => {
  const project = makeProject();
  const commands = makeCommands({ openTracker: () => project.tracker });
  const ctx = { cwd: project.root, env: { ...project.env, HITLD_SESSION: 's-9' } };
  const c = commands.find((x) => x.name === 'rights log');
  assert.ok(c?.run);
  const logged = /** @type {Record<string, any>} */ (
    await c.run({ text: 'Kept the default retry count', host: 'example-laptop' }, ctx)
  );
  assert.equal(logged.ok, true, JSON.stringify(logged));
  assert.deepEqual([logged.event.session, logged.event.host], ['s-9', 'example-laptop']);
  const digestCommand = commands.find((x) => x.name === 'rights digest');
  assert.ok(digestCommand?.run);
  const digest = /** @type {Record<string, any>} */ (await digestCommand.run({}, ctx));
  assert.equal(digest.logged_calls[0].session, 's-9');
  assert.match(
    digest.text.replace(/\s+/g, ' '),
    /Kept the default retry count \(by session s-9 on example-laptop\)/,
  );
  // Without --host, the machine's own host name is recorded.
  const own = /** @type {Record<string, any>} */ (await c.run({ text: 'Another call' }, ctx));
  assert.equal(typeof own.event.host, 'string');
  assert.ok(own.event.host.length > 0);
});

test('a logged call can be about a dispatch that has ended', () => {
  const { project } = clocked();
  const run = startRun(project.store, { session: 's-1', host: 'example-laptop' });
  run.record({ event: 'dispatched', dispatch: 'D-1', item: 'W-1', role: 'executor' });
  run.record({ event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done' });
  assert.equal(logCall(project, { text: 'Merged the two small fixes', dispatch: 'D-1' }).ok, true);
  // A dispatch's own lifecycle is still closed once it has ended.
  assert.throws(
    () => appendEvent(project.store, { event: 'started', dispatch: 'D-1', item: 'W-1' }),
    LedgerError,
  );
});

test('the ledger schema: sent and logged', () => {
  const ok = (/** @type {Record<string, any>} */ e) =>
    schemas().validateEntity('ledger-entry', {
      schema_version: 2,
      id: 'E-1',
      at: '2026-11-14T10:00:00Z',
      ...e,
    });
  assert.deepEqual(ok({ event: 'sent', decision: 'W-1' }), []);
  assert.deepEqual(ok({ event: 'logged', text: 'Chose A', area: 'cache' }), []);
  const { project } = clocked();
  assert.throws(() => appendEvent(project.store, { event: 'logged' }), /text is required/);
  assert.throws(() => appendEvent(project.store, { event: 'sent' }), /decision is required/);
});

test('the commands: show, log, rate without a decision, and the digest', async () => {
  const project = makeProject();
  const commands = makeCommands({ openTracker: () => project.tracker });
  const ctx = { cwd: project.root, env: project.env };
  /** @param {string} name @param {Record<string, unknown>} input */
  const run = async (name, input) => {
    const c = commands.find((x) => x.name === name);
    assert.ok(c?.run, name);
    return /** @type {Record<string, any>} */ (await c.run(input, ctx));
  };

  const asked = await run('rights ask', { question: JSON.stringify(question()) });
  assert.equal(asked.outcome, 'asked');
  const shown = await run('rights show', { decision: asked.decision });
  assert.equal(shown.first_showing, true);
  assert.equal(shown.text, asked.text);
  await run('rights answer', { decision: asked.decision, answer: 'A' });
  const rated = await run('rights rate', { 'worth-asking': 'no' });
  assert.equal(rated.decision, asked.decision);

  const logged = await run('rights log', {
    text: 'Kept the default retry count',
    item: 'W-3',
    area: 'api',
  });
  assert.equal(logged.ok, true);

  const digest = await run('rights digest', { mark: true });
  assert.deepEqual(
    digest.logged_calls.map((/** @type {any} */ c) => [c.id, c.text, c.reverse_with]),
    [[logged.id, 'Kept the default retry count', `hitld rights reverse ${logged.id}`]],
  );
  assert.equal(digest.rubber_stamp.length, 1);
  assert.deepEqual(
    [digest.rubber_stamp[0].area, digest.rubber_stamp[0].answers],
    ['unassigned', 1],
  );
  assert.deepEqual((await run('rights digest', {})).logged_calls, [], 'marked: not listed twice');

  const reversed = await run('rights reverse', { subject: logged.id, note: 'no' });
  assert.equal(reversed.recorded.subject_kind, 'logged-call');
  assert.equal((await run('rights trust', {})).areas.api.reversals, 1);
  assert.equal((await run('rights trust', {})).areas.unassigned.stamp_known, 1);
});

test('trustSummary leaves merge approvals and reverts to their own summary', () => {
  const merges = [
    { kind: 'merge-approval', area: 'docs', subject: 'HITLD-1', at: '2026-01-01T00:00:00Z' },
    { kind: 'merge-reverted', area: 'docs', subject: 'HITLD-1', at: '2026-01-02T00:00:00Z' },
  ];
  assert.deepEqual(
    trustSummary(/** @type {any} */ (merges)),
    {},
    'no area entry from merge events alone',
  );
});
