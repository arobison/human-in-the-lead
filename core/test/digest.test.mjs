// Notification digests (HITLD-35): one digest, built from the records, at a merge batch and when
// the owner writes: questions first with the recommendation inline, ranked by cost of delay;
// only what is new since the read cursor; held back by quiet hours; one phone screen; and an
// urgency and a delivery the channel can act on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_KEY,
  TRIGGERS,
  buildDigest,
  markDigest,
  readCursor,
} from '../lib/digest/digest.mjs';
import { DIGEST_BUDGET, clip, fitSection, layOut, wrap } from '../lib/digest/render.mjs';
import { PARTS } from '../lib/digest/parts.mjs';
import { flakesPart } from '../lib/digest/flakes.mjs';
import { answerDecision, askQuestion, logCall } from '../lib/rights/flow.mjs';
import { sweepDefaults } from '../lib/rights/pending.mjs';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { FLAKES_KEY, QUARANTINE_PATH, recordQuarantineEvent } from '../lib/merge/quarantine.mjs';
import { attentionDefaults } from '../lib/settings/attention.mjs';
import { settingsLocation } from '../lib/settings/files.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { makeProject } from './helpers/project.mjs';
import { item, makeConsumer } from './orchestrator-fixture.mjs';

const T0 = Date.parse('2026-11-14T12:00:00Z');
const MIN = 60_000;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** The person's attention settings: the defaults, in UTC, no quiet hours unless a test sets them. */
const attention = (/** @type {Record<string, any>} */ over = {}) => ({
  ...attentionDefaults(),
  timezone: 'UTC',
  quiet_hours: [],
  ...over,
});
const settings = (/** @type {Record<string, any>} */ over = {}) => ({
  attention: attention(over),
  cap: 3,
});

const question = (/** @type {Record<string, any>} */ more = {}) => ({
  title: 'Add left-pad as a dependency?',
  question: 'May we add left-pad (MIT) as a runtime dependency?',
  context: 'The string padding in the report writer is hand-rolled and has two bugs.',
  options: [
    { label: 'Add it', what_happens: 'one small dependency, MIT licensed' },
    { label: 'Hand-roll', what_happens: 'no dependency; we fix the bugs ourselves' },
  ],
  recommendation: { option: 'A', why: 'A permissive license and a tiny surface.' },
  triggers: [{ basis: 'security', reason: 'it adds a dependency' }],
  paths: ['package.json'],
  item_kind: 'work',
  classification: 'public',
  reversibility: 'two-way',
  ...more,
});

/** A question as JSON text would give it: keys that are undefined are left out. @param {Record<string, any>} q */
const plain = (q) => JSON.parse(JSON.stringify(q));

/** A project with a clock the test sets, and a way to make work items. */
function setup(start = '2026-11-14T12:00:00Z') {
  const project = makeProject();
  let t = Date.parse(start);
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
  return {
    project,
    deps,
    work,
    set: (/** @type {string} */ time) => {
      t = Date.parse(time);
    },
    advance: (/** @type {number} */ min) => (t += min * MIN),
  };
}

const merged = (
  /** @type {any} */ deps,
  /** @type {string} */ id,
  /** @type {string} */ at,
  /** @type {Record<string, any>} */ more = {},
) => appendEvent(deps.store, { event: 'merged', item: id, at, ...more });

const lines = (/** @type {{ text: string }} */ d) => d.text.trimEnd().split('\n');

// What is in it

