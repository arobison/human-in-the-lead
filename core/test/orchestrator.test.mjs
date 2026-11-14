import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { renderBrief } from '../lib/dispatch/brief.mjs';
import { runDispatchLoop } from '../lib/dispatch/loop.mjs';
import { startRun } from '../lib/run/run.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { createFakeAdapter, FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { checkHarnessAdapter } from '../harness/interface.mjs';
import { ContractCall, createClaudeCodeAdapter } from '../harness/claude-code/adapter.mjs';
import { instructionFor } from '../harness/claude-code/instructions.mjs';
import { headlessCompletion, subagentCompletion } from '../harness/claude-code/completion.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { staleFiles } from '../lib/packaging/build.mjs';
import { memoryStore } from './helpers/memory-store.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const policy = (/** @type {Record<string, unknown>} */ extra = {}) => {
  const { policy: p, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'test', key: 'W' },
    ...extra,
  });
  if (!p) throw new Error(JSON.stringify(errors));
  return p;
};

const BODY1 = '\n## Done when\n\n`npm test` passes.\n\n## Plan\n\nChange `src/a.js`.\n';
const BODY2 =
  '\n## Done when\n\nThe cache is faster.\n\n## Plan\n\nSee [the design](docs/d.md#3).\n';

// --- Sizing --------------------------------------------------------------------------------

test('sizing: tier 1 for mechanical work, 2 inside a plan, 3 without one, 0 for tracker edits', () => {
  const p = policy();
  const base = { kind: 'work', state: 'Planned', classification: 'public' };
  assert.equal(sizeItem({ ...base, id: 'W-1', touches: ['src/a.js'], body: BODY1 }, p).tier, 1);
  assert.equal(sizeItem({ ...base, id: 'W-2', touches: ['src/**'], body: BODY2 }, p).tier, 2);
  assert.equal(
    sizeItem({ ...base, id: 'W-3', touches: ['src/a.js'], body: '\nNo plan.\n' }, p).tier,
    3,
  );
  assert.equal(
    sizeItem({ ...base, id: 'W-4', touches: ['work/items/W-9.md'], body: BODY1 }, p).tier,
    0,
  );
  const hinted = sizeItem(
    { ...base, id: 'W-5', tier_hint: 3, touches: ['src/a.js'], body: BODY1 },
    p,
  );
  assert.equal(hinted.tier, 3);
  assert.match(hinted.reasons[0], /tier_hint/);
});

test('sizing: up one for blast radius, down one for familiar ground, estimates from history', () => {
  const p = policy({
    rights: {
      areas: [
        { name: 'ui', paths: ['src/ui/**'] },
        { name: 'core', paths: ['src/core/**'] },
      ],
    },
  });
  const base = { kind: 'work', state: 'Planned', classification: 'public', body: BODY1 };
  const sensitive = sizeItem({ ...base, id: 'W-1', touches: ['package.json'] }, p);
  assert.equal(sensitive.tier, 2);
  assert.match(sensitive.reasons.join(' '), /sensitive path/);
  const cross = sizeItem({ ...base, id: 'W-2', touches: ['src/ui/a.js', 'src/core/b.js'] }, p);
  assert.equal(cross.tier, 2);
  assert.match(cross.reasons.join(' '), /spans areas core, ui/);

  const history = Array.from({ length: 6 }, () => ({
    area: 'ui',
    kind: 'work',
    tier: 1,
    tokens: 40000,
    firstPass: true,
  }));
  const familiar = sizeItem(
    { ...base, id: 'W-3', touches: ['src/ui/**'], body: BODY2 },
    p,
    history,
  );
  assert.equal(familiar.tier, 1);
  assert.match(familiar.reasons.join(' '), /familiar ground/);
  assert.equal(familiar.estimate_tokens, 40000);
  assert.equal(familiar.estimate_source, 'history');
  const fresh = sizeItem({ ...base, id: 'W-4', touches: ['src/core/a.js', 'src/core/b.js'] }, p);
  assert.equal(fresh.estimate_source, 'default');
  assert.equal(fresh.estimate_tokens, 75000);
});

// --- The plan ------------------------------------------------------------------------------

