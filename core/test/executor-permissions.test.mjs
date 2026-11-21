// HITLD-141: dispatch does not launch tier-3 executors into a permission mode that refuses the
// contract's commands. The plan's mode choice and hold, structured permission denials against a
// report that only mentions a refusal, refusals that count for the harness for the rest of the run,
// and the CLI from a refused headless run to interactive dispatches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { mentionedRefusals, refusalsInRun, refusedCommands } from '../lib/dispatch/permissions.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { headlessCompletion } from '../harness/claude-code/completion.mjs';
import { FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer } from './orchestrator-fixture.mjs';

const { policy } = resolvePolicy({ schema_version: 1, project: { id: 'test', key: 'W' } });
if (!policy) throw new Error('policy');

/** @param {string} id @param {number} tier */
const ready = (id, tier) => ({
  id,
  kind: 'work',
  state: 'planned',
  classification: 'public',
  touches: [`src/${id}.js`],
  tier_override: tier,
  body: '\n## Done when\n\n`npm test` passes.\n',
});
const always = () => ({ mode: 'normal', allow: true, reason: 'ok' });

/**
 * @param {ReturnType<typeof ready>[]} items
 * @param {(i: any) => import('../lib/dispatch/plan.mjs').ModeAbility} executorModes
 * @param {import('../harness/interface.mjs').HarnessCapabilities} [capabilities]
 */
const planWith = (items, executorModes, capabilities = FAKE_PROFILES.full) =>
  planDispatch({
    queue: items,
    sizes: new Map(items.map((i) => [i.id, sizeItem(i, policy)])),
    running: [],
    cap: 5,
    capabilities,
    gate: always,
    executorModes,
  });

const unable = (/** @type {string} */ why) => ({ able: false, why });

test('plan: a tier-3 item runs interactive when headless cannot run the contract, and says so', () => {
  const r = planWith([ready('W-1', 3)], () => ({ headless: unable('D-3 was refused git') }));
  assert.equal(r.start.length, 1);
  const s = r.start[0];
  assert.equal(s.mode, 'interactive');
  assert.deepEqual(s.modes, { headless: 'unable', interactive: 'unknown' });
  assert.match(s.notes.join(' '), /headless runs here cannot run the contract's commands/);
  assert.match(s.notes.join(' '), /D-3 was refused git/);

  // The other way round: interactive sessions refused, headless not known to be.
  const other = planWith([ready('W-1', 3)], () => ({ interactive: unable('refused') }));
  assert.equal(other.start[0].mode, 'headless');

  // Nothing known: the plan chooses no mode, and says neither is known.
  const unknown = planWith([ready('W-1', 3)], () => ({}));
  assert.equal(unknown.start[0].mode, undefined);
  assert.deepEqual(unknown.start[0].modes, { headless: 'unknown', interactive: 'unknown' });
  const able = planWith([ready('W-1', 3)], () => ({ headless: { able: true, why: 'checked' } }));
  assert.deepEqual(able.start[0].modes, { headless: 'able', interactive: 'unknown' });
});

test('plan: when neither mode can, the item is held with executor-permissions and nothing starts', () => {
  const r = planWith([ready('W-1', 3), ready('W-2', 2)], (i) =>
    i.id === 'W-1' ? { headless: unable('a'), interactive: unable('b') } : {},
  );
  assert.deepEqual(
    r.start.map((s) => s.item),
    ['W-2'],
  );
  assert.deepEqual(r.held, [
    {
      item: 'W-1',
      reason: 'executor-permissions',
      why: 'neither tier-3 mode can run hitld, node, npm, git: a; b',
    },
  ]);
  // A tier-3 item on a harness without separate sessions runs as a subagent: that is what counts.
  const degraded = planWith(
    [ready('W-1', 3)],
    () => ({ headless: unable('a'), interactive: unable('b') }),
    { ...FAKE_PROFILES.full, persistent_sessions: false },
  );
  assert.equal(degraded.start[0].tier, 2);
  const subagent = planWith([ready('W-1', 2)], () => ({ subagent: unable('c') }));
  assert.deepEqual(
    subagent.held.map((h) => [h.item, h.reason]),
    [['W-1', 'executor-permissions']],
  );
});

test('a permissions block: only structured permission_denials; report text is a warning', () => {
  const denials = [
    {
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: { command: 'HITLD_DISPATCH=D-1 hitld work claim W-1' },
    },
    { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: '/usr/bin/git status' } },
    { tool_name: 'Bash', tool_use_id: 't3', tool_input: { command: 'ls -la' } },
    { tool_name: 'Edit', tool_use_id: 't4', tool_input: { file_path: 'node' } },
  ];
  assert.deepEqual(refusedCommands(denials), ['hitld', 'git']);
  assert.deepEqual(refusedCommands(undefined), []);
  const text = [
    'I could not do the work.',
    'Running `npm ci` was denied by the permission mode.',
    'node: permission to run this command was refused',
    'The tracker file lives in work/items.',
  ].join('\n');
  assert.deepEqual(mentionedRefusals({ report: text }), ['node', 'npm']);
  assert.deepEqual(
    mentionedRefusals({ report: 'All done; git push was refused, as expected.', done: true }),
    [],
  );
  assert.deepEqual(mentionedRefusals({ report: 'git log shows the change; tests pass.' }), []);

  const parsed = headlessCompletion(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'blocked',
      permission_denials: denials,
    }),
  );
  assert.equal(parsed.permissionDenials?.length, 4);
});

