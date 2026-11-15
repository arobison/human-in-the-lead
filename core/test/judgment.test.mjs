import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policyDefaults, resolvePolicy } from '../lib/policy/policy.mjs';
import { applyPriors, conflictQuestion, judgmentWeight } from '../lib/judgment/judgment.mjs';
import { answerDecision, askQuestion } from '../lib/rights/flow.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { makeProject } from './helpers/project.mjs';

const { policy } = resolvePolicy({
  schema_version: 1,
  project: { id: 'fixture', key: 'W' },
  judgment: { weights: { 'C-3': { 'gut-check': 0.5, considered: 0.7 } } },
});
if (!policy) throw new Error('policy');

const gut = {
  what: 'fits the strategy and is plausibly valuable',
  basis: /** @type {const} */ ('gut-check'),
  by: 'owner',
};

test("weights come from policy.json: the owner's gut checks start high, others lower", () => {
  assert.equal(judgmentWeight(policy, gut), 0.8);
  assert.equal(judgmentWeight(policy, { ...gut, basis: 'considered' }), 0.9);
  assert.equal(judgmentWeight(policy, { ...gut, by: 'C-3' }), 0.5, 'a listed contributor');
  assert.equal(judgmentWeight(policy, { ...gut, by: 'C-9' }), 0.4, 'anyone not listed');
  assert.ok(judgmentWeight(policy, gut) > judgmentWeight(policy, { ...gut, by: 'C-9' }));
});

test('a judgment raises confidence and value as a prior; it settles nothing', () => {
  const r = applyPriors(policy, { judgments: [gut], confidence: 0.5, value: 10 });
  assert.equal(r.weight, 0.8);
  assert.equal(r.confidence, 0.7, '0.5 + (1 - 0.5) * lift 0.5 * weight 0.8');
  assert.equal(r.value, 14);
  assert.deepEqual(
    r.applied.map((a) => a.index),
    [0],
  );
  assert.deepEqual(r.held, []);
  const none = applyPriors(policy, { confidence: 0.5, value: 10 });
  assert.deepEqual([none.weight, none.confidence, none.value], [0, 0.5, 10]);
  assert.equal(applyPriors(policy, { judgments: [gut] }).confidence, null);
});

test('several judgments add less each time and never reach certainty', () => {
  const r = applyPriors(policy, { judgments: [gut, { ...gut, by: 'C-3' }], confidence: 0.5 });
  assert.equal(r.weight, 0.9, '1 - (1 - 0.8)(1 - 0.5)');
  assert.ok((r.confidence ?? 1) < 1);
});

test('the lift is policy: zero turns priors off', () => {
  const off = resolvePolicy({
    schema_version: 1,
    project: { id: 'f', key: 'W' },
    judgment: { lift: 0 },
  }).policy;
  assert.equal(
    applyPriors(/** @type {any} */ (off), { judgments: [gut], confidence: 0.5, value: 10 })
      .confidence,
    0.5,
  );
  assert.equal(policyDefaults().judgment.lift, 0.5);
});

test('contradicting evidence is surfaced and the judgment held out, never silently applied', () => {
  const evidence = [
    {
      ref: 'S-4',
      verdict: /** @type {const} */ ('contradicts'),
      summary: 'the benchmark shows no gain',
    },
  ];
  const r = applyPriors(policy, { judgments: [gut], confidence: 0.5, value: 10, evidence });
  assert.equal(r.confidence, 0.5, 'not applied');
  assert.equal(r.value, 10);
  assert.deepEqual(r.applied, []);
  assert.equal(r.held[0].by, 'owner');
  assert.deepEqual(r.conflicts, [{ judgment: 0, by: 'owner', what: gut.what, evidence }]);
});

test('evidence bears on the judgment it names, or on all; supporting evidence changes nothing', () => {
  const contradicts = { ref: 'S-4', verdict: /** @type {const} */ ('contradicts'), summary: 's' };
  const two = [gut, { ...gut, by: 'C-3' }];
  const some = applyPriors(policy, {
    judgments: two,
    evidence: [{ ...contradicts, judgment: 1 }],
  });
  assert.deepEqual(
    some.applied.map((a) => a.index),
    [0],
  );
  assert.deepEqual(
    some.conflicts.map((c) => c.judgment),
    [1],
  );
  assert.equal(applyPriors(policy, { judgments: two, evidence: [contradicts] }).applied.length, 0);
  const benign = [
    { ref: 'S-5', verdict: /** @type {const} */ ('supports'), summary: 's' },
    { ref: 'S-6', verdict: /** @type {const} */ ('inconclusive'), summary: 's' },
  ];
  assert.equal(applyPriors(policy, { judgments: two, evidence: benign }).conflicts.length, 0);
});

test('the conflict goes to the person who made the judgment, with the evidence and a recommendation', () => {
  const project = makeProject();
  const q = conflictQuestion({
    subject: 'W-90',
    judgment: gut,
    evidence: [{ ref: 'S-4', verdict: 'contradicts', summary: 'the benchmark shows no gain' }],
    recommend: 'revise',
    why: 'A measurement beats a quick call.',
    offer: {
      summary: 'gut checks that a benchmark contradicts',
      rule: 'When a benchmark contradicts a gut-check judgment, revise the estimate.',
      conditions: { rights_basis: ['conflicting-evidence'] },
    },
  });
  assert.deepEqual(schemas().validate('question', q), []);
  const asked = askQuestion(project, q);
  assert.equal(asked.outcome, 'asked');
  assert.equal(asked.route.addressed, 'owner');
  const item = /** @type {Record<string, any>} */ (project.tracker.get(asked.decision));
  assert.equal(item.decider, 'owner');
  assert.equal(item.rights_basis, 'conflicting-evidence');
  assert.match(item.context, /S-4 \(the benchmark shows no gain\)/);
  assert.match(item.context, /held without your judgment/);
  assert.match(asked.text, /Recommend: B\. A measurement beats a quick call\./);
  // The answer becomes precedent like any other, once confirmed.
  const answered = answerDecision(project, { decision: asked.decision, answer: 'B yes' });
  assert.equal(answered.precedent.id, 'P-1');
});

test('a conflict for a contributor is addressed to them', () => {
  const project = makeProject();
  const q = conflictQuestion({
    subject: 'W-90',
    judgment: { ...gut, by: 'C-3' },
    evidence: [{ ref: 'S-4', verdict: 'contradicts', summary: 's' }],
    recommend: 'keep',
    why: 'The benchmark did not cover this case.',
  });
  const asked = askQuestion(project, q);
  assert.deepEqual(asked.route.deciders, ['owner', 'C-3'], 'the owner is never dropped');
  assert.match(asked.text, /Recommend: A\./);
});
