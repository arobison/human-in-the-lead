// Check 2 of One signal end to end, offline, with a stand-in tracker (design part 21): a call that is the owner's under
// a rule becomes a decision item; the answer, with its generalization confirmed, becomes precedent;
// a later matching question is resolved by that precedent without asking, and appears in the
// digest list; an overrule narrows it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerDecision,
  askQuestion,
  listApplications,
  overrule,
  precedentHealth,
  rateWorthAsking,
  recordReversal,
} from '../lib/rights/flow.mjs';
import { readTrustEvents, trustSummary } from '../lib/rights/trust.mjs';
import { makeProject } from './helpers/project.mjs';

/** A dependency question: the owner's under the security rule, with the precedent offer. */
const dependency = (/** @type {Record<string, any>} */ more = {}) =>
  // As the command line gets it: JSON, so a key set to undefined is simply absent.
  JSON.parse(
    JSON.stringify({
      title: 'Add left-pad as a dependency?',
      question: 'May we add left-pad (MIT) as a runtime dependency?',
      context: 'The string padding in the report writer is hand-rolled and has two bugs.',
      options: [
        { label: 'Add it', what_happens: 'one small dependency, MIT licensed', reversible: true },
        {
          label: 'Hand-roll',
          what_happens: 'no dependency; we fix the bugs ourselves',
          cost: 'more code to own',
        },
      ],
      recommendation: {
        option: 'A',
        why: 'A permissive licence and a tiny surface; the bugs are real.',
      },
      triggers: [{ basis: 'security', reason: 'it adds a dependency' }],
      tags: ['dependency-licence'],
      paths: ['package.json'],
      item_kind: 'work',
      classification: 'public',
      reversibility: 'two-way',
      precedent_offer: {
        summary: 'new dependencies with permissive licences',
        rule: 'When a new dependency has a permissive licence (MIT, BSD, Apache-2.0), allow it.',
        conditions: { rights_basis: ['security'], tags: ['dependency-licence'] },
      },
      ...more,
    }),
  );

test('acceptance: ask, answer into precedent, resolve a later question, list it, overrule it', () => {
  const project = makeProject();
  const { tracker, precedents } = project;

  // An item that waits on the answer.
  const waiting = tracker.create({
    schema_version: 1,
    kind: 'work',
    title: 'Fix report padding',
    state: 'planned',
    classification: 'public',
  });

  // 1. The call is the owner's under the security rule: it becomes a decision item.
  const asked = askQuestion(project, dependency({ blocks: [waiting] }));
  assert.equal(asked.ok, true);
  assert.equal(asked.outcome, 'asked');
  assert.equal(asked.route.decider, 'owner');
  assert.equal(asked.route.rule.id, 'rights.rules.security');
  const decision = tracker.get(asked.decision);
  assert.equal(decision.kind, 'decision');
  assert.equal(decision.state, 'planned');
  assert.equal(decision.decider, 'owner');
  assert.equal(decision.rights_basis, 'security');
  assert.deepEqual(
    tracker.get(waiting).needs,
    [asked.decision],
    'the waiting item needs the answer',
  );
  assert.match(asked.text, /Recommend: A\./);
  assert.match(asked.text, /Future cases like this \(new dependencies with permissive licences\)/);
  assert.deepEqual(precedents.list(), [], 'nothing generalized before the decider confirms');

  // 2. The answer, with its generalization confirmed, becomes precedent.
  const answered = answerDecision(project, {
    decision: asked.decision,
    answer: 'A yes',
    via: 'remote-control',
    worth_asking: true,
  });
  assert.equal(answered.ok, true);
  assert.equal(answered.generalization, 'yes');
  assert.equal(answered.precedent.id, 'P-1');
  assert.equal(answered.precedent.stored_in, 'repository');
  const done = tracker.get(asked.decision);
  assert.equal(done.state, 'done');
  assert.equal(done.answer, 'A. Add it: one small dependency, MIT licensed');
  assert.equal(done.answered_via, 'remote-control');
  assert.equal(done.precedent, 'P-1');
  const p = precedents.get('P-1');
  assert.equal(p?.state, 'active');
  assert.deepEqual(p?.sources, [asked.decision]);
  assert.equal(p?.classification, 'public');
  assert.match(p?.checked.policy_hash, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(project.root, 'precedents')));

  // 3. A later matching question is resolved by that precedent without asking.
  const later = askQuestion(
    project,
    dependency({
      title: 'Add chalk as a dependency?',
      question: 'May we add chalk (MIT) as a runtime dependency?',
      paths: ['package.json'],
      tags: ['dependency-licence', 'npm'],
      blocks: undefined,
      precedent_offer: undefined,
    }),
  );
  assert.equal(later.outcome, 'precedent');
  assert.equal(later.precedent, 'P-1');
  assert.match(
    later.answer,
    /^Resolved by precedent P-1: When a new dependency has a permissive licence/,
  );
  const resolved = tracker.get(later.decision);
  assert.equal(resolved.state, 'done');
  assert.equal(resolved.resolved_by_precedent, 'P-1');
  assert.equal(resolved.answered_via, 'precedent');
  assert.equal(
    tracker.query({ kind: 'decision', state: 'planned' }).length,
    0,
    'the decider was not asked',
  );

  // ...and appears in the digest list.
  const digest = listApplications(project);
  assert.deepEqual(
    digest.map((a) => [a.decision, a.precedent, a.overruled]),
    [[later.decision, 'P-1', false]],
  );
  assert.match(String(digest[0].rule), /permissive licence/);

  // 4. An overrule narrows it: cases like the reversed one are no longer resolved by it.
  const reversed = overrule(project, {
    decision: later.decision,
    why: 'chalk pulls in a native build step; that is not what I meant',
  });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.action, 'narrowed');
  assert.deepEqual(reversed.exception.when, {
    item_kinds: ['work'],
    paths: ['package.json'],
    tags: ['dependency-licence', 'npm'],
  });
  assert.equal(precedents.get('P-1')?.state, 'narrowed');
  assert.equal(listApplications(project)[0].overruled, true);

  const sameAgain = askQuestion(
    project,
    dependency({
      title: 'Add colors?',
      question: 'May we add colors?',
      tags: ['dependency-licence', 'npm'],
    }),
  );
  assert.equal(sameAgain.outcome, 'asked', 'a case like the overruled one goes to the owner again');
  assert.deepEqual(sameAgain.candidates, []);

  const different = askQuestion(
    project,
    dependency({
      title: 'Add a tool?',
      paths: ['tools/package.json'],
      tags: ['dependency-licence'],
      blocks: undefined,
    }),
  );
  assert.equal(
    different.outcome,
    'precedent',
    'a different case is still resolved by the narrowed precedent',
  );
});

