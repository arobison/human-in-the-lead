// The security review of piece (e): addressing cannot lower a decider, precedent cannot be used to
// escalate, an overrule cannot leak, the offer shown is the offer enforced, paths are normalized,
// and --file reads only inside the repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerDecision, askQuestion, overrule } from '../lib/rights/flow.mjs';
import { enforceOffer } from '../lib/rights/offer.mjs';
import { formatQuestion } from '../lib/rights/format.mjs';
import { globMatch } from '../lib/precedent/glob.mjs';
import { readTrustEvents } from '../lib/rights/trust.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { main } from '../lib/cli/main.mjs';
import { inputSchema } from '../lib/cli/args.mjs';
import { mayAppearIn, moreRestrictedThan, rank } from '../lib/precedent/classification.mjs';
import { makeProject } from './helpers/project.mjs';

/** An area-owner question: novelty inside cache goes to C-3. */
const areaQuestion = (/** @type {Record<string, any>} */ more = {}) =>
  JSON.parse(
    JSON.stringify({
      title: 'Cache key format?',
      question: 'Should the response cache key include the locale?',
      context: 'Keys without it are stable across updates; one bug came from a driver change.',
      options: [
        { label: 'Include', what_happens: 'always correct' },
        { label: 'Exclude', what_happens: 'faster after upgrades' },
      ],
      recommendation: { option: 'A', why: 'Correctness over a cold cache.' },
      triggers: [{ basis: 'novelty', reason: 'no precedent covers it' }],
      paths: ['src/cache/http/key.ts'],
      tags: ['cache-key'],
      item_kind: 'work',
      classification: 'public',
      precedent_offer: {
        summary: 'cache keys',
        rule: 'When a cache key varies by an external version, include it.',
        conditions: { rights_basis: ['novelty'], tags: ['cache-key'] },
      },
      ...more,
    }),
  );

/** An owner question: security. */
const ownerQuestion = (/** @type {Record<string, any>} */ more = {}) =>
  areaQuestion({
    triggers: [{ basis: 'security', reason: 'it adds a dependency' }],
    precedent_offer: undefined,
    ...more,
  });

/** @param {Record<string, any>} [more] */
const forged = (more = {}) => ({
  schema_version: 1,
  id: 'P-1',
  rule: 'When a cache key varies, include it.',
  conditions: { tags: ['cache-key'] },
  sources: ['W-1'],
  scope: 'project',
  state: 'active',
  classification: 'public',
  ...more,
});

// 2. Privilege escalation through precedent ---------------------------------------------------

test("an area owner's offer is clamped to their area: scope, area condition and rule bases", () => {
  const project = makeProject();
  const q = areaQuestion({
    precedent_offer: {
      summary: 'cache keys',
      rule: 'Include external versions in keys.',
      conditions: { rights_basis: ['novelty'], tags: ['cache-key'] },
      scope: 'project',
    },
  });
  const asked = askQuestion(project, q);
  assert.equal(asked.outcome, 'asked');
  assert.deepEqual(asked.route.deciders, ['C-3']);
  const stored = /** @type {Record<string, any>} */ (project.tracker.get(asked.decision));
  assert.equal(stored.precedent_offer.scope, 'area:cache', 'forced to the area');
  assert.deepEqual(stored.precedent_offer.conditions.areas, ['cache']);
  assert.match(asked.text, /Scope: area:cache\. Made by: C-3\./);

  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'C-3' });
  assert.equal(r.precedent.id, 'P-1');
  const p = project.precedents.get('P-1');
  assert.equal(p?.scope, 'area:cache');
  assert.equal(p?.decider, 'C-3');
  assert.deepEqual(p?.conditions.areas, ['cache']);
});

