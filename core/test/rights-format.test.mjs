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
  assert.ok(flat.includes('Scope: project. Made by: the decider.'));
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

test('free text names no option, and an out-of-range letter is not an option', () => {
  const free = parseAnswer('Include it, but check with the driver team first', decision);
  assert.equal(free.option, null);
  assert.equal(free.generalization, null);
  assert.equal(free.rationale, 'Include it, but check with the driver team first');
  assert.equal(parseAnswer('I think so', decision).option, null);
  assert.equal(parseAnswer('D yes', decision).option, null);
});
