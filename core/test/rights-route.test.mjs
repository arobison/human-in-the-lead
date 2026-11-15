import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy, policyDefaults } from '../lib/policy/policy.mjs';
import { routeQuestion, areasOf, normalizeQuestion, BASIS_ORDER } from '../lib/rights/route.mjs';
import { safePath } from '../lib/precedent/glob.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { AREAS } from './helpers/project.mjs';

/** @param {Record<string, any>} [rights] */
const policyWith = (rights = {}) => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'fixture', key: 'W' },
    rights: { areas: AREAS, ...rights },
  });
  if (!policy) throw new Error(JSON.stringify(errors));
  return policy;
};
const policy = policyWith();
/** @param {string} basis */
const trig = (basis) => ({ basis, reason: `because ${basis}` });

test('no rule holds: the system decides, logs it, and moves on', () => {
  const r = routeQuestion(
    { question: 'Which of two equivalent names?', reversibility: 'two-way' },
    policy,
  );
  assert.equal(r.decider, 'system');
  assert.deepEqual(r.deciders, []);
  assert.equal(r.basis, null);
  assert.equal(r.rule.id, 'rights.default');
});

test('every default owner rule sends a call to the owner, naming the rule', () => {
  for (const basis of [
    'one-way-door',
    'public-commitment',
    'relationship',
    'budget',
    'security',
    'rule-change',
  ]) {
    const r = routeQuestion({ triggers: [trig(basis)] }, policy);
    assert.equal(r.decider, 'owner', basis);
    assert.equal(r.basis, basis);
    assert.equal(r.rule.id, `rights.rules.${basis}`);
    assert.equal(r.fired[0].reason, `because ${basis}`);
  }
});

test('a one-way door is found from the reversibility without being asserted', () => {
  const r = routeQuestion({ reversibility: 'one-way' }, policy);
  assert.equal(r.basis, 'one-way-door');
  assert.equal(r.fired[0].source, 'checked');
});

test('the budget rule compares spend with agent_spend_max_tokens', () => {
  assert.equal(routeQuestion({ spend_tokens: 100000 }, policy).decider, 'system');
  const over = routeQuestion({ spend_tokens: 100001 }, policy);
  assert.equal(over.basis, 'budget');
  assert.match(over.fired[0].reason, /100001 tokens.*agents may commit 100000/);
  const raised = policyWith({ agent_spend_max_tokens: 200000 });
  assert.equal(routeQuestion({ spend_tokens: 150000 }, raised).decider, 'system');
});

test('paths find the areas they touch', () => {
  assert.deepEqual(areasOf({ paths: ['src/cache/http/key.ts', 'docs/x.md'] }, policy), [
    'cache',
    'docs',
  ]);
  assert.deepEqual(areasOf({ areas: ['api'], paths: ['src/api/a.ts'] }, policy), ['api']);
});

test('blast radius within one area goes to that area owner when the area may decide it', () => {
  const r = routeQuestion({ triggers: [trig('blast-radius')], paths: ['src/cache/a.ts'] }, policy);
  assert.equal(r.decider, 'area-owner');
  assert.deepEqual(r.deciders, ['C-3']);
  assert.equal(r.basis, 'blast-radius');
});

test('an area owner may not decide a basis the area does not list', () => {
  const r = routeQuestion({ triggers: [trig('novelty')], paths: ['src/api/a.ts'] }, policy);
  assert.equal(r.decider, 'owner');
  assert.match(r.rule.why, /owners of api may not decide novelty/);
});

test('an area with no owner, or no area at all, leaves it with the owner', () => {
  const docs = routeQuestion({ triggers: [trig('blast-radius')], paths: ['docs/a.md'] }, policy);
  assert.equal(docs.decider, 'owner');
  assert.match(docs.rule.why, /area docs has no owner/);
  const none = routeQuestion({ triggers: [trig('blast-radius')] }, policy);
  assert.equal(none.decider, 'owner');
  assert.match(none.rule.why, /no area is identified/);
});

