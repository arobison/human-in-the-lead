import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, main } from '../lib/cli/main.mjs';
import { COMMANDS, findCommand, toolName } from '../lib/cli/table.mjs';
import { inputSchema, parseArgs } from '../lib/cli/args.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { makeProject } from './helpers/project.mjs';
import { git, item, makeConsumer } from './orchestrator-fixture.mjs';

const question = {
  title: 'Add left-pad?',
  question: 'May we add left-pad (MIT) as a runtime dependency?',
  context: 'The padding in the report writer is hand-rolled and buggy.',
  options: [
    { label: 'Add it', what_happens: 'one small MIT dependency' },
    { label: 'Hand-roll', what_happens: 'we fix the bugs ourselves' },
  ],
  recommendation: { option: 'A', why: 'A permissive licence and a tiny surface.' },
  triggers: [{ basis: 'security', reason: 'it adds a dependency' }],
  tags: ['dependency-licence'],
  paths: ['package.json'],
  item_kind: 'work',
  classification: 'public',
  precedent_offer: {
    summary: 'new dependencies with permissive licences',
    rule: 'When a new dependency has a permissive licence, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-licence'] },
  },
};

/** The commands, run in a throwaway project against the stand-in tracker. */
function setup() {
  const project = makeProject();
  const commands = makeCommands({ openTracker: () => project.tracker });
  const ctx = { cwd: project.root, env: project.env };
  /** @param {string} name @param {Record<string, unknown>} input */
  const run = async (name, input) => {
    const c = commands.find((x) => x.name === name);
    assert.ok(c?.run, name);
    return /** @type {Record<string, any>} */ (await c.run(input, ctx));
  };
  return { project, run, ctx };
}

test("piece (e)'s commands are in the table, built, and have MCP schemas", () => {
  for (const name of ['rights who', 'precedent match']) {
    const found = findCommand(name.split(' '));
    assert.ok(found?.command.run, `${name} is built`);
    assert.equal(found.command.built_by, 'e');
  }
  const mine = COMMANDS.filter((c) => c.built_by === 'e');
  assert.ok(mine.length >= 10);
  for (const c of mine) {
    assert.ok(c.run, c.name);
    assert.equal(inputSchema(c.args ?? []).type, 'object');
    assert.match(toolName(c), /^[a-z_]+$/);
  }
});

test('hitld rights classifies a question from the command line, and names the rule', async () => {
  const { project } = setup();
  let out = '';
  const code = await main(['rights', 'who', '--question', JSON.stringify(question)], {
    out: (t) => (out += t),
    err: () => {},
    cwd: project.root,
    env: project.env,
  });
  assert.equal(code, EXIT.ok);
  const r = JSON.parse(out);
  assert.equal(r.decider, 'owner');
  assert.equal(r.basis, 'security');
  assert.equal(r.rule.id, 'rights.rules.security');
});

test('hitld rights reads a question from a file, and refuses bad input with a usage message', async () => {
  const { project } = setup();
  const file = join(project.root, 'q.json');
  writeFileSync(file, JSON.stringify({ spend_tokens: 5 }));
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    let out = '';
    const code = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: project.root,
      env: project.env,
    });
    return { code, result: JSON.parse(out) };
  };
  const ok = await hitld(['rights', 'who', '--file', file]);
  assert.equal(ok.result.decider, 'system');
  const both = await hitld(['rights', 'who', '--file', file, '--question', '{}']);
  assert.equal(both.code, EXIT.failed);
  assert.match(both.result.message, /not both/);
  const none = await hitld(['rights', 'who']);
  assert.equal(none.code, EXIT.failed);
  const bad = await hitld(['rights', 'who', '--question', '{"surprise":1}']);
  assert.match(bad.result.message, /surprise is not a known key/);
  const notJson = await hitld(['rights', 'who', '--question', 'nope']);
  assert.match(notJson.result.message, /is not valid JSON/);
});