test('an area owner may not generalize over rule bases the area may not decide', () => {
  const project = makeProject();
  const wide = areaQuestion({
    precedent_offer: {
      summary: 'dependencies',
      rule: 'Allow dependencies.',
      conditions: { rights_basis: ['novelty', 'security'], tags: ['cache-key'] },
    },
  });
  const asked = askQuestion(project, wide);
  assert.equal(asked.outcome, 'asked');
  assert.match(asked.warnings[0], /offer_not_permitted: the owners of cache may decide/);
  assert.equal(/** @type {any} */ (project.tracker.get(asked.decision)).precedent_offer, undefined);
  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'C-3' });
  assert.equal(r.precedent, null);
  assert.deepEqual(project.precedents.list(), []);
});

test('the authority comes from the record made at ask time, not from fields of the decision item', () => {
  /** @type {Record<string, Record<string, any>>} */
  const edits = {
    'a widened offer': {
      precedent_offer: {
        summary: 'cache keys',
        rule: 'Allow anything.',
        conditions: { rights_basis: ['novelty'], tags: ['cache-key'] },
        scope: 'project',
      },
    },
    'the decider changed to the owner': { decider: 'owner' },
    'the area changed': { area: 'api' },
    'the rule basis changed': { rights_basis: 'blast-radius' },
    'the classification lowered': { classification: 'internal' },
  };
  for (const [what, patch] of Object.entries(edits)) {
    const project = makeProject();
    const asked = askQuestion(project, areaQuestion());
    project.tracker.update(asked.decision, patch, /** @type {any} */ (undefined));
    const r = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'owner' });
    assert.equal(r.ok, true, what);
    assert.equal(r.precedent, null, `${what}: no precedent`);
    assert.match(r.warnings[0], /^decision_changed/, what);
    assert.deepEqual(project.precedents.list(), [], what);
  }
});

test('a decision that was not asked through the rights flow makes no precedent', () => {
  const project = makeProject();
  const id = project.tracker.create({
    schema_version: 1,
    kind: 'decision',
    title: 'Hand-made',
    state: 'planned',
    classification: 'public',
    decider: 'owner',
    options: [
      { label: 'A', what_happens: 'yes' },
      { label: 'B', what_happens: 'no' },
    ],
    precedent_offer: { summary: 's', rule: 'Allow everything.', conditions: { tags: ['x'] } },
  });
  const r = answerDecision(project, { decision: id, answer: 'A yes' });
  assert.equal(r.ok, true);
  assert.equal(r.precedent, null);
  assert.match(r.warnings[0], /^no_route_record/);
});

test('an unchanged decision still makes its precedent from the record', () => {
  const project = makeProject();
  const asked = askQuestion(project, areaQuestion());
  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'C-3' });
  assert.equal(r.precedent.id, 'P-1');
  assert.deepEqual(project.store.list('rights/asked/'), [`rights/asked/${asked.decision}.json`]);
});

test('only a decider, or the owner, may answer', () => {
  const project = makeProject();
  const asked = askQuestion(project, areaQuestion());
  const r = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'C-4' });
  assert.equal(r.error, 'not_a_decider');
  assert.equal(/** @type {any} */ (project.tracker.get(asked.decision)).state, 'planned');
  const owner = answerDecision(project, { decision: asked.decision, answer: 'A yes', by: 'owner' });
  assert.equal(owner.ok, true);
  assert.equal(project.precedents.get('P-1')?.decider, 'owner', 'the owner made it');
  assert.equal(
    project.precedents.get('P-1')?.scope,
    'area:cache',
    'but the offer was already clamped',
  );
});

test('an owner-routed question is never resolved by a precedent an area owner made', () => {
  const project = makeProject();
  project.precedents.put(
    forged({
      decider: 'C-3',
      scope: 'area:cache',
      conditions: { areas: ['cache'], tags: ['cache-key'] },
    }),
  );
  const r = askQuestion(project, ownerQuestion());
  assert.equal(r.route.decider, 'owner');
  assert.equal(r.outcome, 'asked', 'the owner is asked');
  assert.deepEqual(r.candidates, []);
  assert.equal(project.tracker.query({ kind: 'decision', state: 'done' }).length, 0);
});

