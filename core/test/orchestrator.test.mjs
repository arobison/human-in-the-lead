import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { awaitingMerge, planDispatch, slotsText } from '../lib/dispatch/plan.mjs';
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
  const base = { kind: 'work', state: 'planned', classification: 'public' };
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
    { ...base, id: 'W-5', tier_override: 3, touches: ['src/a.js'], body: BODY1 },
    p,
  );
  assert.equal(hinted.tier, 3);
  assert.match(hinted.reasons[0], /tier_override/);
});

test('sizing: an owner-review area asks for a review pack and does not force tier 3', () => {
  const p = policy({ dispatch: { owner_review_areas: ['ui'] } });
  const base = { kind: 'work', state: 'planned', classification: 'public', area: 'ui' };
  const s = sizeItem({ ...base, id: 'W-1', touches: ['src/a.js'], body: BODY1 }, p);
  assert.equal(s.tier, 1, 'mechanical work stays tier 1');
  assert.equal(s.owner_review, 'ui');
  assert.match(s.reasons.at(-1) ?? '', /reviewed in person: the brief asks for a review pack/);
  const brief = renderBrief({
    item: { ...base, id: 'W-1', touches: ['src/a.js'], body: BODY1 },
    sizing: s,
    dispatch: 'D-1',
    branch: 'hitld/W-1-x',
    policy: p,
    isolation: 'worktree',
  });
  assert.match(brief, /Owner review: the owner reviews ui in person\. Prepare a review pack/);
  const other = sizeItem(
    { ...base, area: 'api', id: 'W-2', touches: ['src/a.js'], body: BODY1 },
    p,
  );
  assert.equal(other.owner_review, null);
  assert.doesNotMatch(
    renderBrief({
      item: { ...base, id: 'W-2', touches: ['src/a.js'], body: BODY1 },
      sizing: other,
      dispatch: 'D-2',
      branch: 'hitld/W-2-x',
      policy: p,
      isolation: 'worktree',
    }),
    /Owner review/,
  );
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
  const base = { kind: 'work', state: 'planned', classification: 'public', body: BODY1 };
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
  state: 'planned',
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
  // W-2 needs the gpu W-1 is only proposed for: it waits behind W-1 and is not held.
  assert.deepEqual(
    r.held.map((h) => [h.item, h.reason]),
    [['W-4', 'overlap']],
  );
  assert.equal(r.waiting, 2);
  assert.equal(r.free, 2, 'the proposals take no slot: cap 3, one running');
  assert.equal(r.slots, 'cap 3, 1 running (D-9 on W-9), 2 free');

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

test('plan: proposals hold nothing; a running dispatch holds its serial resources and slot (HITLD-153)', () => {
  const p = policy();
  const items = [
    ready('W-1', { touches: ['src/run.js'], serial: ['db'] }),
    ready('W-2', { touches: ['src/run.js'] }),
    ready('W-3', { serial: ['db'] }),
  ];
  const sizes = new Map(items.map((i) => [i.id, sizeItem(i, p)]));
  const base = { sizes, cap: 2, capabilities: FAKE_PROFILES.full, gate: always };
  // Nothing runs: W-1 is proposed; W-2 and W-3 clash only with that proposal, so they wait
  // and are not held, and both slots are free.
  const idle = planDispatch({ ...base, queue: items, running: [] });
  assert.deepEqual(
    idle.start.map((s) => s.item),
    ['W-1'],
  );
  assert.deepEqual(idle.held, []);
  assert.equal(idle.waiting, 2);
  assert.equal(idle.free, 2);
  assert.equal(idle.slots, 'cap 2, 0 running, 2 free');
  // Planned alone, as dispatch start plans it, W-2 starts although W-1 ranks first.
  const alone = planDispatch({ ...base, queue: [items[1]], running: [] });
  assert.deepEqual(
    alone.start.map((s) => s.item),
    ['W-2'],
  );
  // Once W-1 runs, it holds the db and its touches: W-2 and W-3 are held, and say by whom.
  const busy = planDispatch({
    ...base,
    queue: items.slice(1),
    running: [{ dispatch: 'D-1', item: 'W-1', serial_resources: ['db'], touches: ['src/run.js'] }],
  });
  assert.deepEqual(
    busy.held.map((h) => [h.item, h.reason, h.why]),
    [
      ['W-2', 'overlap', '100% of its touches overlap running work'],
      ['W-3', 'serial', 'db is held by a running dispatch (D-1 on W-1)'],
    ],
  );
  // Both slots taken: the words name the holders and what frees one.
  assert.equal(
    slotsText(2, [
      { dispatch: 'D-1', item: 'W-1' },
      { dispatch: 'D-2', item: 'W-5' },
    ]),
    'cap 2, 2 running (D-1 on W-1, D-2 on W-5), 0 free: a slot frees when one of them reports or is abandoned',
  );
});

test('awaiting merge: a verified branch waits until it merges, is reverted or abandoned (HITLD-153)', () => {
  const pass = (/** @type {string} */ d, /** @type {string} */ id) => [
    { id: `reported-${d}`, event: 'reported', dispatch: d, item: id, result: 'done' },
    { id: `verified-${d}`, event: 'verified', item: id, result: 'pass', branch: `hitld/${id}-x` },
  ];
  const events = [...pass('D-1', 'W-1'), ...pass('D-2', 'W-2')];
  assert.deepEqual(
    awaitingMerge(events).map((a) => [a.item, a.dispatch, a.branch, a.sent_back]),
    [
      ['W-1', 'D-1', 'hitld/W-1-x', false],
      ['W-2', 'D-2', 'hitld/W-2-x', false],
    ],
  );
  // Sent back by the merge queue: still awaiting, for the follow-up, not a fresh dispatch.
  const sentBack = [...events, { id: 'v-f', event: 'verified', item: 'W-1', result: 'fail' }];
  assert.equal(awaitingMerge(sentBack)[0].sent_back, true);
  // Merged, reverted or abandoned: no longer awaiting, and the tracker decides again.
  for (const end of [
    { id: 'm', event: 'merged', item: 'W-1' },
    { id: 'r', event: 'reverted', item: 'W-1' },
    { id: 'a', event: 'abandoned', dispatch: 'D-3', item: 'W-1' },
    { id: 'u', event: 'unclaimed', item: 'W-1' },
  ]) {
    assert.deepEqual(
      awaitingMerge([...events, end]).map((a) => a.item),
      ['W-2'],
      end.event,
    );
  }
  // A correction of the pass (the owner dropped the branch) releases the item too.
  const dropped = [
    ...events,
    { id: 'c', event: 'verified', item: 'W-1', result: 'fail', corrects: 'verified-D-1' },
  ];
  assert.deepEqual(
    awaitingMerge(dropped).map((a) => a.item),
    ['W-2'],
  );
  // A partial or blocked report queues nothing: the item is planned as before.
  assert.deepEqual(
    awaitingMerge([
      { id: 'x', event: 'reported', dispatch: 'D-4', item: 'W-4', result: 'partial' },
    ]),
    [],
  );
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
  assert.match(brief, /HITLD_DISPATCH=D-4 HITLD_PROJECT_ID=test HITLD_ROLE=executor/);
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
      env: { HITLD_PROJECT_ID: 'p', HITLD_ROLE: 'executor' },
    },
  );
  assert.equal(headless.tool, 'Bash');
  assert.match(
    String(headless.input.command),
    /^cd '\/w\/D 3' && HITLD_DISPATCH=D-3 HITLD_PROJECT_ID=p HITLD_ROLE=executor claude -p --output-format json --model opus --effort high --permission-mode acceptEdits < \/s\/b.md > \/s\/r.json$/,
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
  for (const release of ['hitld release make', 'node core/bin/hitld.mjs "release" make --pre rc']) {
    const out = asExecutor(release);
    assert.match(out, /"deny"/, release);
    assert.match(out, /making a release is the owner's/, release);
  }
  assert.equal(
    hook('guard.mjs', { tool_name: 'Bash', tool_input: { command: 'hitld release make' } }).stdout,
    '',
  );
  for (const allowed of [
    'hitld work claim W-3 --claimant D-2 --branch b',
    'hitld work close W-3',
    'hitld env setup --dispatch D-2 --adopt "$PWD"',
    'hitld env port lease --dispatch D-2',
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
  assert.equal(settings.extraKnownMarketplaces['human-in-the-lead'].autoUpdate, false);
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
    (await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1'])).exit,
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
      state: 'done',
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
  assert.match(readFileSync(join(c.root, 'work/items/W-1-add-numbers.md'), 'utf8'), /state: done/);
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
  for (const k of ['dispatched', 'started', 'reported', 'verified', 'merged'])
    assert.ok(kinds.includes(k), k);
  assert.equal(events.find((e) => e.event === 'reported')?.tokens, 5000);
});

test('dispatch start takes any ready item a free slot allows; finished work awaits merge (HITLD-153)', async () => {
  const extra = (
    /** @type {string} */ id,
    /** @type {string} */ title,
    /** @type {string} */ file,
  ) => ({
    [`work/items/${id}-${title.toLowerCase().replace(/ /g, '-')}.md`]: item({
      id,
      title,
      kind: 'work',
      state: 'planned',
      touches: [file],
    }),
  });
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 2 } } },
    files: { ...extra('W-4', 'Four', 'src/four.js'), ...extra('W-5', 'Five', 'src/five.js') },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.result.cap, 2);
  assert.equal(plan.result.start.length, 2);
  assert.equal(plan.result.free, 2, 'the start list takes no slot');
  assert.equal(plan.result.slots, 'cap 2, 0 running, 2 free');
  const proposed = plan.result.start.map((/** @type {any} */ s) => s.item);
  assert.ok(!proposed.includes('W-4') && !proposed.includes('W-5'));

  // Two items the plan did not propose start past the ones it ranks higher.
  for (const [id, d] of [
    ['W-4', 'D-1'],
    ['W-5', 'D-2'],
  ]) {
    const s = await c.hitld(['dispatch', 'start', id]);
    assert.equal(s.exit, 0, JSON.stringify(s.result));
    assert.equal(s.result.dispatch, d);
    await c.hitld(['dispatch', 'handle', '--dispatch', d, '--harness-ref', `agent-${d}`]);
  }
  // No slot is free: the refusal names the slots, their holders and what frees one, as the plan does.
  const full = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(full.result.error, 'not-planned');
  const words =
    'cap 2, 2 running (D-1 on W-4, D-2 on W-5), 0 free: a slot frees when one of them reports or is abandoned';
  assert.equal(full.result.message, `W-1 is ready but no slot is free: ${words}`);
  assert.equal((await c.hitld(['dispatch', 'plan'])).result.slots, words);
  const hand = await c.hitld(['dispatch', 'start', 'W-1', '--by-hand']);
  assert.equal(hand.result.message, `W-1 is ready but no slot is free: ${words}`);

  // D-1 finishes W-4 on its branch: the work awaits merge, takes no slot and is not planned again.
  const branch = 'hitld/W-4-four';
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, {
    'src/four.js': 'export const four = 4;\n',
    'work/items/W-4-four.md': item({
      id: 'W-4',
      title: 'Four',
      kind: 'work',
      state: 'done',
      touches: ['src/four.js'],
    }),
  });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'W-4');
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note-4.txt');
  writeFileSync(note, report({ item: 'W-4', sha, branch }));
  const done = await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  const refill = done.result.refill;
  assert.equal(refill.free, 1);
  assert.ok(!refill.start.some((/** @type {any} */ s) => s.item === 'W-4'));
  assert.deepEqual(
    refill.awaiting_merge.map((/** @type {any} */ a) => [a.item, a.dispatch, a.branch]),
    [['W-4', 'D-1', branch]],
  );
  const ready = await c.hitld(['ready']);
  assert.ok(!ready.result.queue.some((/** @type {any} */ q) => q.id === 'W-4'));
  const again = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.equal(again.result.error, 'not-planned');
  assert.match(again.result.message, /^W-4 awaits merge: D-1 reported it done on hitld\/W-4-four/);

  // The branch merges: W-4 no longer awaits, and the tracker on main says it is done.
  const merged = await c.hitld(['merge']);
  assert.deepEqual(merged.result.merged, ['W-4'], JSON.stringify(merged.result));
  const after = await c.hitld(['dispatch', 'plan']);
  assert.deepEqual(after.result.awaiting_merge, []);
  assert.ok(!after.result.start.some((/** @type {any} */ s) => s.item === 'W-4'));
});