test('without a policy.json the commands say so', async () => {
  const rights = makeCommands({ openTracker: () => /** @type {any} */ (null) }).find(
    (c) => c.name === 'rights who',
  );
  const nowhere = mkdtempSync(join(tmpdir(), 'hitld-none-'));
  const r = /** @type {any} */ (await rights?.run?.({ question: '{}' }, { cwd: nowhere, env: {} }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'policy');
});

test('rights ask and rights answer write the files tracker of the primary checkout', async () => {
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
  const filed = { ...question, parent: 'W-7' };
  const asked = await c.hitld(['rights', 'ask', '--question', JSON.stringify(filed)]);
  assert.equal(asked.exit, EXIT.ok, JSON.stringify(asked.result));
  assert.equal(asked.result.outcome, 'asked');
  const id = asked.result.decision;
  const open = await c.hitld(['work', 'show', id, '--json']);
  assert.equal(open.result.entity.state, 'planned');
  assert.equal(open.result.entity.parent, 'W-7');
  assert.equal(open.result.entity.answer, undefined);
  // The question, options and offer are the body's, for the decider to read.
  assert.match(open.result.entity.body, /## Question\n\nMay we add left-pad/);
  assert.match(open.result.entity.body, /- A\. Add it: one small MIT dependency/);
  assert.match(open.result.entity.body, /Future cases like this \(new dependencies/);

  // From a linked worktree, an executor's place, neither command runs.
  const wt = join(c.base, 'wt');
  git(c.root, 'worktree', 'add', '-q', '-b', 'exec-branch', wt);
  for (const argv of [
    ['rights', 'ask', '--question', JSON.stringify(filed)],
    ['rights', 'answer', id, '--answer', 'A'],
  ]) {
    const refused = await c.hitld(argv, { cwd: wt });
    assert.equal(refused.result.error, 'not_permitted', argv[1]);
  }

  const answered = await c.hitld(['rights', 'answer', id, '--answer', 'A yes']);
  assert.equal(answered.exit, EXIT.ok, JSON.stringify(answered.result));
  assert.equal(answered.result.precedent.id, 'P-1');
  const done = (await c.hitld(['work', 'show', id, '--json'])).result;
  assert.equal(done.api_version, 2);
  const { body: _, path: __, version: ___, entity: ____, ...fields } = done.entity;
  assert.equal(fields.state, 'done');
  assert.equal(fields.answer, 'A. Add it: one small MIT dependency');
  assert.match(fields.answered_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(fields.answered_via, 'main-session');
  assert.equal(fields.answered_by, 'owner');
  assert.equal(fields.precedent, 'P-1');
  assert.equal(fields.resolved_by_precedent, undefined);
  const again = await c.hitld(['rights', 'answer', id, '--answer', 'B']);
  assert.equal(again.result.error, 'not_open');

  // A like question is resolved by the precedent: Done at once, citing it, answered by nobody.
  const like = { ...filed, title: 'Add right-pad?', precedent_offer: undefined };
  const resolved = await c.hitld(['rights', 'ask', '--question', JSON.stringify(like)]);
  assert.equal(resolved.result.outcome, 'precedent', JSON.stringify(resolved.result));
  const applied = (await c.hitld(['work', 'show', resolved.result.decision, '--json'])).result;
  assert.equal(applied.entity.state, 'done');
  assert.equal(applied.entity.resolved_by_precedent, 'P-1');
  assert.equal(applied.entity.answered_via, 'precedent');
  assert.equal(applied.entity.answered_by, undefined);
  const digest = await c.hitld(['rights', 'digest']);
  assert.deepEqual(
    digest.result.applications.map((/** @type {any} */ a) => a.decision),
    [resolved.result.decision],
  );
  const query = await c.hitld(['work', 'query', '--kind', 'decision', '--json']);
  assert.equal(query.result.entities.length, 2);

  // The files the commands wrote pass the check (W-1 to W-3 of the fixture have no project).
  const check = await c.hitld(['work', 'check']);
  const mine = (check.result.problems ?? []).filter((/** @type {string} */ p) =>
    /W-(8|9)-/.test(p),
  );
  assert.deepEqual(mine, []);

  // What the files cannot hold truthfully is refused, never written.
  const internal = { ...filed, title: 'Internal?', classification: 'internal' };
  const refused = await c.hitld(['rights', 'ask', '--question', JSON.stringify(internal)]);
  assert.equal(refused.result.error, 'not_created');
  assert.match(refused.result.message, /classified internal cannot be written/);
  const orphan = { ...question, title: 'Orphan?', precedent_offer: undefined, tags: ['x'] };
  const noParent = await c.hitld(['rights', 'ask', '--question', JSON.stringify(orphan)]);
  assert.equal(noParent.result.error, 'not_created');
  assert.match(noParent.result.message, /the question's parent names the project/);
});

test('the commands carry a question through to a precedent, a digest and an overrule', async () => {
  const { project, run } = setup();
  const asked = await run('rights ask', { question: JSON.stringify(question) });
  assert.equal(asked.outcome, 'asked');
  assert.equal(asked.decision, 'W-1');

  const answered = await run('rights answer', {
    decision: 'W-1',
    answer: 'A yes',
    'worth-asking': 'yes',
    via: 'remote-control',
  });
  assert.equal(answered.precedent.id, 'P-1');

  const match = await run('precedent match', {
    question: JSON.stringify({ ...question, precedent_offer: undefined }),
  });
  assert.deepEqual(
    match.candidates.map((/** @type {any} */ c) => c.id),
    ['P-1'],
  );
  assert.equal(match.candidates[0].needs_judgement, false);

  const again = await run('rights ask', {
    question: JSON.stringify({
      ...question,
      tags: ['dependency-licence', 'cli'],
      precedent_offer: undefined,
    }),
  });
  assert.equal(again.outcome, 'precedent');

  const digest = await run('rights digest', { mark: true });
  assert.deepEqual(
    digest.applications.map((/** @type {any} */ a) => a.decision),
    [again.decision],
  );
  const next = await run('rights digest', {});
  assert.deepEqual(next.applications, [], 'a marked digest is not listed twice');
  const since = await run('rights digest', { since: '2000-01-01' });
  assert.equal(since.applications.length, 1, 'but can be asked for again');

  const over = await run('rights overrule', {
    decision: again.decision,
    why: 'cli tools need a look',
  });
  assert.equal(over.action, 'narrowed');
  assert.equal((await run('rights digest', { since: '2000-01-01' })).overruled, 1);

  await run('rights reverse', { subject: 'W-77', what: 'logged-call', area: 'cache' });
  await run('rights rate', { decision: 'W-1', 'worth-asking': 'no' });
  const trust = await run('rights trust', {});
  assert.equal(trust.areas.unassigned.overrules, 1);
  assert.equal(trust.areas.cache.reversals, 1);
  // W-1 was rated yes with its answer and no afterwards: the later rating stands.
  assert.equal(trust.areas.unassigned.rated, 1);
  assert.equal(trust.areas.unassigned.escalation_worth, 0);
  assert.ok(project);
});

test('hitld judgement weigh and conflict', async () => {
  const { run } = setup();
  const subject = {
    judgements: [{ what: 'valuable', basis: 'gut-check', by: 'owner' }],
    confidence: 0.5,
    evidence: [{ ref: 'S-4', verdict: 'contradicts', summary: 'no gain' }],
  };
  const w = await run('judgement weigh', { subject: JSON.stringify(subject) });
  assert.equal(w.ok, true);
  assert.equal(w.conflicts.length, 1);
  assert.equal(w.confidence, 0.5);
  const q = await run('judgement conflict', {
    conflict: JSON.stringify({
      subject: 'W-90',
      judgement: subject.judgements[0],
      evidence: subject.evidence,
      recommend: 'revise',
      why: 'Measured.',
    }),
  });
  assert.equal(q.question.addressed_to, 'owner');
});

test("the parser accepts the commands' options", () => {
  const answer = COMMANDS.find((c) => c.name === 'rights answer');
  assert.deepEqual(
    parseArgs(['W-4', '--answer', 'A yes', '--worth-asking', 'yes'], answer?.args ?? []),
    { decision: 'W-4', answer: 'A yes', 'worth-asking': 'yes' },
  );
});

test('an executor cannot ask, show, log, answer, overrule, reverse, rate or trust a decision (Q21)', async () => {
  const cmds = makeCommands({ openTracker: () => /** @type {any} */ (null) });
  const nowhere = mkdtempSync(join(tmpdir(), 'hitld-exec-'));
  for (const name of [
    'rights ask',
    'rights show',
    'rights log',
    'rights answer',
    'rights overrule',
    'rights reverse',
    'rights rate',
    'rights trust',
  ]) {
    const c = cmds.find((x) => x.name === name);
    for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const r = /** @type {any} */ (
        await c?.run?.({ decision: 'W-1', answer: 'A' }, { cwd: nowhere, env })
      );
      assert.equal(r.error, 'not_permitted', `${name} with ${JSON.stringify(env)}`);
    }
  }
  const owner = /** @type {any} */ (
    await cmds
      .find((x) => x.name === 'rights answer')
      ?.run?.({ decision: 'W-1', answer: 'A' }, { cwd: nowhere, env: {} })
  );
  assert.notEqual(owner.error, 'not_permitted');
});

test('the decision commands refuse in a linked worktree, where executors work (Q21)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'hitld-repo-'));
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'start');
  const wt = join(mkdtempSync(join(tmpdir(), 'hitld-wt-')), 'w');
  git('worktree', 'add', '-q', '-b', 'exec-branch', wt);
  const c = makeCommands({ openTracker: () => /** @type {any} */ (null) }).find(
    (x) => x.name === 'rights answer',
  );
  const r = /** @type {any} */ (
    await c?.run?.({ decision: 'W-1', answer: 'A' }, { cwd: wt, env: {} })
  );
  assert.equal(r.error, 'not_permitted');
  assert.match(r.message, /linked worktree/);
  const main = /** @type {any} */ (
    await c?.run?.({ decision: 'W-1', answer: 'A' }, { cwd: repo, env: {} })
  );
  assert.notEqual(main.error, 'not_permitted');
});
