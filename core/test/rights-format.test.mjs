import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOption, formatQuestion, optionIndex, parseAnswer } from '../lib/rights/format.mjs';

// Design part 4.2, the decision question.
const decision = {
  id: 'W-412',
  question: 'Should the response cache key include the locale?',
  context:
    'Keys without it are stable across driver updates, so the cache survives upgrades. One reported bug (SIG-88) came from a driver that changed compiler output between versions.',
  reversibility: 'two-way',
  recommendation: {
    option: 'A',
    why: 'Include the driver version. Correctness beats a cold cache after upgrades, which is rare.',
  },
  options: [
    {
      label: 'Include it',
      what_happens: 'always correct',
      cost: 'cache rebuilds after driver updates',
    },
    {
      label: 'Exclude it',
      what_happens: 'faster after upgrades',
      cost: 'rare stale-response bugs',
    },
    {
      label: 'Include it only on drivers with known compiler changes',
      what_happens: 'both',
      cost: 'a list to maintain',
    },
  ],
  precedent_offer: {
    summary: 'cache keys vs. external versions',
    rule: 'r',
    conditions: { tags: ['t'] },
  },
};

test('the question stands alone: title line, question, context, recommendation, options, offer', () => {
  const text = formatQuestion(decision, { blocks: 3, critical_path: true });
  const lines = text.split('\n');
  assert.equal(lines[0], 'W-412  Decision · blocks 3 items on the critical path · two-way door');
  assert.equal(lines[2], 'Should the response cache key include the locale?');
  assert.match(text, /\nContext: Keys without it are stable across driver updates/);
  assert.match(
    text,
    /\nRecommend: A\. Include the driver version\. Correctness beats a cold cache/,
  );
  assert.match(text, /\n {2}A\. Include it: always correct; cache rebuilds after driver updates\n/);
  assert.match(text, /\n {2}B\. Exclude it: faster after upgrades; rare stale-response bugs\n/);
  assert.match(
    text,
    /\n {2}C\. Include it only on drivers with known compiler changes: both; a list to\n {5}maintain\n/,
  );
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes(
      'Future cases like this (cache keys vs. external versions): treat the same way? (yes / just this one)',
    ),
  );
  // The offer is spelled out from its structured parts, after the summary the asker wrote.
  assert.ok(flat.includes('If yes, this becomes a precedent: "r"'));
  assert.ok(flat.includes('It applies when: tags t.'));
  assert.ok(flat.includes('Scope: all. Made by: the decider.'));
  assert.ok(lines.every((l) => l.length <= 100));
});

test('without blocks or an offer, those parts are left out; a one-way door says so', () => {
  const text = formatQuestion({
    ...decision,
    reversibility: 'one-way',
    precedent_offer: undefined,
  });
  assert.equal(text.split('\n')[0], 'W-412  Decision · one-way door');
  assert.ok(!text.includes('Future cases'));
  assert.ok(
    formatQuestion(decision, { blocks: 1 }).startsWith('W-412  Decision · blocks 1 item · two-way'),
  );
});

test('an option labelled with its own letter is not shown twice', () => {
  assert.equal(
    describeOption({ label: 'A', what_happens: 'Include it: always correct' }, 0),
    'A. Include it: always correct',
  );
});

test('a recommendation or answer names an option by letter or label', () => {
  assert.equal(optionIndex(decision, 'b'), 1);
  assert.equal(optionIndex(decision, 'Exclude it'), 1);
  assert.equal(optionIndex(decision, 'D'), null);
  const byLabel = formatQuestion({
    ...decision,
    recommendation: { option: 'Exclude it', why: 'Speed.' },
  });
  assert.match(byLabel, /Recommend: B\. Speed\./);
});