/** @param {string} id @param {Record<string, unknown>} [extra] */
const ready = (id, extra = {}) => ({
  id,
  kind: 'work',
  state: 'Planned',
  classification: 'public',
  touches: [`src/${id}.js`],
  body: BODY1,
  ...extra,
});
const always = () => ({ mode: 'normal', allow: true, reason: 'ok' });

test('plan: the cap, serial resources, overlap, the gate and a degraded harness', () => {
  const p = policy();
  const items = [
    ready('W-1', { serial: ['gpu'] }),
    ready('W-2', { serial: ['gpu'] }),
    ready('W-3'),
    ready('W-4', { touches: ['src/run.js'] }),
    ready('W-5'),
  ];
  const sizes = new Map(items.map((i) => [i.id, sizeItem(i, p)]));
  const r = planDispatch({
    queue: items,
    sizes,
    running: [{ dispatch: 'D-9', item: 'W-9', serial_resources: [], touches: ['src/run.js'] }],
    cap: 3,
    capabilities: FAKE_PROFILES.full,
    gate: always,
  });
  assert.deepEqual(
    r.start.map((s) => s.item),
    ['W-1', 'W-3'],
  );
  assert.deepEqual(
    r.held.map((h) => [h.item, h.reason]),
    [
      ['W-2', 'serial'],
      ['W-4', 'overlap'],
    ],
  );
  assert.equal(r.waiting, 1);

  const minimal = planDispatch({
    queue: items.slice(2),
    sizes,
    running: [],
    cap: 3,
    capabilities: FAKE_PROFILES.minimal,
    gate: always,
  });
  assert.equal(minimal.cap, 1);
  assert.equal(minimal.start.length, 1);

  const stopped = planDispatch({
    queue: items,
    sizes,
    running: [],
    cap: 3,
    capabilities: FAKE_PROFILES.full,
    gate: () => ({ mode: 'stop', allow: false, reason: 'at the reserve', notify_owner: true }),
  });
  assert.equal(stopped.start.length, 0);
  assert.equal(stopped.gate.notify_owner, true);
  assert.ok(stopped.held.every((h) => h.reason === 'quota'));
});