test('a call across areas is blast radius found by the script, and the owner decides it', () => {
  const r = routeQuestion({ paths: ['src/cache/a.ts', 'src/api/b.ts'] }, policy);
  assert.equal(r.decider, 'owner');
  assert.equal(r.basis, 'blast-radius');
  assert.deepEqual(r.areas, ['api', 'cache']);
  assert.equal(r.fired[0].source, 'checked');
});

test('novelty goes to the owner when it touches direction, otherwise to an area owner', () => {
  const direction = routeQuestion(
    { triggers: [trig('novelty')], paths: ['src/cache/a.ts'], direction: true },
    policy,
  );
  assert.equal(direction.decider, 'owner');
  const plain = routeQuestion({ triggers: [trig('novelty')], paths: ['src/cache/a.ts'] }, policy);
  assert.deepEqual([plain.decider, plain.deciders], ['area-owner', ['C-3']]);
});

test('a question across areas goes to every area owner involved, if a rule lets them decide it', () => {
  const open = policyWith({
    rules: { 'conflicting-evidence': { decider: 'area-owner' } },
    areas: [
      {
        name: 'a',
        paths: ['a/**'],
        owners: ['C-1'],
        may_decide: ['conflicting-evidence', 'blast-radius'],
      },
      {
        name: 'b',
        paths: ['b/**'],
        owners: ['C-2', 'C-5'],
        may_decide: ['conflicting-evidence', 'blast-radius'],
      },
    ],
  });
  const r = routeQuestion(
    { triggers: [trig('conflicting-evidence')], paths: ['a/x', 'b/y'] },
    open,
  );
  // Spanning two areas is also blast radius, which the owner decides by default.
  assert.equal(r.decider, 'owner');
  const noBlast = policyWith({
    rules: {
      'conflicting-evidence': { decider: 'area-owner', owner_when: [] },
      'blast-radius': { decider: 'area-owner', owner_when: [] },
    },
    areas: open.rights.areas,
  });
  const both = routeQuestion(
    { triggers: [trig('conflicting-evidence')], paths: ['a/x', 'b/y'] },
    noBlast,
  );
  assert.equal(both.decider, 'area-owner');
  assert.deepEqual(both.deciders, ['C-1', 'C-2', 'C-5']);
  const oneUnauthorized = policyWith({
    rules: noBlast.rights.rules,
    areas: [open.rights.areas[0], { ...open.rights.areas[1], may_decide: [] }],
  });
  assert.equal(
    routeQuestion(
      { triggers: [trig('conflicting-evidence')], paths: ['a/x', 'b/y'] },
      oneUnauthorized,
    ).decider,
    'owner',
  );
});

test('the strictest rule that fires names the decider, and every rule that holds is listed', () => {
  const r = routeQuestion(
    {
      triggers: [trig('novelty'), trig('security'), trig('public-commitment')],
      paths: ['src/cache/a.ts'],
    },
    policy,
  );
  assert.equal(r.decider, 'owner');
  assert.equal(r.basis, 'security');
  assert.deepEqual(
    r.fired.map((f) => f.basis),
    ['security', 'public-commitment', 'novelty'],
  );
  assert.deepEqual(
    r.fired.map((f) => f.basis),
    BASIS_ORDER.filter((b) => ['security', 'public-commitment', 'novelty'].includes(b)),
  );
});

test('addressed_to is honoured only for a judgement conflict, and then only adds a decider', () => {
  const conflict = [trig('conflicting-evidence')];
  // A genuine judgement conflict is also put to the person whose judgement it is.
  const owner = routeQuestion({ addressed_to: 'owner', triggers: conflict }, policy);
  assert.deepEqual(owner.deciders, ['owner']);
  assert.equal(owner.addressed, 'owner');
  const contributor = routeQuestion({ addressed_to: 'C-9', triggers: conflict }, policy);
  assert.deepEqual(contributor.deciders, ['owner', 'C-9'], 'the owner stays among the deciders');
  assert.equal(contributor.decider, 'owner');
  assert.equal(contributor.rule.id, 'rights.rules.conflicting-evidence');
});