test('a decision that carries no confirmation makes no precedent', () => {
  const project = makeProject();
  for (const [answer, generalization] of [
    ['A', 'none-given'],
    ['A just this one', 'just-this-one'],
    ['Add it, but check the licence file first', 'none-given'],
  ]) {
    const asked = askQuestion(project, dependency());
    const r = answerDecision(project, { decision: asked.decision, answer });
    assert.equal(r.ok, true, answer);
    assert.equal(r.generalization, generalization, answer);
    assert.equal(r.precedent, null, answer);
  }
  assert.deepEqual(project.precedents.list(), []);
  assert.equal(askQuestion(project, dependency()).outcome, 'asked');
});

test('narrowing the generalization: the words go into the precedent', () => {
  const project = makeProject();
  const asked = askQuestion(project, dependency());
  const r = answerDecision(project, {
    decision: asked.decision,
    answer: 'A, only for development tools',
  });
  assert.equal(r.generalization, 'narrowed');
  const p = project.precedents.get('P-1');
  assert.equal(p?.conditions.text, 'development tools');
  assert.match(p?.rule, /only for development tools\.$/);
  // The plain-language narrowing needs a judgement before it resolves anything.
  const next = askQuestion(project, dependency({ precedent_offer: undefined }));
  assert.equal(next.outcome, 'asked');
  assert.deepEqual(next.candidates, [
    { id: 'P-1', needs_judgement: true, judge: ['condition: development tools'] },
  ]);
  assert.match(
    tracker(project, next.decision).context,
    /Precedents that may apply, and did not settle it: P-1/,
  );
  const judged = askQuestion(project, dependency({ precedent_offer: undefined }), {
    judged: { 'P-1': true },
  });
  assert.equal(judged.outcome, 'precedent');
  const notFit = askQuestion(project, dependency({ precedent_offer: undefined }), {
    judged: { 'P-1': false },
  });
  assert.equal(notFit.outcome, 'asked');
  assert.deepEqual(notFit.candidates, []);
});

/** @param {ReturnType<typeof makeProject>} project @param {string} id */
const tracker = (project, id) => /** @type {Record<string, any>} */ (project.tracker.get(id));

test('a question with several fitting precedents goes to the decider with them cited', () => {
  const project = makeProject();
  for (const id of ['P-1', 'P-2']) {
    project.precedents.put({
      schema_version: 1,
      id,
      rule: `Rule ${id}: allow permissively licensed dependencies.`,
      conditions: { rights_basis: ['security'] },
      sources: ['W-1'],
      scope: 'project',
      decider: 'owner',
      state: 'active',
      classification: 'public',
    });
  }
  const r = askQuestion(project, dependency({ precedent_offer: undefined }));
  assert.equal(r.outcome, 'asked');
  assert.deepEqual(
    r.candidates.map((/** @type {any} */ c) => c.id),
    ['P-1', 'P-2'],
  );
  assert.match(tracker(project, r.decision).context, /P-1 \("Rule P-1.*"\); P-2/);
});

