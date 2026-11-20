// A choice the owner makes in conversation is recorded as a decision and its answer in one step
// (HITLD-134): through the harness's question tool, in chat, and never outside the owner's turn.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askedKey, checkCode, recordChoice } from '../lib/rights/flow.mjs';
import { pendingDecisions } from '../lib/rights/pending.mjs';
import { invalidTrustEvent, readTrustEvents, trustSummary } from '../lib/rights/trust.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { attentionDefaults } from '../lib/settings/attention.mjs';
import { makeCommands } from '../lib/cli/commands/rights.mjs';
import { EXIT } from '../lib/cli/main.mjs';
import { makeProject } from './helpers/project.mjs';
import { git, item, makeConsumer } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const HOOKS = fileURLToPath(new URL('../harness/claude-code/hooks/', import.meta.url));

const question = (/** @type {Record<string, any>} */ more = {}) => ({
  title: 'Where does the attention report live?',
  question: 'Which milestone takes the attention report?',
  context: 'The report reads the ledger and the trust record; two milestones could take it.',
  options: [
    { label: 'Trust calibration', what_happens: 'it lands with the trust measures' },
    { label: 'Self-hosting', what_happens: 'it waits for the runner' },
  ],
  recommendation: { option: 'A', why: 'It reads what that milestone already builds.' },
  triggers: [{ basis: 'novelty', reason: 'no placement rule covers reports' }],
  item_kind: 'work',
  classification: 'public',
  ...more,
});

/** A project whose clock the test sets. */
function clocked() {
  const project = makeProject();
  let t = Date.parse('2026-11-14T10:00:00Z');
  const at = (/** @type {number} */ secondsLater) => {
    t = Date.parse('2026-11-14T10:00:00Z') + secondsLater * 1000;
  };
  return { deps: { ...project, now: () => new Date(t).toISOString() }, at };
}

const ledger = (/** @type {any} */ deps) =>
  readLedger(deps.store).events.filter((e) => e.decision !== undefined);

const settings = {
  attention: { ...attentionDefaults(), timezone: 'UTC', quiet_hours: [] },
  cap: 3,
};