test('questions come first, most costly to delay first, each with its recommendation inline', () => {
  const { deps, work } = setup();
  const [w1, w2, w3] = [work('Fix padding'), work('Pad footer'), work('Pad header')];
  const cheap = askQuestion(deps, question({ title: 'A cheap question', blocks: [w1] }));
  const costly = askQuestion(deps, question({ title: 'A costly question', blocks: [w2, w3] }));
  merged(deps, w1, '2026-11-14T11:00:00Z');
  logCall(deps, { text: 'Kept the default timeout', item: w1 });

  const d = buildDigest(deps, { settings: settings(), now: '2026-11-14T12:30:00Z' });
  assert.equal(d.delivery, 'send');
  assert.equal(d.news, true);
  assert.deepEqual(
    d.questions.map((/** @type {any} */ q) => q.decision),
    [costly.decision, cheap.decision],
    'ranked by what waiting costs',
  );
  const out = lines(d);
  assert.match(out[0], /^fixture digest 2026-11-14 12:30Z$/);
  assert.equal(out[1], 'Everything so far: no earlier digest.');
  assert.match(out[2], /^Questions, most costly to delay first \(2\)$/);
  assert.ok(
    out.findIndex((l) => /A costly question/.test(l)) < out.findIndex((l) => /A cheap/.test(l)),
  );
  // The recommendation is inline, with its label: the question can be answered from the digest.
  assert.ok(out.some((l) => /^   Recommend A \(Add it\): A permissive license/.test(l)));
  assert.ok(out.some((l) => /blocks 2 · .*easy to undo/.test(l)));
  // After the questions: what merged, and the calls made, with how to reverse one.
  const at = (/** @type {RegExp} */ re) => out.findIndex((l) => re.test(l));
  assert.ok(at(/^Merged \(1\)$/) > at(/^Questions/));
  assert.ok(out.includes('W-1 Fix padding'));
  assert.ok(at(/^Calls made without asking \(1\)$/) > at(/^Merged/));
  assert.ok(out.some((l) => /^E-\d+ Kept the default timeout$/.test(l)));
  assert.ok(out.includes('Reverse one: hitld rights reverse <ID>'));
  assert.deepEqual(
    [d.merged.map((/** @type {any} */ m) => m.item), d.logged_calls.length],
    [[w1], 1],
  );
});

test('precedent applied and defaults taken are listed, with the owner’s overrules marked', () => {
  const { deps, advance } = setup();
  const offer = {
    summary: 'new dependencies with permissive licenses',
    rule: 'When a new dependency has a permissive license, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-license'] },
  };
  const first = askQuestion(
    deps,
    plain(
      question({ tags: ['dependency-license'], precedent_offer: offer, reversibility: undefined }),
    ),
  );
  const answered = answerDecision(deps, { decision: first.decision, answer: 'A yes' });
  assert.equal(answered.ok, true, JSON.stringify([first, answered]));
  advance(10);
  const like = askQuestion(
    deps,
    plain(
      question({
        title: 'Add right-pad?',
        tags: ['dependency-license'],
        reversibility: undefined,
        precedent_offer: undefined,
      }),
    ),
  );
  assert.equal(like.outcome, 'precedent');
  // A due default is applied by the sweep and listed.
  const dflt = askQuestion(
    deps,
    question({
      title: 'Pick the retry count',
      default_if_unanswered: { option: 'B', deadline: iso(T0 - 60 * MIN) },
    }),
  );
  assert.equal(sweepDefaults(deps, settings()).applied.length, 1);

  const d = buildDigest(deps, { settings: settings(), since: null, now: iso(T0 + 20 * MIN) });
  const out = lines(d);
  assert.ok(out.includes('Precedent applied (1)'));
  assert.ok(
    out.some((l) => l === `${like.decision} by P-1: Add right-pad?`),
    out.join('\n'),
  );
  assert.ok(out.includes('Overrule one: hitld rights overrule <ID>'));
  assert.ok(
    out.some((l) => l.startsWith(`${dflt.decision} took its default: Pick the retry count`)),
  );
  assert.deepEqual(
    d.defaults.map((/** @type {any} */ x) => x.decision),
    [dflt.decision],
  );
  assert.equal(d.applications[0].decision, like.decision);
});

test('questions already shown and not answered are listed apart, as context only', () => {
  const { deps, advance } = setup();
  const sent = askQuestion(deps, question({ title: 'Already shown' }), { send: true });
  advance(90);
  const d = buildDigest(deps, { settings: settings(), now: deps.now() });
  assert.deepEqual(d.questions, []);
  assert.equal(d.news, false, 'a question the owner already has is not news');
  assert.equal(d.delivery, 'skip');
  assert.equal(d.waiting[0].decision, sent.decision);
  // With something new, it is listed after the questions, with how long it has waited.
  merged(deps, 'W-9', iso(T0 + 85 * MIN));
  const out = lines(buildDigest(deps, { settings: settings(), now: deps.now() }));
  assert.ok(out.includes('Still waiting on you (1)'));
  assert.ok(
    out.some((l) => /^W-1 Already shown, 90 min$/.test(l)),
    out.join('\n'),
  );
});