test('the brief points rather than restates', () => {
  const p = policy({ dispatch: { brief_kb: { cache: ['kb/areas/cache.md'] } } });
  const it = {
    ...ready('W-7'),
    area: 'cache',
    path: 'work/items/W-7-x.md',
    body: BODY2 + '\nA long secret paragraph of item text.\n',
  };
  const brief = renderBrief({
    item: it,
    sizing: sizeItem(it, p),
    dispatch: 'D-4',
    branch: 'hitld/W-7-x',
    policy: p,
    isolation: 'worktree',
  });
  assert.match(brief, /Read work\/items\/W-7-x.md and the plan it points to \(docs\/d.md#3\)/);
  assert.match(brief, /kb\/areas\/cache.md/);
  assert.match(brief, /HITLD_DISPATCH=D-4 HITLD_PROJECT=test HITLD_ROLE=executor/);
  assert.doesNotMatch(brief, /secret paragraph/);
});

// --- The dispatch cycle --------------------------------------------------------------------

const DONE = (/** @type {string} */ id) =>
  report({ item: id, sha: 'abc1234', branch: `hitld/${id}` });

for (const profile of /** @type {const} */ (['full', 'minimal'])) {
  test(`the dispatch cycle refills on completion, never past the cap (${profile})`, async () => {
    const store = memoryStore();
    const run = startRun(store, { session: 's', host: 'h' });
    const adapter = createFakeAdapter({
      capabilities: FAKE_PROFILES[profile],
      respond: (req) => ({
        report: DONE(req.item),
        usage: { tokens: 1000, toolCalls: 3, durationMs: 50 },
      }),
    });
    const items = [
      ready('W-1'),
      ready('W-2'),
      ready('W-3'),
      ready('W-4', { needs: ['W-1'] }),
      ready('W-5'),
    ];
    const r = await runDispatchLoop({ run, adapter, policy: policy(), items, cap: 2 });
    assert.deepEqual(r.remaining, []);
    assert.equal(r.dispatches, 5);
    assert.ok(r.maxRunning <= (profile === 'full' ? 2 : 1));
    const onComplete = adapter.calls.filter((c) => c.method === 'onComplete').length;
    assert.equal(onComplete, 5, 'one wait per dispatch: no polling');
    // W-4 waits for W-1.
    const order = r.trace.filter((t) => t.step === 'dispatch').map((t) => t.item);
    assert.ok(order.indexOf('W-4') > order.indexOf('W-1'));
    const events = readLedger(store).events;
    assert.equal(events.filter((e) => e.event === 'reported').length, 5);
    assert.equal(run.state.in_flight.length, 0);
  });
}

// --- The Claude Code adapter ---------------------------------------------------------------

test('the Claude Code adapter: a valid adapter whose calls are instructions for the main session', async () => {
  const bare = createClaudeCodeAdapter();
  assert.deepEqual(checkHarnessAdapter(bare), []);
  const request = /** @type {import('../harness/interface.mjs').DispatchRequest} */ ({
    dispatch: 'D-3',
    item: 'W-1',
    brief: 'You are implementing W-1',
    tier: 1,
    role: 'executor',
    model: 'small',
    effort: 'medium',
    isolation: 'worktree',
    classification: 'internal',
  });
  await assert.rejects(
    bare.dispatch(request),
    (e) => e instanceof ContractCall && e.instruction.tool === 'Agent',
  );
  await assert.rejects(bare.dispatch({ ...request, classification: 'secret' }), /secret/);

  const call = instructionFor(request);
  assert.equal(call.tool, 'Agent');
  assert.deepEqual(call.input, {
    subagent_type: 'human-in-the-lead:executor-tier1',
    description: 'D-3 W-1',
    name: 'D-3',
    prompt: 'You are implementing W-1',
    model: 'sonnet',
    effort: 'medium',
    isolation: 'worktree',
    run_in_background: true,
  });
  const headless = instructionFor(
    { ...request, tier: 3, model: 'large', effort: 'high' },
    {
      worktree: '/w/D 3',
      briefPath: '/s/b.md',
      resultPath: '/s/r.json',
      env: { HITLD_PROJECT: 'p', HITLD_ROLE: 'executor' },
    },
  );
  assert.equal(headless.tool, 'Bash');
  assert.match(
    String(headless.input.command),
    /^cd '\/w\/D 3' && HITLD_DISPATCH=D-3 HITLD_PROJECT=p HITLD_ROLE=executor claude -p --output-format json --model opus --effort high --permission-mode acceptEdits < \/s\/b.md > \/s\/r.json$/,
  );

  /** @type {string[]} */
  const said = [];
  const driven = createClaudeCodeAdapter({
    driver: { start: async () => 'agent-77', say: async (t) => (said.push(t), 'm1') },
  });
  const handle = await driven.dispatch(request);
  assert.deepEqual(handle, { dispatch: 'D-3', harness: 'claude-code', ref: 'agent-77' });
  const waiting = driven.onComplete(handle);
  driven.deliver('D-3', {
    kind: 'subagent',
    text: `${DONE('W-1')}\n<usage>total_tokens: 1234\ntool_uses: 9\nduration_ms: 5000</usage>`,
  });
  const c = await waiting;
  assert.deepEqual(c.usage, { tokens: 1234, toolCalls: 9, durationMs: 5000 });
  assert.match(c.report, /^item: W-1/);
  await driven.notify({ text: 'later', classification: 'internal' }, 'digest');
  await driven.ask({ decision: 'W-9', text: 'Which?', classification: 'internal' });
  assert.deepEqual(said, ['Which?']);
  assert.equal(driven.held().length, 1);
});

test('completions: the headless JSON result and the subagent notification', () => {
  const h = headlessCompletion(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'item: W-1',
      session_id: 'abc',
      total_cost_usd: 0.5,
      duration_ms: 900,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 70 },
    }),
  );
  assert.deepEqual(h.usage, { tokens: 100, toolCalls: null, durationMs: 900 });
  assert.equal(h.sessionId, 'abc');
  assert.equal(h.usageSource, 'documented');
  const s = subagentCompletion({ text: 'item: W-1' });
  assert.equal(s.usage, null);
  assert.equal(s.usageSource, 'none');
});