test('an item awaiting merge is planned again once its pass is corrected away (HITLD-153)', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const s = await c.hitld(['dispatch', 'start', 'W-2']);
  assert.equal(s.exit, 0, JSON.stringify(s.result));
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1']);
  const branch = s.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, { 'src/other.js': 'export const one = 1;\nexport const two = 2;\n' });
  git(c.root, 'commit', '-q', '-am', 'W-2');
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note-2.txt');
  writeFileSync(note, report({ item: 'W-2', sha, branch }));
  const done = await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
  assert.deepEqual(
    done.result.refill.awaiting_merge.map((/** @type {any} */ a) => a.item),
    ['W-2'],
  );
  assert.ok(!done.result.refill.start.some((/** @type {any} */ x) => x.item === 'W-2'));
  // The owner drops the branch: the pass is corrected, and the tracker's word holds again.
  const dropped = await c.hitld([
    'ledger',
    'append',
    JSON.stringify({
      event: 'verified',
      item: 'W-2',
      result: 'fail',
      corrects: 'verified-D-1',
      notes: 'the owner dropped the branch',
    }),
  ]);
  assert.equal(dropped.exit, 0, JSON.stringify(dropped.result));
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.deepEqual(plan.result.awaiting_merge, []);
  assert.ok(plan.result.start.some((/** @type {any} */ x) => x.item === 'W-2'));
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
  assert.equal(stale.result.error, 'lease-lost', 'the old session lost the lease');
});