// The read cursor

test('the digest shows only what is new since the read cursor, and marking moves it', () => {
  const { deps, project, work, advance } = setup();
  const w = work('Pad the footer');
  askQuestion(deps, question({ title: 'First question' }));
  merged(deps, w, iso(T0 - MIN));
  const first = buildDigest(deps, { settings: settings(), now: deps.now() });
  assert.equal(first.since, null);
  assert.equal(readCursor(deps), null);
  const marked = markDigest(deps, first);
  assert.equal(marked.marked, true);
  assert.deepEqual(marked.shown, ['W-2'], 'the question in it is recorded as shown');
  assert.equal(readCursor(deps), iso(T0), 'the cursor is the digest’s time');
  assert.deepEqual(JSON.parse(project.store.read(DIGEST_KEY) ?? '{}').through, iso(T0));
  const sent = readLedger(project.store).events.filter((e) => e.event === 'sent');
  assert.deepEqual(
    sent.map((e) => [e.decision, e.delivery]),
    [['W-2', 'digest']],
    'shown as part of a digest, not as an interrupt',
  );

  // Nothing new: nothing to send, and it says so.
  advance(5);
  const quiet = buildDigest(deps, { settings: settings(), now: deps.now() });
  assert.equal(quiet.delivery, 'skip');
  assert.equal(quiet.urgency, 'none');
  assert.deepEqual(lines(quiet), [
    'fixture digest 2026-11-14 12:05Z',
    'Nothing new since 2026-11-14 12:00Z.',
  ]);
  assert.deepEqual(markDigest(deps, quiet), {
    marked: false,
    reason: 'nothing new, so there is nothing to mark',
  });

  // Only the news after the cursor is listed; the merged item from before is not.
  merged(deps, 'W-9', iso(T0 + 6 * MIN));
  logCall(deps, { text: 'Chose the in-memory cache' });
  advance(5);
  const next = buildDigest(deps, { settings: settings(), now: deps.now() });
  assert.deepEqual(
    next.merged.map((/** @type {any} */ m) => m.item),
    ['W-9'],
  );
  assert.equal(next.logged_calls.length, 1);
  assert.equal(next.since, iso(T0));
  // An explicit --since overrides the cursor, to read what was sent again.
  const again = buildDigest(deps, { settings: settings(), since: '2000-01-01', now: deps.now() });
  assert.equal(again.merged.length, 2);
});

// The triggers

test('merge-batch: a digest at a merge-batch boundary goes out outside quiet hours', () => {
  const { deps, work, project } = setup('2026-11-14T12:00:00Z');
  const w = work('Pad the footer');
  merged(deps, w, '2026-11-14T11:55:00Z');
  askQuestion(deps, question({ title: 'Left for the digest' }));
  const quietHours = [{ from: '22:00', to: '07:00' }];
  const d = buildDigest(deps, {
    settings: settings({ quiet_hours: quietHours }),
    trigger: 'merge-batch',
  });
  assert.equal(d.trigger, 'merge-batch');
  assert.equal(d.delivery, 'send');
  assert.equal(d.urgency, 'routine');
  assert.equal(d.hold_until, undefined);
  assert.deepEqual(d.quiet_hours, { active: false, until: null, applies: true });
  assert.equal(markDigest(deps, d).marked, true);
  assert.ok(project.store.read(DIGEST_KEY));
});