// --- The plugin ----------------------------------------------------------------------------

test('the plugin is built from the current sources', () => {
  assert.deepEqual(staleFiles(), []);
});

const HOOKS = fileURLToPath(new URL('../harness/claude-code/hooks/', import.meta.url));
/** @param {string} script @param {unknown} input @param {NodeJS.ProcessEnv} [env] */
const hook = (script, input, env = {}) =>
  spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });

test('hooks: the report check blocks an executor without a report, once; the guard stops a push', () => {
  const bad = hook('report-check.mjs', {
    agent_type: 'human-in-the-lead:executor-tier1',
    last_assistant_message: 'All done!',
  });
  assert.equal(JSON.parse(bad.stdout).decision, 'block');
  assert.match(JSON.parse(bad.stdout).reason, /item is missing/);
  const again = hook('report-check.mjs', {
    agent_type: 'human-in-the-lead:executor-tier1',
    last_assistant_message: 'x',
    stop_hook_active: true,
  });
  assert.equal(again.stdout, '');
  const good = hook('report-check.mjs', {
    agent_type: 'human-in-the-lead:executor-tier2',
    last_assistant_message: DONE('W-1'),
  });
  assert.equal(good.stdout, '');
  const owner = hook('report-check.mjs', { last_assistant_message: 'hello' });
  assert.equal(owner.stdout, '');
  const headless = hook(
    'report-check.mjs',
    { last_assistant_message: 'hello' },
    { HITLD_DISPATCH: 'D-4' },
  );
  assert.equal(JSON.parse(headless.stdout).decision, 'block');

  const push = hook('guard.mjs', {
    agent_type: 'human-in-the-lead:executor-tier1',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin HEAD' },
  });
  assert.equal(JSON.parse(push.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const merge = hook('guard.mjs', {
    agent_type: 'human-in-the-lead:executor-tier2',
    tool_name: 'Bash',
    tool_input: { command: 'HITLD_DISPATCH=D-1 hitld merge' },
  });
  assert.equal(JSON.parse(merge.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const answer = hook('guard.mjs', {
    agent_type: 'human-in-the-lead:executor-tier1',
    tool_name: 'Bash',
    tool_input: { command: 'hitld rights answer --decision W-9 --answer A' },
  });
  assert.equal(JSON.parse(answer.stdout).hookSpecificOutput.permissionDecision, 'deny');
  /** @param {string} command */
  const asExecutor = (command) =>
    hook('guard.mjs', {
      agent_type: 'human-in-the-lead:executor-tier2',
      tool_name: 'Bash',
      tool_input: { command },
    }).stdout;
  for (const evasive of [
    '"hitld" rights answer --decision W-9 --answer A',
    "node core/bin/hitld.mjs ri'ght's  an\\swer --decision W-9",
    'H=hitld; $H rights answer --decision W-9',
    'hitld work new --kind work',
    'hitld precedent add',
  ]) {
    assert.match(asExecutor(evasive), /"deny"/, evasive);
  }
  for (const accept of [
    'hitld eval accept --run EV-20261114T031500Z-abcdef',
    'node core/bin/hitld.mjs "eval" ac\\cept --run EV-20261114T031500Z-abcdef',
    'H=hitld; $H eval accept --run EV-20261114T031500Z-abcdef',
    'hitld eval --offline --accept-baseline',
  ]) {
    const out = asExecutor(accept);
    assert.match(out, /"deny"/, accept);
    assert.match(out, /owner's decision/, accept);
  }
  for (const allowed of [
    'hitld work claim W-3 --claimant D-2 --branch b',
    'hitld work close W-3',
    'hitld env setup --holder D-2 --adopt "$PWD"',
    'hitld env port lease --holder D-2',
    'npm test && hitld check contract',
  ]) {
    assert.equal(asExecutor(allowed), '', allowed);
  }
  assert.equal(
    hook('guard.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'hitld eval accept --run EV-20261114T031500Z-abcdef' },
    }).stdout,
    '',
  );
  const ownerAnswer = hook('guard.mjs', {
    tool_name: 'Bash',
    tool_input: { command: 'hitld rights answer --decision W-9 --answer A' },
  });
  assert.equal(ownerAnswer.stdout, '');
  const ownerPush = hook('guard.mjs', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.equal(ownerPush.stdout, '');
});

// --- End to end through the command line ---------------------------------------------------

test('install leaves the status line off by default and accepts --no-statusline', async () => {
  const c = makeConsumer();
  const fresh = join(c.base, 'fresh-off');
  put(fresh, { 'README.md': '# fresh\n' });
  git(fresh, 'init', '-q', '-b', 'main');
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  const r = await c.hitld(['install', '--key', 'FR', '--marketplace', checkout], { cwd: fresh });
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.done.statusline, 'skipped');
  assert.equal(existsSync(join(fresh, '.claude/settings.local.json')), false);
  const flag = await c.hitld(['install', '--no-statusline'], { cwd: fresh });
  assert.equal(flag.exit, 0, JSON.stringify(flag.result));
  assert.equal(flag.result.done.statusline, 'skipped');
});

test('install --statusline sets up a consumer: policy, contract, settings, status line; both checks pass', async () => {
  const c = makeConsumer();
  const fresh = join(c.base, 'fresh');
  put(fresh, { 'README.md': '# fresh\n', 'CLAUDE.md': '# Notes\n' });
  git(fresh, 'init', '-q', '-b', 'main');
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  const r = await c.hitld(['install', '--key', 'FR', '--marketplace', checkout, '--statusline'], {
    cwd: fresh,
  });
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.done.policy, 'created');
  assert.equal(r.result.done.claude_md, 'import added');
  const settings = JSON.parse(readFileSync(join(fresh, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.extraKnownMarketplaces['human-in-the-lead'].source, {
    source: 'directory',
    path: resolve(checkout),
  });
  assert.equal(settings.enabledPlugins['human-in-the-lead@human-in-the-lead'], true);
  const local = JSON.parse(readFileSync(join(fresh, '.claude/settings.local.json'), 'utf8'));
  assert.match(local.statusLine.command, /hitld-statusline\.mjs/);
  assert.equal((await c.hitld(['check', 'contract'], { cwd: fresh })).exit, 0);
  assert.equal((await c.hitld(['check', 'policy'], { cwd: fresh })).exit, 0);
  const again = await c.hitld(['install'], { cwd: fresh });
  assert.equal(again.result.done.policy, 'kept');
  assert.equal(again.result.done.agents_md, 'unchanged');
});

test('a run end to end: plan, dispatch, complete, merge, refill, follow-up', async () => {
  const c = makeConsumer();
  const before = await c.hitld(['dispatch', 'plan']);
  assert.equal(before.exit, 0);
  assert.ok(
    before.result.held.every((/** @type {any} */ h) => h.reason === 'quota'),
    'no usage reading yet: the gate stops dispatch',
  );
  assert.equal(recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env }).recorded, true);

  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.deepEqual(
    plan.result.start.map((/** @type {any} */ s) => s.item),
    ['W-1', 'W-2'],
  );

  const start = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.equal(start.result.dispatch, 'D-1');
  assert.equal(start.result.instruction.tool, 'Agent');
  assert.equal(start.result.instruction.input.name, 'D-1');
  assert.equal(
    (await c.hitld(['dispatch', 'started', '--dispatch', 'D-1', '--handle', 'agent-1'])).exit,
    0,
  );

  // The executor's work, on its branch.
  const branch = start.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, {
    'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    'work/items/W-1-add-numbers.md': item({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      status: 'Done',
      priority: 'medium',
      touches: ['src/calc.js'],
    }),
  });
  git(c.root, 'commit', '-q', '-am', 'W-1');
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const done = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    'D-1',
    '--report-file',
    note,
    '--tokens',
    '5000',
  ]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.queued_to_merge, branch);
  assert.ok(done.result.refill.start.some((/** @type {any} */ s) => s.item === 'W-2'));

  const merged = await c.hitld(['merge']);
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.deepEqual(merged.result.merged, ['W-1']);
  assert.match(readFileSync(join(c.root, 'work/items/W-1-add-numbers.md'), 'utf8'), /status: Done/);
  assert.ok(existsSync(join(c.root, 'work/views')), 'views regenerated on main');
  // W-3 needed W-1: now it is ready.
  const ready = await c.hitld(['ready']);
  assert.ok(ready.result.queue.some((/** @type {any} */ q) => q.id === 'W-3'));

  const follow = await c.hitld([
    'dispatch',
    'follow-up',
    '--dispatch',
    'D-1',
    '--message',
    'Also add mul.',
  ]);
  assert.equal(follow.exit, 0, JSON.stringify(follow.result));
  assert.equal(follow.result.instruction.tool, 'SendMessage');
  assert.equal(follow.result.instruction.input.to, 'agent-1');
  const events = readLedger(
    /** @type {any} */ ({
      read: (/** @type {string} */ k) =>
        k === 'ledger.jsonl'
          ? readFileSync(join(c.data, 'human-in-the-lead/orch-fixture/ledger.jsonl'), 'utf8')
          : null,
    }),
  ).events;
  const kinds = events.map((e) => e.event);
  for (const k of ['dispatched', 'claimed', 'reported', 'verified', 'merged'])
    assert.ok(kinds.includes(k), k);
  assert.equal(events.find((e) => e.event === 'reported')?.tokens, 5000);
});