test('rule changes are never resolved by a precedent, and never generalized', () => {
  const project = makeProject();
  const q = dependency({
    triggers: [{ basis: 'rule-change', reason: 'it raises the concurrency ceiling' }],
    precedent_offer: {
      summary: 'concurrency',
      rule: 'When asked to raise concurrency, raise it.',
      conditions: { rights_basis: ['rule-change'] },
    },
  });
  const asked = askQuestion(project, q);
  assert.equal(asked.outcome, 'asked');
  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  assert.equal(r.precedent, null);
  assert.match(r.warnings[0], /never resolves rule-change/);
  assert.equal(askQuestion(project, q).outcome, 'asked');
});

test("a call no rule makes the owner's is the system's: nothing is created", () => {
  const project = makeProject();
  const r = askQuestion(project, { question: 'Name a local variable', reversibility: 'two-way' });
  assert.equal(r.outcome, 'system');
  assert.equal(r.route.rule.id, 'rights.default');
  assert.equal(project.tracker.items.size, 0);
});

test('a question that cannot be answered from a phone is refused, and says what it lacks', () => {
  const project = makeProject();
  const r = askQuestion(
    project,
    dependency({
      options: [dependency().options[0]],
      recommendation: undefined,
      context: undefined,
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'incomplete_question');
  assert.deepEqual(r.missing, ['context', 'options (at least two)', 'recommendation']);
  const lost = askQuestion(project, dependency({ recommendation: { option: 'Z', why: 'x' } }));
  assert.match(String(lost.missing), /recommendation\.option/);
  assert.equal(project.tracker.items.size, 0);
  const unknown = askQuestion(project, { ...dependency(), surprise: 1 });
  assert.equal(unknown.error, 'invalid_question');
});

test('only an open decision takes an answer', () => {
  const project = makeProject();
  const asked = askQuestion(project, dependency());
  assert.equal(answerDecision(project, { decision: asked.decision, answer: 'A' }).ok, true);
  assert.equal(
    answerDecision(project, { decision: asked.decision, answer: 'B' }).error,
    'not_open',
  );
  assert.equal(answerDecision(project, { decision: 'W-99', answer: 'A' }).error, 'not_found');
  const work = project.tracker.create({
    schema_version: 1,
    kind: 'work',
    title: 'x',
    state: 'planned',
    classification: 'public',
  });
  assert.equal(answerDecision(project, { decision: work, answer: 'A' }).error, 'not_a_decision');
});

test('a confidential decision makes a confidential precedent in the private store, cited by ID only', () => {
  const project = makeProject();
  const asked = askQuestion(project, dependency({ classification: 'confidential' }));
  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  assert.equal(r.precedent.stored_in, 'private store');
  assert.equal(project.precedents.get('P-1')?.classification, 'confidential');
  assert.ok(!existsSync(join(project.root, 'precedents')));
  // A public question matches it, and records the application without copying the rule.
  const later = askQuestion(project, dependency({ precedent_offer: undefined }));
  assert.equal(later.outcome, 'precedent');
  assert.equal(later.answer, 'Resolved by precedent P-1');
  const [app] = listApplications(project);
  assert.equal(app.rule, undefined);
});

test('overruling something that was not an application, twice, or with no tell-tale attribute', () => {
  const project = makeProject();
  assert.equal(overrule(project, { decision: 'W-1', why: 'x' }).error, 'not_an_application');
  const asked = askQuestion(
    project,
    dependency({
      tags: undefined,
      paths: undefined,
      precedent_offer: {
        ...dependency().precedent_offer,
        conditions: { rights_basis: ['security'] },
      },
    }),
  );
  answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  const later = askQuestion(
    project,
    dependency({ tags: undefined, paths: undefined, precedent_offer: undefined }),
  );
  assert.equal(later.outcome, 'precedent');
  const r = overrule(project, { decision: later.decision, why: 'wrong' });
  assert.equal(r.action, 'retired', 'nothing tells the case apart, so the precedent is retired');
  assert.equal(project.precedents.get('P-1')?.state, 'retired');
  assert.equal(
    overrule(project, { decision: later.decision, why: 'again' }).error,
    'already_overruled',
  );
  assert.equal(
    askQuestion(
      project,
      dependency({ tags: undefined, paths: undefined, precedent_offer: undefined }),
    ).outcome,
    'asked',
  );
});

test('the owner may say what to narrow it to, or retire it', () => {
  const project = makeProject();
  const asked = askQuestion(project, dependency());
  answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  const later = askQuestion(
    project,
    dependency({ tags: ['dependency-licence', 'npm'], precedent_offer: undefined }),
  );
  const r = overrule(project, {
    decision: later.decision,
    why: 'npm ones need a look',
    when: { tags: ['npm'] },
  });
  assert.deepEqual(r.exception.when, { tags: ['npm'] });
  assert.equal(
    askQuestion(
      project,
      dependency({ tags: ['dependency-licence', 'npm'], precedent_offer: undefined }),
    ).outcome,
    'asked',
  );
  assert.equal(
    askQuestion(project, dependency({ precedent_offer: undefined })).outcome,
    'precedent',
  );
});

test('a precedent overruled too often is put to the owner for review', () => {
  const project = makeProject({ rights: undefined });
  const asked = askQuestion(
    project,
    dependency({ tags: ['dependency-licence'], paths: undefined }),
  );
  answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  /** @type {string[]} */
  const applied = [];
  for (let i = 0; i < 3; i++) {
    const r = askQuestion(
      project,
      dependency({
        title: `Dep ${i}`,
        tags: ['dependency-licence'],
        paths: undefined,
        precedent_offer: undefined,
      }),
    );
    assert.equal(r.outcome, 'precedent');
    applied.push(r.decision);
  }
  assert.deepEqual(
    precedentHealth(project).map((h) => [h.applications, h.overrules, h.needs_review]),
    [[3, 0, false]],
  );
  overrule(project, { decision: applied[0], why: 'no', when: { tags: ['other'] } });
  const [h] = precedentHealth(project);
  assert.deepEqual(
    [h.applications, h.overrules, h.overrule_share, h.needs_review],
    [3, 1, 0.333, true],
  );
});

test('trust-calibration data: reversals, worth-asking ratings, overrules, per area', () => {
  const project = makeProject();
  const asked = askQuestion(project, dependency({ paths: ['src/cache/a.ts'] }));
  answerDecision(project, { decision: asked.decision, answer: 'A yes', worth_asking: false });
  const later = askQuestion(
    project,
    dependency({
      paths: ['src/cache/b.ts'],
      precedent_offer: undefined,
      tags: ['dependency-licence', 'x'],
    }),
  );
  assert.equal(later.outcome, 'precedent');
  overrule(project, { decision: later.decision, why: 'no' });
  recordReversal(project, {
    subject: 'logged-call-7',
    what: 'logged-call',
    area: 'cache',
    note: 'wrong default',
  });
  const second = askQuestion(
    project,
    dependency({ paths: ['docs/a.md'], tags: ['other'], precedent_offer: undefined }),
  );
  answerDecision(project, { decision: second.decision, answer: 'B', worth_asking: true });
  assert.equal(rateWorthAsking(project, { decision: second.decision, worth: true }).ok, true);

  const events = readTrustEvents(project.store);
  assert.ok(events.every((e) => e.schema_version === 1 && typeof e.at === 'string'));
  const summary = trustSummary(events);
  assert.deepEqual(
    [
      summary.cache.asked,
      summary.cache.applications,
      summary.cache.overrules,
      summary.cache.reversals,
    ],
    [1, 1, 1, 1],
  );
  assert.equal(summary.cache.escalation_worth, 0);
  assert.equal(summary.cache.precedent_match_accuracy, 0);
  assert.equal(summary.cache.auto_resolution_rate, 0.5);
  assert.equal(summary.cache.overrule_rate, 1);
  assert.deepEqual(
    [summary.docs.rated, summary.docs.worth_asking, summary.docs.escalation_worth],
    [2, 2, 1],
  );
  assert.equal(summary.docs.generalizations['none-given'], 1);
  assert.equal(summary.cache.generalizations.yes, 1);
  assert.equal(summary.cache.precedents_created, 1);
});

test('questions sent despite a candidate record whether the answer agreed with it', () => {
  const project = makeProject();
  const first = askQuestion(
    project,
    dependency({
      precedent_offer: {
        ...dependency().precedent_offer,
        conditions: { rights_basis: ['security'], text: 'only widely used packages' },
      },
    }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  const second = askQuestion(project, dependency({ precedent_offer: undefined }));
  assert.equal(second.candidates.length, 1);
  answerDecision(project, { decision: second.decision, answer: 'A', agrees_with: ['P-1'] });
  const third = askQuestion(project, dependency({ precedent_offer: undefined }));
  answerDecision(project, { decision: third.decision, answer: 'B' });
  const a = trustSummary(readTrustEvents(project.store)).unassigned;
  assert.deepEqual(
    [a.asked_with_candidates, a.answered_as_candidate, a.candidate_agreement],
    [2, 1, 0.5],
  );
});