test('merge-batch: quiet hours hold the digest back, say until when, and mark nothing', () => {
  const { deps, work, project } = setup('2026-11-14T23:30:00Z');
  const w = work('Pad the footer');
  merged(deps, w, '2026-11-14T23:20:00Z');
  const asked = askQuestion(deps, question({ title: 'Left for the digest' }));
  const quietHours = [{ from: '22:00', to: '07:00' }];
  const d = buildDigest(deps, {
    settings: settings({ quiet_hours: quietHours }),
    trigger: 'merge-batch',
  });
  assert.equal(d.news, true, 'there is news; it is held, not dropped');
  assert.equal(d.delivery, 'hold');
  assert.equal(d.hold_until, '2026-11-15T07:00:00.000Z');
  assert.equal(d.quiet_hours.active, true);
  assert.match(d.text, /Left for the digest/, 'the text is what will go out then');
  const marked = markDigest(deps, d);
  assert.equal(marked.marked, false);
  assert.match(String(marked.reason), /quiet hours hold it until 2026-11-15T07:00:00.000Z/);
  assert.equal(project.store.read(DIGEST_KEY), null, 'the cursor did not move');
  assert.equal(
    readLedger(project.store).events.some((e) => e.event === 'sent'),
    false,
    'the question was not shown',
  );
  // After quiet hours end, the same digest goes out and lists the same things.
  const later = { ...deps, now: () => '2026-11-15T07:05:00Z' };
  const after = buildDigest(later, {
    settings: settings({ quiet_hours: quietHours }),
    trigger: 'merge-batch',
  });
  assert.equal(after.delivery, 'send');
  assert.deepEqual(
    after.questions.map((/** @type {any} */ q) => q.decision),
    [asked.decision],
  );
  assert.equal(after.merged.length, 1);
});

test('merge-batch: an urgent question held by quiet hours holds the digest and is marked urgent', () => {
  const { deps, work } = setup('2026-11-14T23:30:00Z');
  const w = work('Pad the footer');
  askQuestion(deps, question({ title: 'Blocks the critical path', blocks: [w] }));
  const d = buildDigest(deps, {
    settings: settings({ quiet_hours: [{ from: '22:00', to: '07:00' }] }),
    trigger: 'merge-batch',
  });
  assert.equal(
    d.delivery,
    'hold',
    'only a sev-1 breaks quiet hours, and it is a page, not a question',
  );
  assert.equal(d.urgency, 'interrupt', 'but the channel is told what is waiting');
  assert.equal(d.hold_until, '2026-11-15T07:00:00.000Z');
});

test('owner-writes: the owner is here, so quiet hours do not hold the digest', () => {
  const { deps, work } = setup('2026-11-14T23:30:00Z');
  const w = work('Pad the footer');
  merged(deps, w, '2026-11-14T23:20:00Z');
  askQuestion(deps, question({ title: 'Left for the digest' }));
  const d = buildDigest(deps, {
    settings: settings({ quiet_hours: [{ from: '22:00', to: '07:00' }] }),
    trigger: 'owner-writes',
  });
  assert.equal(d.trigger, 'owner-writes');
  assert.equal(d.delivery, 'send');
  assert.deepEqual(d.quiet_hours, {
    active: true,
    until: '2026-11-15T07:00:00.000Z',
    applies: false,
  });
  assert.equal(d.hold_until, undefined);
  assert.equal(markDigest(deps, d).marked, true);
  // The default is the owner's turn.
  assert.equal(
    buildDigest(deps, { settings: settings(), now: deps.now() }).trigger,
    'owner-writes',
  );
  assert.deepEqual([...TRIGGERS], ['merge-batch', 'owner-writes']);
});

// Urgency

test('urgency: a question that is needed now makes the digest an interrupt; the rest are routine', () => {
  const { deps, work } = setup();
  const ordinary = buildDigest((askQuestion(deps, question({ title: 'Not urgent' })), deps), {
    settings: settings(),
  });
  assert.equal(ordinary.urgency, 'routine');
  assert.equal(ordinary.questions[0].deliver, 'digest');
  const w = work('Pad the footer');
  askQuestion(deps, question({ title: 'Blocks the critical path', blocks: [w] }));
  const urgent = buildDigest(deps, { settings: settings() });
  assert.equal(urgent.urgency, 'interrupt');
  assert.equal(urgent.delivery, 'send');
  assert.equal(urgent.questions[0].title, 'Blocks the critical path', 'the costly one first');
  assert.equal(urgent.questions[0].deliver, 'now');
  assert.ok(lines(urgent).some((l) => /critical path · needed now/.test(l)));
  // With every interrupt spent, the same question rides in the digest, and the digest is routine.
  const spent = buildDigest(deps, { settings: settings({ interrupts_per_day: 0 }) });
  assert.equal(spent.urgency, 'routine');
  assert.equal(spent.questions[0].deliver, 'digest');
});