test('kill and resume: a dispatch recorded but never started is abandoned; a live one is adopted', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  await c.hitld(['dispatch', 'start', 'W-1']); // killed before the Agent call
  await c.hitld(['dispatch', 'start', 'W-2']); // killed after the call, before "started"
  const fresh = { env: { HITLD_SESSION: 'second-session' } };
  const resumed = await c.hitld(['run', 'resume', '--live', 'D-2', '--force'], fresh);
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.deepEqual(resumed.result.abandoned, ['D-1']);
  assert.deepEqual(resumed.result.adopted, ['D-2']);
  const plan = await c.hitld(['dispatch', 'plan'], fresh);
  assert.ok(
    plan.result.start.some((/** @type {any} */ s) => s.item === 'W-1'),
    'the abandoned item is ready again',
  );
  assert.ok(
    !plan.result.start.some((/** @type {any} */ s) => s.item === 'W-2'),
    'the adopted one is not dispatched twice',
  );
  const stale = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(stale.result.error, 'lease_lost', 'the old session lost the lease');
});

test('tier 3 runs headless in a worktree from hitld env; its JSON result completes it', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        status: 'Planned',
        priority: 'urgent',
        tier_hint: '3',
        touches: ['src/other.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.equal(start.result.tier, 3);
  assert.equal(start.result.instruction.tool, 'Bash');
  assert.ok(existsSync(start.result.worktree), 'the worktree exists');
  assert.equal(git(start.result.worktree, 'branch', '--show-current'), start.result.branch);
  assert.match(
    start.result.instruction.input.command,
    /HITLD_DISPATCH=D-1 HITLD_PROJECT=orch-fixture HITLD_ROLE=executor claude -p/,
  );
  await c.hitld(['dispatch', 'started', '--dispatch', 'D-1', '--handle', 'bash-7']);
  const resultFile = start.result.on_complete.split('--result-file ')[1];
  writeFileSync(
    resultFile,
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'sess-9',
      result: report({
        item: 'W-4',
        sha: 'abcdef1',
        branch: start.result.branch,
        status: 'partial',
        questions: 'should the API be renamed?',
      }),
      usage: { input_tokens: 100, output_tokens: 50 },
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
  assert.equal(done.result.status, 'partial');
  assert.deepEqual(done.result.questions, ['should the API be renamed?']);
  assert.ok(done.result.question_protocol);
  assert.equal(done.result.queued_to_merge, undefined);
  const follow = await c.hitld([
    'dispatch',
    'follow-up',
    '--dispatch',
    'D-1',
    '--message',
    'Keep the name.',
  ]);
  assert.equal(follow.result.instruction?.tool, 'Bash', JSON.stringify(follow.result));
  assert.match(follow.result.instruction.input.command, /--resume sess-9/);
});