test('answers: A, A yes, B just this one, with a reason or narrowing', () => {
  /** @param {string} t */
  const p = (t) => parseAnswer(t, decision);
  assert.deepEqual(
    [p('A').letter, p('A').generalization],
    ['A', null],
    'an option alone makes no generalization',
  );
  assert.equal(p('A yes').generalization, 'yes');
  assert.equal(p('a, yes').option, 0);
  assert.deepEqual(
    [p('B just this one').option, p('B just this one').generalization],
    [1, 'just-this-one'],
  );
  assert.equal(p('B no').generalization, 'just-this-one');
  const reason = p('A yes, because the bug was real');
  assert.deepEqual([reason.generalization, reason.rationale], ['yes', 'because the bug was real']);
  const narrow = p('A, only for cache keys');
  assert.deepEqual([narrow.generalization, narrow.narrowing], ['narrowed', 'cache keys']);
  assert.equal(p('A yes, but only for cache keys.').narrowing, 'cache keys');
  assert.equal(p('A narrow to response caches').narrowing, 'response caches');
});

test('free words that are not a label name no option, and an out-of-range letter is not an option', () => {
  const free = parseAnswer('Let us check with the driver team first', decision);
  assert.equal(free.option, null);
  assert.equal(free.ambiguous, false);
  assert.equal(free.generalization, null);
  assert.equal(free.rationale, 'Let us check with the driver team first');
  assert.equal(parseAnswer('I think so', decision).option, null);
  assert.equal(parseAnswer('D yes', decision).option, null);
  assert.equal(parseAnswer('maybe', decision).letter, null);
});

test('words that are exactly one label name that option; the rest of the answer is read as usual', () => {
  /** @param {string} t */
  const p = (t) => parseAnswer(t, decision);
  assert.deepEqual([p('Exclude it').option, p('Exclude it').letter], [1, 'B']);
  assert.equal(p('exclude it').option, 1);
  assert.equal(p('Please exclude it.').option, 1);
  assert.equal(p('exclude').option, 1, 'filler words such as "it" do not count');
  // A label that opens another option's label is told apart by the whole label.
  assert.equal(p('include it').option, 0);
  assert.equal(
    p('Include it only on drivers with known compiler changes').option,
    2,
    'the longer label is its own option',
  );
  // After the label come the generalization and a reason, as after a letter.
  const yes = p('Include it, yes, because the bug was real');
  assert.deepEqual(
    [yes.option, yes.generalization, yes.rationale],
    [0, 'yes', 'because the bug was real'],
  );
  assert.equal(p('Exclude it. Just this one').generalization, 'just-this-one');
  assert.equal(p('Include it, but check with the driver team first').option, 0);
});

test('simple spelling variants and slips of the keys still name the label', () => {
  const enrol = {
    options: [
      { label: 'Enrol it', what_happens: 'a' },
      { label: 'Do not enrol it', what_happens: 'b' },
      { label: 'Organise the files', what_happens: 'c' },
    ],
  };
  /** @param {string} t */
  const p = (t) => parseAnswer(t, enrol).option;
  assert.equal(p('enrol it'), 0);
  assert.equal(p('enroll it'), 0);
  assert.equal(p('Enroll'), 0);
  assert.equal(p('do not enroll it'), 1);
  assert.equal(p('organize the files'), 2);
  assert.equal(p('orgnaise the files'), null, 'a transposition is not a slip it forgives');
  assert.equal(p('oraganise the files'), 2, 'one letter off, in a long word');
});

test('words that add to a label, or fit two labels, name no option', () => {
  const enrol = {
    options: [
      { label: 'Enrol it', what_happens: 'a' },
      { label: 'Do not enrol it', what_happens: 'b' },
    ],
  };
  // "not enrol it" holds the words of "Enrol it", and means the opposite.
  const negated = parseAnswer('not enrol it', enrol);
  assert.deepEqual([negated.option, negated.ambiguous], [null, false]);
  assert.equal(parseAnswer('enrol it now', enrol).option, null);
  assert.equal(parseAnswer('I would not enrol it', enrol).option, null);
  // Two labels that are the same words: the answer fits both, so it names neither.
  const twins = {
    options: [
      { label: 'Keep it', what_happens: 'a' },
      { label: 'Keep', what_happens: 'b' },
    ],
  };
  const both = parseAnswer('keep it', twins);
  assert.deepEqual([both.option, both.ambiguous], [null, true]);
  assert.equal(parseAnswer('A', twins).option, 0, 'a letter always names one');
});