test('a refusal counts for the harness for the rest of the run; a new run starts clean', () => {
  const blocked = (/** @type {string} */ dispatch, /** @type {string} */ run) => ({
    event: 'reported',
    dispatch,
    item: 'W-1',
    result: 'blocked',
    reason: 'executor-permissions',
    notes: 'refused git',
    run,
  });
  const events = [
    { event: 'dispatched', dispatch: 'D-1', item: 'W-1', tier: 3, mode: 'headless', run: 'R1' },
    blocked('D-1', 'R1'),
    { event: 'dispatched', dispatch: 'D-2', item: 'W-1', tier: 3, mode: 'interactive', run: 'R1' },
    blocked('D-2', 'R1'),
    { event: 'dispatched', dispatch: 'D-3', item: 'W-1', tier: 2, run: 'R0' },
    blocked('D-3', 'R0'),
  ];
  const r1 = refusalsInRun(events, 'R1');
  assert.deepEqual(Object.keys(r1).sort(), ['headless', 'interactive']);
  assert.equal(r1.headless, 'D-1 (W-1) ran headless and its permission mode refused git');
  assert.match(String(refusalsInRun(events, 'R0').subagent), /as a subagent/);

  /** @param {Record<string, string>} refusals */
  const asModes = (refusals) =>
    Object.fromEntries(Object.entries(refusals).map(([m, why]) => [m, unable(why)]));
  // W-2 was never dispatched: W-1's refusals on this harness hold it, without a second refusal.
  const held = planWith([ready('W-2', 3)], () => asModes(r1));
  assert.deepEqual(
    held.held.map((h) => [h.item, h.reason]),
    [['W-2', 'executor-permissions']],
  );
  assert.equal(held.start.length, 0);
  // A new run has no refusals: W-2 starts, its modes unknown.
  const fresh = planWith([ready('W-2', 3)], () => asModes(refusalsInRun(events, 'R2')));
  assert.deepEqual(fresh.start[0].modes, { headless: 'unknown', interactive: 'unknown' });
});