test('a choice through the question tool is filed as an ask and an answer would file it', () => {
  const { deps, at } = clocked();
  at(90);
  const r = recordChoice(deps, question(), {
    answer: 'A',
    via: 'question-tool',
    shown_at: '2026-11-14T10:00:00Z',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.recorded, 'question-tool');
  assert.equal(r.option, 'A');
  assert.equal(r.took_recommendation, true);
  assert.equal(r.latency_ms, 90_000);

  // The tracker item: a decision, Done, the owner's, with the answer and how it arrived.
  const d = deps.tracker.get(r.decision);
  assert.equal(d.kind, 'decision');
  assert.equal(d.state, 'done');
  assert.equal(d.decider, 'owner');
  assert.equal(d.rights_basis, 'novelty');
  assert.equal(d.answer, 'A. Trust calibration: it lands with the trust measures');
  assert.equal(d.answered_via, 'question-tool');
  assert.equal(d.answered_by, 'owner');
  assert.deepEqual(d.options, question().options);
  assert.deepEqual(d.recommendation, question().recommendation);

  // The ask record, with the check code of what was shown.
  const record = JSON.parse(/** @type {string} */ (deps.store.read(askedKey(r.decision))));
  const q = question();
  assert.equal(
    record.check,
    checkCode({ question: q.question, context: q.context, options: q.options }),
  );
  assert.equal(r.check, record.check);
  assert.deepEqual(record.deciders, ['owner']);

  // The ledger: asked and sent when it was shown (sent at once, an interrupt), answered now.
  assert.deepEqual(
    ledger(deps).map((e) => [e.event, e.at, e.delivery ?? null]),
    [
      ['asked', '2026-11-14T10:00:00.000Z', null],
      ['sent', '2026-11-14T10:00:00.000Z', 'interrupt'],
      ['answered', '2026-11-14T10:01:30.000Z', null],
    ],
  );
  assert.deepEqual(readLedger(deps.store).problems, []);

  // The trust record: asked and answered, with the recommendation taken and the time taken.
  const trust = readTrustEvents(deps.store).filter((e) => e.subject === r.decision);
  assert.deepEqual(
    trust.map((e) => e.kind),
    ['asked', 'answered'],
  );
  assert.equal(trust[1].took_recommendation, true);
  assert.equal(trust[1].latency_ms, 90_000);
  const area = trustSummary(readTrustEvents(deps.store)).unassigned;
  assert.equal(area.asked, 1);
  assert.equal(area.answered, 1);
  assert.equal(area.stamp_known, 1, 'it counts toward the rubber-stamp indicator');

  // It counts in the attention budget and in the measures like any other question.
  const p = pendingDecisions(deps, settings);
  assert.equal(p.open, 0);
  assert.equal(p.budget.interrupts_per_day.used, 1);
  assert.equal(p.budget.last_answered_at, '2026-11-14T10:01:30.000Z');
  const latency = summarize(readLedger(deps.store).events).decision_latency_ms;
  assert.equal(latency.answered, 1);
  assert.equal(latency.owner.median, 90_000);
});

test("a choice in chat keeps the owner's own words, and the system's calls are the owner's once made", () => {
  const { deps } = clocked();
  // No rule holds for this one, so the system could have decided it; the owner did.
  const { triggers: _, ...system } = question({ title: 'Name the report' });
  const words = 'Neither: put it in its own milestone, Attention.';
  const r = recordChoice(deps, system, { answer: words, via: 'chat' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.route.basis, null);
  const d = deps.tracker.get(r.decision);
  assert.equal(d.decider, 'owner');
  assert.equal(d.rights_basis, undefined);
  assert.equal(d.answer, words);
  assert.equal(d.answered_via, 'chat');
  assert.equal(r.option, null);
  assert.equal(r.took_recommendation, null);

  const answered = readTrustEvents(deps.store).find((e) => e.kind === 'answered');
  assert.equal(answered?.took_recommendation, undefined, 'words name no option');
  assert.equal(answered?.latency_ms, undefined, 'without shown_at, no latency is claimed');
  assert.deepEqual(
    ledger(deps).map((e) => e.event),
    ['asked', 'sent', 'answered'],
  );

  // An option's label in chat is that option.
  const label = recordChoice(deps, question({ title: 'Again' }), {
    answer: 'Self-hosting, it can wait',
    via: 'chat',
  });
  assert.equal(label.option, 'B');
  assert.equal(label.took_recommendation, false);
});

test('a recorded choice that cannot be filed leaves no trace', () => {
  const { deps } = clocked();
  const q = question();
  const code = checkCode({ question: q.question, context: q.context, options: q.options });
  const refusals = [
    [{ answer: 'A', via: 'slack' }, 'usage'],
    [{ answer: 'A', via: 'chat', shown_at: 'yesterday' }, 'usage'],
    [{ answer: 'A', via: 'chat', shown_at: '2026-11-15T00:00:00Z' }, 'usage'],
    [{ answer: '   ', via: 'chat' }, 'answer-matches-no-option'],
    [{ answer: 'A', via: 'question-tool', code: '00000000' }, 'answer-question-changed'],
  ];
  for (const [input, error] of refusals) {
    const r = recordChoice(deps, q, /** @type {any} */ (input));
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.error, error, JSON.stringify(input));
  }
  const ambiguous = question({
    options: [
      { label: 'Merge then test', what_happens: 'the queue tests the merged tree' },
      { label: 'Test then merge', what_happens: 'each branch is tested first' },
    ],
  });
  assert.equal(
    recordChoice(deps, ambiguous, { answer: 'merge then test', via: 'chat' }).error,
    'answer-matches-no-option',
  );
  const { recommendation: __, ...incomplete } = question();
  assert.equal(
    recordChoice(deps, incomplete, { answer: 'A', via: 'chat' }).error,
    'incomplete-question',
  );
  const defaulted = question({
    reversibility: 'two-way',
    default_if_unanswered: { option: 'A', deadline: '2026-11-20T00:00:00Z' },
  });
  assert.equal(
    recordChoice(deps, defaulted, { answer: 'A', via: 'chat' }).error,
    'invalid-default',
  );
  assert.deepEqual(deps.tracker.query({}), []);
  assert.deepEqual(readLedger(deps.store).events, []);
  assert.deepEqual(readTrustEvents(deps.store), []);

  // The code of the question as shown is accepted, in any case and spacing.
  const ok = recordChoice(deps, q, {
    answer: 'A',
    via: 'question-tool',
    code: `${code.slice(0, 4).toUpperCase()}-${code.slice(4)}`,
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('rights record files a choice in the files tracker of the primary checkout', async () => {
  const c = makeConsumer({
    files: {
      'work/projects/W-7-reports.md': item(
        { id: 'W-7', title: 'Reports', kind: 'project', state: 'planned', owner: 'owner' },
        '\n## Summary\n\n',
      ),
    },
  });
  const filed = JSON.stringify(question({ parent: 'W-7' }));
  const r = await c.hitld([
    'rights',
    'record',
    '--question',
    filed,
    '--answer',
    'B',
    '--via',
    'question-tool',
    '--shown-at',
    new Date(Date.now() - 30_000).toISOString(),
  ]);
  assert.equal(r.exit, EXIT.ok, JSON.stringify(r.result));
  const shown = (await c.hitld(['work', 'show', r.result.decision, '--json'])).result.entity;
  assert.equal(shown.state, 'done');
  assert.equal(shown.parent, 'W-7');
  assert.equal(shown.answered_via, 'question-tool');
  assert.equal(shown.answer, 'B. Self-hosting: it waits for the runner');
  assert.match(shown.body, /## Question\n\nWhich milestone takes the attention report\?/);
  const check = await c.hitld(['work', 'check']);
  const mine = (check.result.problems ?? []).filter((/** @type {string} */ p) =>
    p.includes(r.result.decision),
  );
  assert.deepEqual(mine, []);

  // From a linked worktree, an executor's place, it is refused.
  const wt = join(c.base, 'wt');
  git(c.root, 'worktree', 'add', '-q', '-b', 'exec-branch', wt);
  const refused = await c.hitld(
    ['rights', 'record', '--question', filed, '--answer', 'A', '--via', 'chat'],
    { cwd: wt },
  );
  assert.equal(refused.result.error, 'not-permitted');
  assert.match(refused.result.message, /linked worktree/);
});

test("rights record is refused outside the owner's turn, and writes nothing", async () => {
  const project = makeProject();
  const record = makeCommands({ openTracker: () => project.tracker }).find(
    (x) => x.name === 'rights record',
  );
  const input = { question: JSON.stringify(question()), answer: 'A', via: 'question-tool' };
  for (const env of [
    { ...project.env, HITLD_ROLE: 'executor' },
    { ...project.env, HITLD_DISPATCH: 'D-6' },
  ]) {
    const r = /** @type {any} */ (await record?.run?.(input, { cwd: project.root, env }));
    assert.equal(r.error, 'not-permitted', JSON.stringify(env));
    assert.match(r.message, /rights record is the owner's/);
  }
  assert.deepEqual(project.tracker.query({}), []);
  assert.deepEqual(readLedger(project.store).events, []);

  // The plugin's guard stops an executor's agent at the harness; the owner's session passes.
  /** @param {Record<string, any>} hookInput */
  const guard = (hookInput) =>
    spawnSync(process.execPath, [join(HOOKS, 'guard.mjs')], {
      input: JSON.stringify(hookInput),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    }).stdout;
  for (const command of [
    'hitld rights record --question q.json --answer A --via chat',
    'node core/bin/hitld.mjs "rights" rec\\ord --answer A --via question-tool',
  ]) {
    const out = guard({
      agent_type: 'human-in-the-lead:executor-tier2',
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.match(out, /"deny"/, command);
    assert.match(out, /decisions are the owner's/, command);
  }
  assert.equal(
    guard({
      tool_name: 'Bash',
      tool_input: { command: 'hitld rights record --answer A --via chat' },
    }),
    '',
  );

  // The owner's own session runs it.
  const nowhere = tempDir('hitld-owner-');
  const owner = /** @type {any} */ (await record?.run?.(input, { cwd: nowhere, env: {} }));
  assert.notEqual(owner.error, 'not-permitted');
});

// HITLD-160: a question with no structured attributes, and the links a recorded choice carries.

/** A question with no areas, paths, tags, triggers or item kind: nothing a precedent could match. */
const bare = () => {
  const { triggers: _t, item_kind: _k, ...rest } = question({ title: 'Name the attention report' });
  return rest;
};

test('a question with no structured attributes is recorded, through the question tool and in chat', () => {
  for (const via of ['question-tool', 'chat']) {
    const { deps } = clocked();
    const r = recordChoice(deps, bare(), { answer: 'B', via });
    assert.equal(r.ok, true, `${via}: ${JSON.stringify(r)}`);
    assert.equal(r.recorded, via);
    const d = deps.tracker.get(r.decision);
    assert.equal(d.state, 'done', via);
    assert.equal(d.answered_via, via);
    assert.equal(d.answer, 'B. Self-hosting: it waits for the runner');
    assert.ok(deps.store.read(askedKey(r.decision)), `${via}: the ask record is written`);
    assert.deepEqual(
      ledger(deps).map((e) => e.event),
      ['asked', 'sent', 'answered'],
      via,
    );
    const trust = readTrustEvents(deps.store);
    assert.deepEqual(
      trust.map((e) => [e.kind, e.subject]),
      [
        ['asked', r.decision],
        ['answered', r.decision],
      ],
      via,
    );
    // No facts to keep, so the asked event carries none rather than an empty set the schema refuses.
    assert.equal(trust[0].facts, undefined, via);
    assert.equal(trust[0].area, 'unassigned', via);
  }
});

test('a trust event the schema refuses is refused before anything is written', () => {
  const registry = schemas();
  const real = registry.validateEntity;
  // Fault injection: every trust event is refused, as the empty facts once were.
  registry.validateEntity = function (/** @type {string} */ name, /** @type {any} */ value) {
    if (name === 'trust-event') return [{ path: '/facts', message: 'refused by the test' }];
    return real.call(this, name, value);
  };
  try {
    for (const via of ['question-tool', 'chat']) {
      const { deps } = clocked();
      const r = recordChoice(deps, question(), { answer: 'A', via });
      assert.equal(r.ok, false, via);
      assert.equal(r.error, 'invalid-trust-event', via);
      assert.match(r.message, /refused by the test/, via);
      assert.deepEqual(deps.tracker.query({}), [], `${via}: no decision item`);
      assert.equal(deps.store.read(askedKey('W-1')), null, `${via}: no ask record`);
      assert.deepEqual(readLedger(deps.store).events, [], `${via}: no ledger event`);
      assert.equal(deps.store.read('trust/events.jsonl'), null, `${via}: no trust event`);
    }
  } finally {
    registry.validateEntity = real;
  }
  assert.equal(
    invalidTrustEvent(
      { kind: 'asked', area: 'unassigned', subject: 'W-1', facts: {} },
      '2026-11-14T10:00:00Z',
    )?.includes('facts'),
    true,
  );
});

test('rights record writes the links it is given: opened_from on the decision, needs on what it blocks', async () => {
  const files = (/** @type {string[]} */ optional) => ({
    '.human-in-the-lead/tracker.json': JSON.stringify({
      schema_version: 1,
      optional_keys: optional,
    }),
    'work/projects/W-7-reports.md': item(
      { id: 'W-7', title: 'Reports', kind: 'project', state: 'planned', owner: 'owner' },
      '\n## Summary\n\n',
    ),
    'work/items/W-8-place-the-report.md': item(
      { id: 'W-8', title: 'Place the report', kind: 'work', state: 'planned', project: 'W-7' },
      '\n## Why\n\nIt needs a milestone.\n',
    ),
  });
  const linked = JSON.stringify({
    ...bare(),
    parent: 'W-7',
    opened_from: ['W-8'],
    blocks: ['W-8'],
  });
  const record = ['rights', 'record', '--question', linked, '--answer', 'A', '--via', 'chat'];

  const on = makeConsumer({ files: files(['opened_from']) });
  const r = await on.hitld(record);
  assert.equal(r.exit, EXIT.ok, JSON.stringify(r.result));
  const decision = (await on.hitld(['work', 'show', r.result.decision, '--json'])).result.entity;
  assert.deepEqual(decision.opened_from, ['W-8']);
  const blocked = (await on.hitld(['work', 'show', 'W-8', '--json'])).result.entity;
  assert.deepEqual(blocked.needs, [r.result.decision]);
  const mine = ((await on.hitld(['work', 'check'])).result.problems ?? []).filter(
    (/** @type {string} */ p) => p.includes(r.result.decision) || p.includes('W-8'),
  );
  assert.deepEqual(mine, []);

  // A tracker whose files cannot hold opened_from refuses it, before anything is written, and says
  // what to turn on; it is never dropped.
  const off = makeConsumer({ files: files([]) });
  const before = git(off.root, 'status', '--porcelain');
  const refused = await off.hitld(record);
  assert.equal(refused.result.error, 'not-created', JSON.stringify(refused.result));
  assert.match(refused.result.message, /turn on opened_from in tracker\.json optional_keys/);
  assert.equal(git(off.root, 'status', '--porcelain'), before, 'no file is written');
  const stillOpen = (await off.hitld(['work', 'show', 'W-8', '--json'])).result.entity;
  assert.equal(stillOpen.needs, undefined);
  const events = (await off.hitld(['ledger', 'show', '--json'])).result;
  assert.equal(JSON.stringify(events).includes('"asked"'), false);
});