// The size budget

test('the digest fits one phone screen, however much is new, and says what it left out', () => {
  const { deps, work } = setup();
  for (let i = 1; i <= 7; i++) {
    const w = work(`Work item ${i}`);
    askQuestion(
      deps,
      question({
        title: `Question ${i}: should the report writer adopt the new streaming interface for every output format now`,
        recommendation: {
          option: 'A',
          why: 'It removes the buffering that causes the memory spikes, it is already used by two other writers, and the change is small enough to undo with one revert if it misbehaves.',
        },
        blocks: [w],
      }),
    );
  }
  for (let i = 1; i <= 40; i++) {
    merged(deps, `W-${100 + i}`, iso(T0 - i * MIN));
    logCall(deps, {
      text: `Call number ${i}: kept the existing behavior for the legacy report format and moved on to the next item`,
    });
  }
  const wide = settings({ interrupts_per_day: 0 });
  const d = buildDigest(deps, { settings: wide, now: deps.now() });
  const out = lines(d);
  assert.ok(out.length <= DIGEST_BUDGET.lines, `${out.length} lines`);
  assert.ok(
    out.every((l) => l.length <= DIGEST_BUDGET.width),
    out.find((l) => l.length > DIGEST_BUDGET.width),
  );
  assert.ok(d.text.length <= DIGEST_BUDGET.lines * DIGEST_BUDGET.width);
  assert.deepEqual([d.size.lines, d.size.chars], [out.length, d.text.length]);
  assert.deepEqual(d.size.budget, DIGEST_BUDGET);
  // Questions first and kept; the long lists are shortened, each saying how many it left out.
  assert.match(out[2], /^Questions/);
  // Questions take the room first; every other section still says it is there, with its count.
  assert.ok(out.includes('Merged (40)'));
  assert.ok(out.includes('Calls made without asking (40)'));
  assert.ok(d.size.omitted.calls > 0 && d.size.omitted.merged > 0);
  assert.equal(
    out.filter((l) => /^[1-9]\. W-/.test(l)).length + (d.size.omitted.questions ?? 0),
    7,
    'every question is shown or counted',
  );
  assert.match(out.at(-1) ?? '', /^Shortened to fit\. All of it: hitld rights digest --full$/);
  // The data behind the text is not cut: the JSON has every call and merged item.
  assert.equal(d.logged_calls.length, 40);
  assert.equal(d.merged.length, 40);
  // --full is the whole text.
  const full = buildDigest(deps, { settings: wide, now: deps.now(), full: true });
  assert.ok(lines(full).length > DIGEST_BUDGET.lines);
  assert.deepEqual(full.size.omitted, {});
  assert.equal(lines(full).filter((l) => /^E-\d+ /.test(l)).length, 40);
});

test('with a few questions, the long lists are shortened and the way to undo a call stays', () => {
  const { deps } = setup();
  askQuestion(deps, question({ title: 'One question' }));
  askQuestion(deps, question({ title: 'Another question' }));
  for (let i = 1; i <= 40; i++) {
    logCall(deps, { text: `Call number ${i}: kept the existing behavior and moved on` });
  }
  const d = buildDigest(deps, { settings: settings(), now: deps.now() });
  const out = lines(d);
  assert.ok(out.length <= DIGEST_BUDGET.lines);
  assert.ok(
    out.some((l) => /^\+\d+ more calls$/.test(l)),
    out.join('\n'),
  );
  assert.ok(out.includes('Reverse one: hitld rights reverse <ID>'));
  assert.ok(out.some((l) => /^E-\d+ Call number 1: /.test(l)));
  assert.equal(d.logged_calls.length, 40);
});