test('cli: a refused headless run holds headless for every item; a quoted refusal only warns', async () => {
  const tier3 = (/** @type {string} */ id, /** @type {string} */ slug) =>
    item({
      id,
      title: slug,
      kind: 'work',
      state: 'planned',
      tier_override: '3',
      touches: [`src/${slug}.js`],
    });
  // Four slots, so W-7 is in the plan's start list: one completion of 15 tokens no longer makes
  // tier 3 the cheapest work and puts it first (HITLD-436).
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 4 } } },
    files: {
      'work/items/W-4-redesign.md': tier3('W-4', 'redesign'),
      'work/items/W-7-rework.md': tier3('W-7', 'rework'),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.equal(start.result.instruction.tool, 'Bash', 'headless by default');
  const d1 = start.result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d1, '--harness-ref', 'bash-1']);
  const resultFile = start.result.on_complete.split('--result-file ')[1];
  // What the first self-hosted run's executors left: no report in the fixed shape, every
  // contract command refused.
  writeFileSync(
    resultFile,
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'sess-1',
      result: 'I could not claim the item: the permission mode refused every command I tried.',
      permission_denials: [
        'hitld work claim W-4',
        'node core/bin/hitld.mjs',
        'npm ci',
        'git status',
      ].map((command, n) => ({ tool_name: 'Bash', tool_use_id: `t${n}`, tool_input: { command } })),
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  );
  const done = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    d1,
    '--result-file',
    resultFile,
  ]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.result, 'blocked');
  assert.equal(done.result.blocked_by, 'executor-permissions');
  assert.deepEqual(done.result.refused_commands, ['hitld', 'node', 'npm', 'git']);
  assert.equal(done.result.report_errors, undefined, 'never a missing report shape');
  assert.doesNotMatch(done.result.next, /fixed shape/);
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const events = () => readLedger(store).events;
  const reported = events().find((e) => e.event === 'reported' && e.dispatch === d1);
  assert.equal(reported?.result, 'blocked');
  assert.equal(reported?.reason, 'executor-permissions');
  assert.equal(reported?.notes, 'refused hitld, node, npm, git');

  // W-7 was never dispatched: it is not launched headless either, and the plan says so.
  const plan = await c.hitld(['dispatch', 'plan']);
  for (const id of ['W-4', 'W-7']) {
    const entry = plan.result.start.find((/** @type {any} */ s) => s.item === id);
    assert.equal(entry?.mode, 'interactive', `${id}: ${JSON.stringify(plan.result)}`);
    assert.equal(entry.modes.headless, 'unable');
    assert.match(entry.notes.join(' '), /headless runs here cannot run the contract's commands/);
  }
  const forced = await c.hitld(['dispatch', 'start', 'W-7', '--mode', 'headless']);
  assert.notEqual(forced.exit, 0);
  assert.equal(forced.result.error, 'executor-permissions', JSON.stringify(forced.result));

  const again = await c.hitld(['dispatch', 'start', 'W-7']);
  assert.equal(again.exit, 0, JSON.stringify(again.result));
  assert.equal(again.result.instruction.tool, 'session');
  await c.hitld([
    'dispatch',
    'handle',
    '--dispatch',
    again.result.dispatch,
    '--harness-ref',
    'session-2',
  ]);
  // A report that merely quotes a refusal: a warning for the orchestrator, never a hold.
  const reportFile = join(c.base, 'report.txt');
  writeFileSync(
    reportFile,
    [
      'item: W-7',
      'result: partial',
      'commit: none',
      'evidence:',
      '  - the earlier run logged "git: permission denied"; this session ran git and node fine',
      'bench_runs: none',
      'deviations: none',
      'calls: none',
      'questions: none',
      '',
    ].join('\n'),
  );
  const second = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    again.result.dispatch,
    '--report-file',
    reportFile,
  ]);
  assert.equal(second.exit, 0, JSON.stringify(second.result));
  assert.equal(second.result.blocked_by, undefined);
  assert.equal(second.result.result, 'partial');
  assert.deepEqual(second.result.permission_warning?.commands, ['node', 'git']);
  const quoted = events().find(
    (e) => e.event === 'reported' && e.dispatch === again.result.dispatch,
  );
  assert.equal(quoted?.reason, undefined);
  assert.equal(quoted?.result, 'partial');
  // Interactive is still able as far as the plan knows: W-7 is not held.
  assert.ok(!second.result.refill.held.some((/** @type {any} */ h) => h.item === 'W-7'));
});
