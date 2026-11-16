// HITLD-141: dispatch does not launch tier-3 executors into a permission mode that refuses the
// contract's commands. The plan's mode choice and hold, the refused-commands report, and the CLI
// from a refused headless run to an interactive dispatch to a hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { refusalsInRun, refusedCommands } from '../lib/dispatch/permissions.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { headlessCompletion } from '../harness/claude-code/completion.mjs';
import { FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer } from './orchestrator-fixture.mjs';

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

test('a refused-commands report: from permission_denials, from the text, never from a done report', () => {
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
  assert.deepEqual(refusedCommands({ report: 'I could not start.', denials }), ['hitld', 'git']);
  const text = [
    'I could not do the work.',
    'Running `npm ci` was denied by the permission mode.',
    'node: permission to run this command was refused',
    'The tracker file lives in work/items.',
  ].join('\n');
  assert.deepEqual(refusedCommands({ report: text }), ['node', 'npm']);
  assert.deepEqual(
    refusedCommands({ report: 'All done; git push was refused, as expected.', done: true }),
    [],
  );
  assert.deepEqual(refusedCommands({ report: 'git log shows the change; tests pass.' }), []);

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

test('refusals count per item and mode, in this run only', () => {
  const events = [
    { event: 'dispatched', dispatch: 'D-1', item: 'W-1', tier: 3, mode: 'headless', run: 'R1' },
    {
      event: 'reported',
      dispatch: 'D-1',
      item: 'W-1',
      result: 'blocked',
      reason: 'executor-permissions',
      notes: 'refused git',
      run: 'R1',
    },
    { event: 'dispatched', dispatch: 'D-2', item: 'W-2', tier: 2, run: 'R0' },
    {
      event: 'reported',
      dispatch: 'D-2',
      item: 'W-2',
      result: 'blocked',
      reason: 'executor-permissions',
      notes: 'refused node',
      run: 'R0',
    },
  ];
  const r = refusalsInRun(events, 'R1');
  assert.deepEqual([...r.keys()], ['W-1']);
  assert.equal(r.get('W-1')?.headless, 'D-1 ran headless and its permission mode refused git');
  assert.equal(refusalsInRun(events, 'R0').get('W-2')?.headless, undefined);
  assert.match(String(refusalsInRun(events, 'R0').get('W-2')?.subagent), /as a subagent/);
});

test('cli: a refused headless run is blocked by permissions; the item runs interactive, then is held', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/redesign.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.equal(start.result.instruction.tool, 'Bash', 'headless by default');
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'bash-1']);
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
    'D-1',
    '--result-file',
    resultFile,
  ]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.result, 'blocked');
  assert.equal(done.result.blocked_by, 'executor-permissions');
  assert.deepEqual(done.result.refused_commands, ['hitld', 'node', 'npm', 'git']);
  assert.equal(done.result.report_errors, undefined, 'never a missing report shape');
  assert.doesNotMatch(done.result.next, /fixed shape/);
  const ledger = join(c.data, 'human-in-the-lead/orch-fixture/ledger.jsonl');
  const store = /** @type {any} */ ({
    read: (/** @type {string} */ k) => (k === 'ledger.jsonl' ? readFileSync(ledger, 'utf8') : null),
  });
  const reported = readLedger(store).events.find(
    (e) => e.event === 'reported' && e.dispatch === 'D-1',
  );
  assert.equal(reported?.result, 'blocked');
  assert.equal(reported?.reason, 'executor-permissions');
  assert.equal(reported?.notes, 'refused hitld, node, npm, git');

  // The refill does not dispatch it headless again: it runs interactive, and says so.
  const refill = done.result.refill.start.find((/** @type {any} */ s) => s.item === 'W-4');
  assert.equal(refill?.mode, 'interactive', JSON.stringify(done.result.refill));
  assert.equal(refill.modes.headless, 'unable');
  assert.match(refill.notes.join(' '), /headless runs here cannot run the contract's commands/);

  const forced = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'headless']);
  assert.notEqual(forced.exit, 0);
  assert.equal(forced.result.error, 'executor-permissions', JSON.stringify(forced.result));

  // The refused run committed nothing. A tier-3 dispatch cannot yet reuse an earlier dispatch's
  // branch (outside HITLD-141), so this test removes it first.
  await c.hitld(['env', 'cleanup', '--dispatch', 'D-1', '--result', 'abandoned']);
  git(c.root, 'branch', '-D', start.result.branch);
  const again = await c.hitld(['dispatch', 'start', 'W-4']);
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
  const reportFile = join(c.base, 'report.txt');
  writeFileSync(
    reportFile,
    'Blocked: git and hitld were denied by the permission mode of this session.\n',
  );
  const second = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    again.result.dispatch,
    '--report-file',
    reportFile,
  ]);
  assert.equal(second.result.blocked_by, 'executor-permissions');
  assert.deepEqual(second.result.refused_commands, ['hitld', 'git']);
  // Neither mode can: held, with the reason, and nothing is launched.
  assert.ok(!second.result.refill.start.some((/** @type {any} */ s) => s.item === 'W-4'));
  const held = second.result.refill.held.find((/** @type {any} */ h) => h.item === 'W-4');
  assert.equal(held?.reason, 'executor-permissions', JSON.stringify(second.result.refill));
  const blocked = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.notEqual(blocked.exit, 0);
  assert.match(JSON.stringify(blocked.result), /neither tier-3 mode can run/);
});