test('a small digest is not padded, and the sections give room in the order of their rank', () => {
  const entry = (/** @type {string} */ s) => [s];
  const big = (/** @type {string} */ id, /** @type {number} */ rank, /** @type {number} */ n) => ({
    id,
    rank,
    title: id,
    noun: id,
    news: true,
    entries: Array.from({ length: n }, (_, i) => entry(`${id} ${i + 1}`)),
  });
  const sections = [big('c', 3, 10), big('a', 1, 10), big('b', 2, 10)];
  const { lines: out, omitted } = layOut(sections, 12);
  assert.equal(out.length, 12);
  // Shown in the order given (c, a, b); room given by rank (a first, then b, then c).
  assert.deepEqual(
    out.filter((l) => /^[abc] \(/.test(l)),
    ['c (10)', 'a (10)', 'b (10)'],
  );
  assert.deepEqual(Object.keys(omitted).sort(), ['a', 'b', 'c']);
  assert.ok(out.includes('a 1'), 'the first-ranked section keeps its entries');
  assert.deepEqual(layOut([big('a', 1, 2)], 12).lines, ['a (2)', 'a 1', 'a 2']);
  // The shortest form of a section is its heading and count.
  assert.deepEqual(fitSection(big('a', 1, 5), 1), { lines: ['a (5)'], omitted: 5 });
  assert.deepEqual(fitSection(big('a', 1, 5), 0), { lines: [], omitted: 5 });
  assert.deepEqual(clip('x'.repeat(80), 10), 'xxxxxxxxx…');
  assert.deepEqual(wrap('one two three four five six', '> ', '  ', 2, 12), [
    '> one two',
    '  three fou…',
  ]);
});

// Parts: one assembled from named parts, with a place for the flake section

test('the digest is assembled from named parts, and the flaky-test part has its place', () => {
  assert.deepEqual(
    PARTS.map((p) => p.id),
    [
      'questions',
      'waiting',
      'held',
      'merges',
      'merged',
      'calls',
      'precedent',
      'review',
      'stamp',
      'flakes',
      'quota',
      'disk',
    ],
  );
  assert.equal(PARTS.includes(flakesPart), true);
  assert.deepEqual(flakesPart.collect(/** @type {any} */ ({ root: null })), { section: null });

  // A part another piece adds is assembled and shortened like the rest, and carries its data.
  const { deps } = setup();
  const flakes = {
    id: 'flakes',
    rank: 7,
    collect: () => ({
      section: {
        id: 'flakes',
        rank: 7,
        title: 'Flaky tests',
        entries: [['test/cache.test.mjs: quarantined']],
        noun: 'tests',
        news: true,
      },
      json: { flakes: [{ test: 'test/cache.test.mjs' }] },
    }),
  };
  const parts = PARTS.map((p) => (p.id === 'flakes' ? flakes : p));
  const d = buildDigest(deps, { settings: settings(), parts });
  assert.equal(d.news, true, 'a part with news makes a digest');
  assert.ok(lines(d).includes('Flaky tests (1)'));
  assert.deepEqual(d.flakes, [{ test: 'test/cache.test.mjs' }]);
});

// The flaky-test part

test('the flake section: quarantined tests, expired ones with their question, the measures, in budget', () => {
  const { deps, project } = setup('2026-11-14T12:00:00Z');
  /** @param {Record<string, string>[]} tests */
  const quarantine = (tests) =>
    writeFileSync(
      join(project.root, QUARANTINE_PATH),
      JSON.stringify({ schema_version: 1, tests }),
    );
  const at = (/** @type {string} */ t) => () => new Date(t);
  quarantine([
    { id: 'a > live flake', expires: '2026-11-20', fix_item: 'W-7' },
    { id: 'a > old flake', expires: '2026-11-10', fix_item: 'W-8' },
  ]);
  recordQuarantineEvent(
    project.store,
    { kind: 'quarantined', test: 'a > live flake', fix_item: 'W-7' },
    at('2026-11-12T10:00:00Z'),
  );
  project.store.append(
    FLAKES_KEY,
    `${JSON.stringify({ kind: 'failure', outcome: 'preexisting', runs: 3, at: '2026-11-13T10:00:00Z' })}\n` +
      `${JSON.stringify({ kind: 'failure', outcome: 'real', runs: 1, at: '2026-11-13T11:00:00Z' })}\n`,
  );

  const d = buildDigest(deps, { settings: settings(), root: project.root, now: deps.now() });
  const out = lines(d);
  assert.equal(d.news, true, 'a test quarantined since the cursor, and one expired, are news');
  assert.ok(out.some((l) => /^Flaky tests: 2 quarantined, oldest \d+ days, 1 expired\.$/.test(l)));
  assert.ok(out.includes('Failures 2, flake candidates 1 (50%).'));
  assert.ok(out.includes('Expired: a > old flake, until 2026-11-10, fix W-8'));
  assert.ok(out.includes('a > live flake, until 2026-11-20, fix W-7'));
  assert.ok(
    out.findIndex((l) => l.startsWith('Expired:')) < out.findIndex((l) => l.startsWith('a > live')),
    'expired first',
  );
  assert.equal(d.flakes.size, 2);
  assert.deepEqual(d.flakes.expired, ['a > old flake']);
  assert.match(d.flakes.decisions[0].question.title, /has expired/);
  assert.equal(d.flakes.decisions[0].fix_item, 'W-8');

  // After the digest is sent the list is state: shown with room, and not news by itself.
  assert.equal(markDigest(deps, d).marked, true);
  const later = { ...deps, now: () => '2026-11-14T12:05:00Z' };
  const next = buildDigest(later, { settings: settings(), root: project.root });
  assert.equal(next.delivery, 'skip');
  assert.equal(next.flakes.size, 2);
  // A test quarantined after the cursor is news again.
  recordQuarantineEvent(
    project.store,
    { kind: 'quarantined', test: 'a > new flake', fix_item: 'W-9' },
    at('2026-11-14T12:03:00Z'),
  );
  assert.equal(buildDigest(later, { settings: settings(), root: project.root }).delivery, 'send');

  // A long list is shortened like any other section.
  quarantine(
    Array.from({ length: 30 }, (_, i) => ({
      id: `suite > flake number ${i + 1}`,
      expires: '2026-11-30',
      fix_item: `W-${100 + i}`,
    })),
  );
  const big = buildDigest(deps, { settings: settings(), root: project.root, now: deps.now() });
  assert.ok(lines(big).length <= DIGEST_BUDGET.lines);
  assert.ok(lines(big).every((l) => l.length <= DIGEST_BUDGET.width));
  assert.ok(lines(big).some((l) => /^\+\d+ more lines$/.test(l)));
  assert.ok(big.size.omitted.flakes > 0);
  assert.equal(big.flakes.size, 30, 'the data is not cut');

  // No quarantine and no failures: no section. A refused file says so.
  quarantine([]);
  assert.equal(
    buildDigest(deps, { settings: settings(), root: project.root, now: deps.now() }).flakes.size,
    0,
  );
  writeFileSync(join(project.root, QUARANTINE_PATH), '{"tests": 3}');
  const refused = buildDigest(deps, { settings: settings(), root: project.root, now: deps.now() });
  assert.ok(lines(refused).includes('Quarantine file refused: run hitld check quarantine.'));
});

// Through the command, and the dashboard

/** @param {Record<string, string>} env @param {unknown} data */
function person(env, data) {
  const loc = settingsLocation('person', { env });
  mkdirSync(loc.dir, { recursive: true });
  writeFileSync(loc.path, JSON.stringify(data), { mode: 0o600 });
}

test('hitld rights digest: both triggers, the person’s quiet hours, marking, and the executor refusal', async () => {
  const { project, work } = setup();
  const base = mkdtempSync(join(tmpdir(), 'hitld-digest-'));
  const env = { ...project.env, XDG_CONFIG_HOME: join(base, 'config') };
  person(env, {
    schema_version: 2,
    attention: { quiet_hours: [{ from: '22:00', to: '07:00' }], timezone: 'UTC' },
  });
  const commands = makeCommands({ openTracker: () => project.tracker });
  const ctx = { cwd: project.root, env };
  /** @param {Record<string, unknown>} input */
  const run = async (input) => {
    const c = commands.find((x) => x.name === 'rights digest');
    assert.ok(c?.run);
    return /** @type {Record<string, any>} */ (await c.run(input, ctx));
  };
  const deps = { ...project, now: () => '2026-11-14T23:00:00Z' };
  const w = work('Pad the footer');
  askQuestion(deps, question({ title: 'Needs the owner', blocks: [w] }));
  merged(deps, w, '2026-11-14T22:50:00Z');
  logCall(deps, { text: 'Kept the default timeout' });

  // At a merge batch in quiet hours it is held; --mark records nothing.
  const held = await run({ trigger: 'merge-batch', now: '2026-11-14T23:00:00Z', mark: true });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.deepEqual(
    [held.delivery, held.urgency, held.hold_until, held.marked.marked],
    ['hold', 'interrupt', '2026-11-15T07:00:00.000Z', false],
  );
  assert.equal(project.store.read(DIGEST_KEY), null);

  // When the owner writes, it goes, and --mark moves the cursor and records the question as shown.
  const owner = await run({ trigger: 'owner-writes', now: '2026-11-14T23:05:00Z', mark: true });
  assert.equal(owner.delivery, 'send');
  assert.equal(owner.marked.marked, true);
  assert.deepEqual(owner.marked.shown, ['W-2']);
  assert.match(owner.text, /^fixture digest 2026-11-14 23:05Z\nEverything so far/);
  assert.equal(readCursor(deps), '2026-11-14T23:05:00.000Z');
  const next = await run({ now: '2026-11-14T23:10:00Z' });
  assert.equal(next.delivery, 'skip', next.text);
  assert.equal(next.since, '2026-11-14T23:05:00.000Z');
  assert.equal(next.news, false);
  // The records the earlier digest was built from are still there for the JSON reader.
  assert.equal(
    (await run({ since: '2000-01-01', now: '2026-11-14T23:10:00Z' })).logged_calls.length,
    1,
  );

  const bad = await run({ trigger: 'daily' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'usage');
  assert.equal((await run({ now: 'not a time' })).error, 'usage');

  const c = commands.find((x) => x.name === 'rights digest');
  const refused = /** @type {any} */ (
    await c?.run?.({}, { cwd: project.root, env: { ...env, HITLD_ROLE: 'executor' } })
  );
  assert.equal(refused.error, 'not-permitted');
});

test('hitld dashboard writes the same digest, and leaves the read cursor where it is', async () => {
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
  const asked = await c.hitld([
    'rights',
    'ask',
    '--question',
    JSON.stringify({ ...question(), parent: 'W-7', title: 'Which retry count?' }),
  ]);
  assert.equal(asked.result.outcome, 'asked', JSON.stringify(asked.result));
  const logged = await c.hitld(['rights', 'log', '--text', 'Kept the default timeout']);
  assert.equal(logged.result.ok, true);

  const now = new Date(Date.now() + MIN).toISOString();
  const digest = await c.hitld(['rights', 'digest', '--now', now]);
  assert.equal(digest.result.ok, true, JSON.stringify(digest.result));
  const board = await c.hitld(['dashboard', '--now', now]);
  assert.equal(board.result.ok, true, JSON.stringify(board.result));
  const written = readFileSync(board.result.digest, 'utf8');
  assert.equal(written, digest.result.text, 'the dashboard’s digest.txt is the digest');
  assert.match(written, /Which retry count\?/);
  assert.match(written, /Recommend A \(Add it\)/);
  assert.match(written, /Kept the default timeout/);
  // Writing the dashboard sent nothing: the question is not shown, the cursor has not moved.
  const again = await c.hitld(['rights', 'digest', '--now', now]);
  assert.equal(again.result.delivery, 'send');
  assert.equal(again.result.since, null);
});