test('identity: with no flags and no HITLD_SESSION, the harness names the session and run start the host', async () => {
  const c = makeConsumer();
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const harness = { env: { HITLD_SESSION: undefined, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_orch' } };
  const started = await c.hitld(['run', 'start', '--host', 'far-box'], harness);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  assert.deepEqual(started.result.identity, {
    session: 'cse_orch',
    host: 'far-box',
    source: 'harness',
  });
  // Later calls of the session pass neither flag: the session from the harness, the host recorded.
  const first = await c.hitld(['dispatch', 'start', 'W-1'], harness);
  assert.equal(first.exit, 0, JSON.stringify(first.result));
  // The same session on another host: not a lost lease, and it says which hosts.
  const moved = await c.hitld(['dispatch', 'start', 'W-2', '--host', 'near-box'], harness);
  assert.equal(moved.result.error, 'lease-host-mismatch');
  assert.deepEqual(moved.result.differs, ['host']);
  assert.match(moved.result.message, /on host far-box, but this call gives host near-box/);
  // Another session of the harness does not hold it, and has no host recorded: both differ.
  const other = await c.hitld(['dispatch', 'start', 'W-2'], {
    env: { HITLD_SESSION: undefined, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_other' },
  });
  assert.deepEqual([other.result.error, other.result.differs], ['lease-lost', ['session', 'host']]);
});

test('tier 3 runs headless in a worktree from hitld env; its JSON result completes it', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/other.js'],
      }),
      // Two items wait on W-4, so it unblocks the most and comes first in the queue.
      'work/items/W-5-after-redesign.md': item({
        id: 'W-5',
        title: 'After redesign',
        kind: 'work',
        state: 'planned',
        needs: ['W-4'],
      }),
      'work/items/W-6-also-after.md': item({
        id: 'W-6',
        title: 'Also after',
        kind: 'work',
        state: 'planned',
        needs: ['W-4'],
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
    /HITLD_DISPATCH=D-1 HITLD_PROJECT_ID=orch-fixture HITLD_ROLE=executor claude -p/,
  );
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'bash-7']);
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
        result: 'partial',
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
  assert.equal(done.result.result, 'partial');
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