test('a precedent with no recorded decider resolves nothing', () => {
  const project = makeProject();
  project.precedents.put(forged());
  assert.equal(askQuestion(project, areaQuestion({ precedent_offer: undefined })).outcome, 'asked');
  assert.equal(askQuestion(project, ownerQuestion()).outcome, 'asked');
});

test("an area owner's precedent resolves only the questions of area owners it covers", () => {
  const project = makeProject();
  project.precedents.put(
    forged({
      decider: 'C-3',
      scope: 'area:cache',
      conditions: { areas: ['cache'], tags: ['cache-key'] },
    }),
  );
  assert.equal(
    askQuestion(project, areaQuestion({ precedent_offer: undefined })).outcome,
    'precedent',
  );
  // The same precedent does not reach api, whose owner is someone else and who may decide blast radius only.
  const api = askQuestion(
    project,
    areaQuestion({
      paths: ['src/api/x.ts'],
      triggers: [{ basis: 'blast-radius', reason: 'it changes behaviour users rely on' }],
      precedent_offer: undefined,
    }),
  );
  assert.deepEqual(api.route.deciders, ['C-4']);
  assert.equal(api.outcome, 'asked');
});

test("an owner's precedent resolves an area owner's question: the owner could have decided it", () => {
  const project = makeProject();
  project.precedents.put(
    forged({ decider: 'owner', conditions: { tags: ['cache-key'], rights_basis: ['novelty'] } }),
  );
  assert.equal(
    askQuestion(project, areaQuestion({ precedent_offer: undefined })).outcome,
    'precedent',
  );
});

test("addressing a judgement conflict cannot hand the owner's question to a contributor", () => {
  const project = makeProject();
  const q = ownerQuestion({ addressed_to: 'C-9', precedent_offer: undefined });
  const r = askQuestion(project, q);
  assert.deepEqual(r.route.deciders, ['owner']);
  assert.equal(/** @type {any} */ (project.tracker.get(r.decision)).decider, 'owner');
  assert.equal(
    answerDecision(project, { decision: r.decision, answer: 'A', by: 'C-9' }).error,
    'not_a_decider',
  );
});

// 3. A classification leak in overrule --------------------------------------------------------