test('addressed_to can never lower the decider', () => {
  const conflict = [trig('conflicting-evidence')];
  // On a security question it is ignored: the owner decides, and C-3 does not.
  const security = routeQuestion({ addressed_to: 'C-3', triggers: [trig('security')] }, policy);
  assert.deepEqual(security.deciders, ['owner']);
  assert.equal(security.addressed, null);
  assert.equal(security.addressed_ignored, true);
  // Mixed with a conflict trigger, it is still not a pure conflict: ignored.
  const mixed = routeQuestion(
    { addressed_to: 'C-3', triggers: [trig('conflicting-evidence'), trig('security')] },
    policy,
  );
  assert.deepEqual(mixed.deciders, ['owner']);
  // With no trigger at all it cannot make a call the system's, or anyone else's.
  const bare = routeQuestion({ addressed_to: 'C-3' }, policy);
  assert.equal(bare.decider, 'system');
  assert.equal(bare.addressed_ignored, true);
  // A conflict that a checked rule makes the owner's keeps the owner.
  const oneWay = routeQuestion(
    {
      addressed_to: 'C-3',
      triggers: conflict,
      reversibility: 'one-way',
      paths: ['src/cache/a.ts'],
    },
    policy,
  );
  assert.deepEqual(oneWay.deciders, ['owner', 'C-3']);
  assert.equal(oneWay.basis, 'one-way-door');
  // Across areas the owner decides too, however the question is addressed.
  const across = routeQuestion(
    { addressed_to: 'C-3', triggers: conflict, paths: ['src/cache/a.ts', 'src/api/b.ts'] },
    policy,
  );
  assert.ok(across.deciders.includes('owner'));
});

test('paths are normalized before routing; absolute or climbing paths are refused', () => {
  // src/api/../cache/a.ts is a cache path, not an api path.
  assert.deepEqual(
    areasOf(normalizeQuestion({ paths: ['src/api/../cache/a.ts'] }).question, policy),
    ['cache'],
  );
  assert.deepEqual(normalizeQuestion({ paths: ['./src//cache/a.ts'] }).question.paths, [
    'src/cache/a.ts',
  ]);
  for (const bad of [
    '/etc/passwd',
    'C:\\Windows\\x',
    '../outside',
    'src/../../outside',
    'src\\..\\..\\x',
  ]) {
    const r = normalizeQuestion({ paths: [bad] });
    assert.equal(r.errors.length, 1, bad);
    assert.throws(
      () => routeQuestion({ paths: [bad], triggers: [trig('security')] }, policy),
      /paths:/,
      bad,
    );
  }
  assert.deepEqual(safePath('a/b/../c'), { path: 'a/c' });
  assert.ok('error' in safePath('a/../..'));
});

test('changing a rule in policy changes the route: decision rights are data', () => {
  const delegated = policyWith({
    rules: { security: { decider: 'area-owner' } },
    areas: [{ name: 'cache', paths: ['src/cache/**'], owners: ['C-3'], may_decide: ['security'] }],
  });
  const r = routeQuestion({ triggers: [trig('security')], paths: ['src/cache/a.ts'] }, delegated);
  assert.deepEqual([r.decider, r.deciders], ['area-owner', ['C-3']]);
  assert.equal(policyDefaults().rights.rules.security.decider, 'owner');
});

test('the question schema refuses what it does not know, and a trigger without a reason', () => {
  const registry = schemas();
  assert.deepEqual(
    registry.validate('question', { triggers: [trig('security')], paths: ['a'] }),
    [],
  );
  assert.equal(registry.validate('question', { surprise: 1 })[0].message, 'is not a known key');
  assert.ok(registry.validate('question', { triggers: [{ basis: 'security' }] }).length > 0);
  assert.ok(registry.validate('question', { triggers: [trig('gut-feel')] }).length > 0);
  assert.ok(registry.validate('question', { on_answer: 'x' })[0].message.match(/code to run/));
});