test('an overrule of a more confidential decision does not write its attributes or reason into the precedent', () => {
  const project = makeProject();
  const first = askQuestion(
    project,
    ownerQuestion({
      tags: ['dependency-licence'],
      paths: ['package.json'],
      precedent_offer: {
        summary: 'licences',
        rule: 'Allow permissive licences.',
        conditions: { rights_basis: ['security'], tags: ['dependency-licence'] },
      },
    }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  assert.equal(project.precedents.get('P-1')?.classification, 'public');

  const secret = () =>
    askQuestion(
      project,
      ownerQuestion({
        classification: 'confidential',
        tags: ['dependency-licence', 'acme-partner'],
        paths: ['package.json'],
        precedent_offer: undefined,
      }),
    );
  const a = secret();
  assert.equal(a.outcome, 'precedent');

  // No automatic exception from the confidential case.
  const refused = overrule(project, { decision: a.decision, why: 'the partner acme forbids it' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'sensitive_exception');
  assert.equal(project.precedents.get('P-1')?.state, 'active', 'nothing was written');

  // With attributes the owner chose, and no reason in the precedent.
  const ok = overrule(project, {
    decision: a.decision,
    why: 'the partner acme forbids it',
    when: { tags: ['restricted'] },
  });
  assert.equal(ok.ok, true);
  const p = project.precedents.get('P-1');
  assert.deepEqual(p?.exceptions, [{ when: { tags: ['restricted'] } }]);
  assert.ok(!JSON.stringify(p).includes('acme'));
  const events = JSON.stringify(readTrustEvents(project.store));
  assert.ok(
    events.includes('the partner acme forbids it'),
    'the reason is kept in the private record',
  );

  // The exception the owner chose is what narrows it.
  assert.equal(
    secret().outcome,
    'precedent',
    'a case without the chosen attribute is still covered',
  );
  const restricted = askQuestion(
    project,
    ownerQuestion({
      tags: ['dependency-licence', 'restricted'],
      paths: ['package.json'],
      precedent_offer: undefined,
    }),
  );
  assert.equal(restricted.outcome, 'asked');
});

test('retiring over a confidential application keeps the reason private', () => {
  const project = makeProject();
  const first = askQuestion(
    project,
    ownerQuestion({
      precedent_offer: {
        summary: 's',
        rule: 'Allow it.',
        conditions: { rights_basis: ['security'] },
      },
    }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  const a = askQuestion(
    project,
    ownerQuestion({ classification: 'confidential', precedent_offer: undefined }),
  );
  assert.equal(a.outcome, 'precedent');
  const r = overrule(project, {
    decision: a.decision,
    why: 'project falcon is affected',
    retire: true,
  });
  assert.equal(r.action, 'retired');
  assert.ok(!JSON.stringify(project.precedents.get('P-1')).includes('falcon'));
});

test('an overrule at the same classification still derives the exception automatically', () => {
  const project = makeProject();
  const first = askQuestion(
    project,
    ownerQuestion({
      precedent_offer: {
        summary: 's',
        rule: 'Allow it.',
        conditions: { rights_basis: ['security'] },
      },
    }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  const a = askQuestion(project, ownerQuestion({ precedent_offer: undefined }));
  const r = overrule(project, { decision: a.decision, why: 'no' });
  assert.equal(r.action, 'narrowed');
});

// 4. What is shown is what is enforced --------------------------------------------------------

test('the precedent offer is spelled out from its structured conditions, scope and rule', () => {
  const project = makeProject();
  const q = ownerQuestion({
    precedent_offer: {
      summary: 'just dev tools, small things',
      rule: 'Allow any dependency.',
      conditions: { rights_basis: ['security'], paths: ['**'], tags: ['npm'], text: 'whatever' },
      exceptions: ['native build steps'],
    },
  });
  const asked = askQuestion(project, q);
  const flat = asked.text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('(just dev tools, small things)'), "the asker's summary is shown");
  assert.ok(flat.includes('If yes, this becomes a precedent: "Allow any dependency."'));
  assert.ok(
    flat.includes(
      'It applies when: rule bases security; paths **; tags npm; and, in words: whatever.',
    ),
  );
  assert.ok(flat.includes('Except: native build steps.'));
  assert.ok(flat.includes('Scope: project. Made by: owner.'));
  // And what is created is what was shown.
  answerDecision(project, { decision: asked.decision, answer: 'A yes' });
  const p = project.precedents.get('P-1');
  assert.deepEqual(p?.conditions, {
    rights_basis: ['security'],
    paths: ['**'],
    tags: ['npm'],
    text: 'whatever',
  });
  assert.equal(p?.scope, 'project');
  assert.equal(p?.decider, 'owner');
});

test('formatQuestion renders only structured parts for the offer, structured exceptions included', () => {
  const text = formatQuestion({
    id: 'W-1',
    question: 'q?',
    decider: 'C-3',
    options: [],
    precedent_offer: {
      summary: 'x',
      rule: 'r',
      scope: 'area:cache',
      conditions: { areas: ['cache'], item_kinds: ['work'] },
      exceptions: [{ when: { paths: ['src/a/**'] }, why: 'special' }],
    },
  });
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('It applies when: areas cache; item kinds work.'));
  assert.ok(flat.includes('Except: paths src/a/** (special).'));
  assert.ok(flat.includes('Scope: area:cache. Made by: C-3.'));
});

// 5. Path normalization -----------------------------------------------------------------------

test('a traversal path cannot be taken for a path in another area, or for none', () => {
  const project = makeProject();
  // Normalizes to a cache path, so the cache owner decides, not the api owner.
  const viaRender = askQuestion(
    project,
    areaQuestion({ paths: ['src/api/../cache/cache/key.ts'], precedent_offer: undefined }),
  );
  assert.deepEqual(viaRender.route.areas, ['cache']);
  for (const bad of ['../../etc/passwd', '/etc/passwd', 'src/cache/../../../x', 'C:\\Windows\\x']) {
    const r = askQuestion(project, areaQuestion({ paths: [bad], precedent_offer: undefined }));
    assert.equal(r.ok, false, bad);
    assert.equal(r.error, 'invalid_question', bad);
  }
});

test('a precedent cannot be built on climbing path globs', () => {
  const policy = makeProject().policy;
  const base = { deciders: ['owner'], policy };
  const bad = enforceOffer({ summary: 's', rule: 'r', conditions: { paths: ['../x/**'] } }, base);
  assert.ok('error' in bad && /leaves the repository root/.test(bad.error));
  const ex = enforceOffer(
    {
      summary: 's',
      rule: 'r',
      conditions: { tags: ['t'] },
      exceptions: [{ when: { paths: ['/abs'] } }],
    },
    base,
  );
  assert.ok('error' in ex);
  const fine = enforceOffer(
    { summary: 's', rule: 'r', conditions: { paths: ['./src//a/**'] } },
    base,
  );
  assert.ok('offer' in fine && fine.offer.conditions.paths[0] === 'src/a/**');
  assert.ok(globMatch('src/a/**', 'src/a/b/../c.ts'));
  assert.ok(!globMatch('src/a/**', 'src/b/../c.ts'));
});

// 6. --file ------------------------------------------------------------------------------------

test('--file reads only inside the repository, never through MCP, and never echoes parse details', async () => {
  const project = makeProject();
  const rights = /** @type {any} */ (
    makeCommands({ openTracker: () => project.tracker }).find((c) => c.name === 'rights')
  );
  const ctx = { cwd: project.root, env: project.env, interactive: true };
  const q = JSON.stringify({ triggers: [{ basis: 'security', reason: 'x' }] });

  const inside = join(project.root, 'q.json');
  writeFileSync(inside, q);
  assert.equal((await rights.run({ file: 'q.json' }, ctx)).decider, 'owner');

  const outsideDir = mkdtempSync(join(tmpdir(), 'hitld-outside-'));
  const outside = join(outsideDir, 'secret.json');
  writeFileSync(outside, '{"password": "hunter2" oops');
  await assert.rejects(rights.run({ file: outside }, ctx), /inside the repository/);
  await assert.rejects(rights.run({ file: '../../../etc/passwd' }, ctx), /inside the repository/);

  // A symbolic link inside the repository to a file outside it is followed and refused.
  symlinkSync(outside, join(project.root, 'link.json'));
  await assert.rejects(rights.run({ file: 'link.json' }, ctx), (e) => {
    assert.match(String(e), /inside the repository/);
    assert.ok(!String(e).includes('hunter2'));
    return true;
  });

  // A file inside the repository that is not JSON: no parse details, no content.
  writeFileSync(join(project.root, 'bad.json'), '{"password": "hunter2" oops');
  await assert.rejects(rights.run({ file: 'bad.json' }, ctx), (e) => {
    assert.equal(/** @type {Error} */ (e).message, '--file is not valid JSON');
    return true;
  });
  await assert.rejects(rights.run({ question: '{"a": 1,' }, ctx), (e) => {
    assert.equal(/** @type {Error} */ (e).message, '--question is not valid JSON');
    return true;
  });

  assert.equal((await rights.run({ question: q }, ctx)).decider, 'owner');
});

test('--file is denied by default: only the human command line sets ctx.interactive', async () => {
  const project = makeProject();
  const commands = makeCommands({ openTracker: () => project.tracker });
  writeFileSync(join(project.root, 'q.json'), JSON.stringify({ spend_tokens: 1 }));
  const bare = { cwd: project.root, env: project.env }; // what an MCP dispatcher builds
  for (const name of ['rights', 'precedent match', 'judgement weigh', 'judgement conflict']) {
    const c = /** @type {any} */ (commands.find((x) => x.name === name));
    await assert.rejects(
      async () => c.run({ file: 'q.json' }, bare),
      /only available at the command line/,
      name,
    );
    await assert.rejects(
      async () => c.run({ file: 'q.json' }, { ...bare, interactive: false }),
      /command line/,
      name,
    );
    // The MCP tool schema does not offer the option at all.
    const schema = inputSchema(c.args ?? []);
    assert.ok(!('file' in schema.properties), `${name}: no file in the MCP schema`);
    assert.equal(schema.additionalProperties, false);
  }
  // The human command line is the one path that sets it.
  let out = '';
  const code = await main(['rights', '--file', 'q.json'], {
    out: (t) => (out += t),
    err: () => {},
    cwd: project.root,
    env: project.env,
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).decider, 'system');
});

// Classification comparisons fail closed --------------------------------------------------------

test('an unknown or missing classification ranks as the most restrictive', () => {
  for (const odd of [undefined, null, '', 'top-secret', 'toString', 'constructor', 'Public', 42]) {
    assert.equal(rank(odd), 3, String(odd));
    assert.equal(mayAppearIn(odd, 'secret'), false, `${String(odd)} may not appear anywhere`);
    assert.equal(mayAppearIn('public', odd), false, `nothing may appear in ${String(odd)}`);
    assert.equal(moreRestrictedThan(odd, 'public'), true);
    assert.equal(
      moreRestrictedThan('secret', odd),
      true,
      'an unknown precedent is not trusted either',
    );
  }
  assert.equal(mayAppearIn('public', 'internal'), true);
  assert.equal(moreRestrictedThan('internal', 'public'), true);
  assert.equal(moreRestrictedThan('public', 'public'), false);
});

test('an overrule whose decision has an unknown classification is treated as the most confidential', () => {
  const project = makeProject();
  const first = askQuestion(
    project,
    ownerQuestion({
      precedent_offer: {
        summary: 's',
        rule: 'Allow it.',
        conditions: { rights_basis: ['security'] },
      },
    }),
  );
  answerDecision(project, { decision: first.decision, answer: 'A yes' });
  const a = askQuestion(project, ownerQuestion({ precedent_offer: undefined }));
  // The tracker's copy now carries a classification nobody recognizes.
  const item = /** @type {Record<string, any>} */ (project.tracker.items.get(a.decision));
  item.classification = 'toString';
  const r = overrule(project, { decision: a.decision, why: 'the reason' });
  assert.equal(r.error, 'sensitive_exception');
  const retired = overrule(project, { decision: a.decision, why: 'the reason', retire: true });
  assert.equal(retired.action, 'retired');
  assert.ok(!JSON.stringify(project.precedents.get('P-1')).includes('the reason'));
});

test('a precedent of unknown classification is not cited in a decision', () => {
  const project = makeProject();
  project.precedents.put(forged({ decider: 'owner', conditions: { tags: ['cache-key'] } }));
  const stored = /** @type {Record<string, any>} */ (project.precedents.get('P-1'));
  const real = project.precedents.list;
  project.precedents.list = () => [{ ...stored, classification: 'toString' }];
  const r = askQuestion(project, ownerQuestion({ precedent_offer: undefined }));
  project.precedents.list = real;
  assert.equal(r.outcome, 'precedent');
  assert.equal(
    /** @type {any} */ (project.tracker.get(r.decision)).answer,
    'Resolved by precedent P-1',
  );
});
