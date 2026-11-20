// The watchdog and resuming after limits (design parts 5.2, 12.5 and 13.1): progress the executor
// does not have to send, stalls and the ladder, a deadline, a quota pause and its resume at the
// reset, a budget raise, and the measures and calibration that read them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { openStore } from '../lib/store/store.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { historyFromLedger } from '../lib/dispatch/sizing.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { progressTimes } from '../lib/dispatch/progress.mjs';
import { stallLimits, watchDispatches } from '../lib/dispatch/watch.mjs';
import { silentOrchestrator } from '../lib/run/messages.mjs';
import { pauseTransition } from '../lib/quota/pause.mjs';
import { evaluateQuotas } from '../lib/quota/quota.mjs';
import { declaredReset } from '../lib/quota/window.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { git, makeConsumer, put } from './orchestrator-fixture.mjs';

const HOOKS = resolve(fileURLToPath(new URL('../harness/claude-code/hooks/', import.meta.url)));

const policy = (/** @type {Record<string, unknown>} */ extra = {}) => {
  const { policy: p, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'test', key: 'W' },
    ...extra,
  });
  if (!p) throw new Error(JSON.stringify(errors));
  return p;
};

/**
 * A consumer whose commands run on a clock the test moves: `at(seconds)` sets it to that many
 * seconds after the start.
 * @param {Parameters<typeof makeConsumer>[0]} [options]
 */
function clocked(options) {
  const c = makeConsumer(options);
  const t0 = Date.now();
  let offset = 0;
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
  const hitld = async (argv, env = {}) => {
    let out = '';
    const exit = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: c.root,
      env: { ...c.env, ...env },
      now: () => new Date(t0 + offset * 1000),
    });
    return { exit, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
  };
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  /**
   * Record a status-line reading: the five-hour window used and when it resets, in seconds after
   * the start.
   * @param {number} used @param {number} resetsIn
   */
  const status = (used, resetsIn) =>
    recordStatusLine(
      JSON.stringify({
        session_id: 's-1',
        workspace: { project_dir: c.root },
        rate_limits: {
          five_hour: { used_percentage: used, resets_at: Math.floor(t0 / 1000) + resetsIn },
          seven_day: { used_percentage: 10, resets_at: Math.floor(t0 / 1000) + 7 * 86400 },
        },
      }),
      { cwd: c.root, env: c.env, now: () => new Date(t0 + offset * 1000) },
    );
  return {
    ...c,
    hitld,
    store,
    status,
    t0,
    /** @param {number} s */
    at: (s) => {
      offset = s;
    },
    events: () => readLedger(store).events,
  };
}

// --- Progress, not pings ------------------------------------------------------------------------

test('progress: the hook records an executor tool call, the watch samples its branch; neither needs the agent', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const d = start.result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d, '--harness-ref', 'agent-1']);

  // A tool call by the background agent: the PostToolUse hook knows its agent ID, not its dispatch.
  const env = { PATH: process.env.PATH, XDG_DATA_HOME: c.env.XDG_DATA_HOME };
  const hooked = spawnSync(process.execPath, [join(HOOKS, 'progress.mjs')], {
    input: JSON.stringify({
      agent_type: 'human-in-the-lead:executor-tier1',
      agent_id: 'agent-1',
      tool_name: 'Edit',
      cwd: c.root,
    }),
    encoding: 'utf8',
    env,
  });
  assert.equal(hooked.status, 0);
  assert.equal(hooked.stdout, '', 'the hook never changes the tool call');
  const line = JSON.parse(
    /** @type {string} */ (c.store.read('dispatch/progress/ref-agent-1.jsonl')),
  );
  assert.equal(line.source, 'harness');
  assert.equal(line.tool, 'Edit');
  // Anyone else's tool calls are not recorded.
  spawnSync(process.execPath, [join(HOOKS, 'progress.mjs')], {
    input: JSON.stringify({ agent_id: 'main', tool_name: 'Edit', cwd: c.root }),
    encoding: 'utf8',
    env,
  });
  assert.equal(c.store.read('dispatch/progress/ref-main.jsonl'), null);

  c.at(1700);
  const quiet = await c.hitld(['dispatch', 'watch']);
  assert.equal(quiet.exit, 0, JSON.stringify(quiet.result));
  const d1 = quiet.result.dispatches[0];
  assert.equal(d1.state, 'progressing');
  assert.equal(d1.last_progress_at, line.at, 'the tool call is its last progress');

  // A commit on its branch, seen by the watch without the agent saying anything.
  git(c.root, 'switch', '-q', '-c', start.result.branch);
  put(c.root, { 'src/calc.js': 'export const add = (a, b) => a + b + 0;\n' });
  git(c.root, 'commit', '-q', '-am', 'W-1: work');
  git(c.root, 'switch', '-q', 'main');
  c.at(3000);
  const seen = await c.hitld(['dispatch', 'watch']);
  assert.equal(seen.result.dispatches[0].state, 'progressing');
  assert.equal(seen.result.dispatches[0].last_progress_at, new Date(c.t0 + 3000_000).toISOString());
  const worktree = c.store
    .read(`dispatch/progress/${d}.jsonl`)
    ?.trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(worktree?.at(-1)?.source, 'worktree');
  assert.equal(worktree?.at(-1)?.commits, 1);
  // Nothing new: the next sample writes nothing, and the quiet time runs from the commit.
  c.at(3600);
  const again = await c.hitld(['dispatch', 'watch']);
  assert.equal(again.result.dispatches[0].quiet_seconds, 600);
  assert.equal(c.store.read(`dispatch/progress/${d}.jsonl`)?.trim().split('\n').length, 1);
});

test('progress: a sampled source counts when it changes; liveness alone is not progress', () => {
  const at = (/** @type {number} */ s) => new Date(1_800_000_000_000 + s * 1000).toISOString();
  const times = progressTimes([
    { at: at(0), source: 'worktree', head: 'abc1234', commits: 0, dirty: 0 },
    { at: at(10), source: 'process', alive: true, output_bytes: 0 },
    {
      at: at(20),
      source: 'worktree',
      head: 'abc1234',
      commits: 0,
      dirty: 1,
      changed: 'a'.repeat(64),
    },
    { at: at(30), source: 'process', alive: true, output_bytes: 0 },
    { at: at(40), source: 'harness', tool_calls: 1 },
  ]);
  assert.deepEqual(
    times.map((t) => (t - 1_800_000_000_000) / 1000),
    [20, 40],
  );
});

// --- Limits -------------------------------------------------------------------------------------

test('stall limits scale by tier and estimate, never below the base', () => {
  const p = policy();
  assert.deepEqual(stallLimits(1, 60000, p), {
    stall_after: 1800,
    deadline: 14400,
    poke_wait: 600,
    scale: 1,
  });
  assert.equal(stallLimits(2, 150000, p).stall_after, 2700, 'tier 2: one and a half times');
  assert.equal(stallLimits(1, 120000, p).stall_after, 3600, 'twice the default estimate');
  assert.equal(stallLimits(1, 10_000_000, p).stall_after, 5400, 'capped at stall_estimate_max');
  assert.equal(stallLimits(1, 1000, p).stall_after, 1800, 'a small estimate does not shorten it');
  assert.equal(stallLimits(3, 400000, p).deadline, 43200);
});

// --- The ladder ---------------------------------------------------------------------------------

test('the ladder: poke, follow-up with commits kept, abandon and re-dispatch, then a question for the owner', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start']);
  const d1 = (await c.hitld(['dispatch', 'start', 'W-1'])).result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d1, '--harness-ref', 'agent-1']);

  c.at(1000);
  assert.equal((await c.hitld(['dispatch', 'watch'])).result.wake, false);

  // Step 1: quiet past its stall time. The chief of staff's watch reads only, and says to wake.
  c.at(1900);
  const seen = await c.hitld(['dispatch', 'watch'], { HITLD_SESSION: 'cos' });
  assert.equal(seen.result.wake, true);
  assert.equal(seen.result.wake_message, `watch: ${d1} stalled (poke)`);
  assert.deepEqual(seen.result.due, [
    { dispatch: d1, item: 'W-1', step: 'poke', reason: 'no_progress' },
  ]);
  assert.ok(!c.events().some((e) => e.event === 'stalled'), 'a read records nothing');
  const refused = await c.hitld(['dispatch', 'watch', '--act'], { HITLD_SESSION: 'cos' });
  assert.equal(refused.result.error, 'lease-lost', 'only the lease holder acts');

  const poke = await c.hitld(['dispatch', 'watch', '--act']);
  assert.equal(poke.exit, 0, JSON.stringify(poke.result));
  assert.equal(poke.result.actions.length, 1);
  assert.equal(poke.result.actions[0].step, 'poke');
  assert.equal(poke.result.actions[0].to.harness_ref, 'agent-1');
  assert.match(poke.result.actions[0].message, new RegExp(`Status check for ${d1}`));

  // Within the poke's wait nothing more happens.
  c.at(2300);
  assert.deepEqual((await c.hitld(['dispatch', 'watch', '--act'])).result.actions, []);

  // Step 2: the poke failed. Interrupted, and continued as a follow-up on the same agent.
  c.at(2600);
  const follow = await c.hitld(['dispatch', 'watch', '--act']);
  const f = follow.result.actions[0];
  assert.equal(f.step, 'follow-up');
  const d2 = f.continues_as;
  assert.match(d2, /^D-[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.equal(f.instruction.tool, 'SendMessage');
  assert.equal(f.instruction.input.to, 'agent-1');
  assert.match(f.instruction.input.message, /Continue the item from your last commit/);

  // Step 3: the follow-up stalled too. Abandoned, and the item is planned afresh.
  c.at(2600 + 1900);
  const abandon = await c.hitld(['dispatch', 'watch', '--act']);
  assert.equal(abandon.result.actions[0].step, 'abandon');
  assert.equal(abandon.result.actions[0].dispatch, d2);
  assert.ok(
    abandon.result.refill.start.some((/** @type {any} */ s) => s.item === 'W-1'),
    'the abandoned item is ready again',
  );

  // The fresh dispatch climbs the same ladder; after one re-dispatch the next failure is a question.
  const again = await c.hitld(['dispatch', 'start', 'W-1']);
  const d3 = again.result.dispatch;
  assert.match(d3, /^D-[0-9A-HJKMNP-TV-Z]{16}$/);
  await c.hitld(['dispatch', 'handle', '--dispatch', d3, '--harness-ref', 'agent-3']);
  c.at(4500 + 1900);
  assert.equal((await c.hitld(['dispatch', 'watch', '--act'])).result.actions[0].step, 'poke');
  c.at(4500 + 2600);
  const f2 = (await c.hitld(['dispatch', 'watch', '--act'])).result.actions[0];
  assert.equal(f2.step, 'follow-up');
  const d4 = f2.continues_as;
  assert.match(d4, /^D-[0-9A-HJKMNP-TV-Z]{16}$/);
  c.at(4500 + 2600 + 1900);
  const ask = (await c.hitld(['dispatch', 'watch', '--act'])).result.actions[0];
  assert.equal(ask.step, 'ask');
  assert.equal(ask.dispatch, d4);
  assert.deepEqual(schemas().validate('question', ask.question), []);
  assert.deepEqual(ask.question.blocks, ['W-1']);
  assert.equal(ask.question.recommendation.option, 'hold');
  assert.ok(ask.question.default_if_unanswered, 'holding is easy to undo: it has a default');

  // Every step is in the ledger.
  const events = c.events();
  const stalls = events.filter((e) => e.event === 'stalled');
  assert.deepEqual(
    stalls.map((e) => `${e.dispatch} ${e.step}`),
    [
      `${d1} poke`,
      `${d1} follow-up`,
      `${d2} abandon`,
      `${d3} poke`,
      `${d3} follow-up`,
      `${d4} ask`,
    ],
  );
  assert.deepEqual(
    events
      .filter((e) => ['poked', 'interrupted', 'abandoned'].includes(e.event))
      .map((e) => `${e.event} ${e.dispatch}`),
    [
      `poked ${d1}`,
      `interrupted ${d1}`,
      `abandoned ${d2}`,
      `poked ${d3}`,
      `interrupted ${d3}`,
      `abandoned ${d4}`,
    ],
  );
  assert.equal(
    events.find((e) => e.dispatch === d2 && e.event === 'dispatched')?.notes,
    `follow-up of ${d1}`,
  );

  // The measures: every executor dispatch stalled, by tier and model.
  const s = summarize(events).stalls;
  assert.equal(s.dispatches, 4);
  assert.equal(s.stalled, 4);
  assert.equal(s.rate, 1);
  assert.deepEqual(s.steps, { poke: 2, 'follow-up': 2, abandon: 1, ask: 1 });
  assert.deepEqual(s.by_tier['1'], { dispatches: 4, stalled: 4, rate: 1 });
  const viaCli = await c.hitld(['ledger', 'summary']);
  assert.deepEqual(viaCli.result.stalls.steps, s.steps);
  // Calibration: each stalled dispatch is a miss at its tier for familiar ground.
  const history = historyFromLedger(events, () => undefined);
  assert.equal(history.length, 4);
  assert.ok(history.every((h) => h.stalled === true && h.firstPass === false && h.tier === 1));
});

/** A synthetic ledger and in-flight entry for the pure watchdog. */
function synthetic(
  /** @type {Partial<import('../lib/ledger/inflight.mjs').InFlight>} */ over = {},
) {
  const t = 1_800_000_000_000;
  const at = (/** @type {number} */ s) => new Date(t + s * 1000).toISOString();
  const entry = {
    dispatch: 'D-1',
    item: 'W-1',
    tier: 1,
    harness: 'claude-code',
    harness_ref: 'agent-1',
    host: 'h',
    worktree: null,
    branch: 'hitld/W-1-x',
    serial_resources: [],
    started_at: at(0),
    ...over,
  };
  const events = [
    {
      id: 'E-1',
      event: 'dispatched',
      dispatch: 'D-1',
      item: 'W-1',
      tier: 1,
      estimate_tokens: 60000,
      at: at(0),
    },
  ];
  return { t, at, entry, events };
}

test('a dispatch that recovers after a poke starts again from a poke; one past its deadline does not', () => {
  const { t, at, entry, events } = synthetic();
  const p = policy();
  /** @type {any[]} */
  let signals = [];
  /** @param {number} s @param {any[]} evs */
  const judge = (s, evs) =>
    watchDispatches({
      inFlight: [entry],
      events: evs,
      signals: () => signals,
      policy: p,
      now: t + s * 1000,
    })[0];
  const poked = [
    ...events,
    {
      id: 'E-2',
      event: 'stalled',
      dispatch: 'D-1',
      item: 'W-1',
      reason: 'no_progress',
      step: 'poke',
      at: at(1800),
    },
  ];
  // It answered the poke with work, then went quiet again: a poke again, not a follow-up.
  signals = [{ at: at(1900), source: 'harness', tool_calls: 1 }];
  assert.equal(judge(1900 + 1800, poked).step, 'poke');
  // Without that progress, the follow-up is next.
  signals = [];
  assert.equal(judge(2500, poked).step, 'follow-up');

  // The deadline: progressing all along, it climbs the ladder anyway.
  signals = Array.from({ length: 150 }, (_, i) => ({
    at: at(i * 100),
    source: 'harness',
    tool_calls: 1,
  }));
  const late = judge(14500, events);
  assert.equal(late.state, 'overdue');
  assert.equal(late.reason, 'deadline');
  assert.equal(late.step, 'poke');
  const pokedLate = [
    ...events,
    {
      id: 'E-2',
      event: 'stalled',
      dispatch: 'D-1',
      item: 'W-1',
      reason: 'deadline',
      step: 'poke',
      at: at(14500),
    },
  ];
  signals.push({ at: at(14900), source: 'harness', tool_calls: 1 });
  assert.equal(judge(15200, pokedLate).step, 'follow-up', 'progress does not clear a deadline');
});

test('a headless run cannot be messaged: a quiet one or one whose process ended is abandoned', () => {
  const { t, at, entry, events } = synthetic({ tier: 3, mode: 'headless' });
  const p = policy();
  /** @param {any[]} signals @param {number} s */
  const judge = (signals, s) =>
    watchDispatches({
      inFlight: [entry],
      events,
      signals: () => signals,
      policy: p,
      now: t + s * 1000,
    })[0];
  assert.equal(judge([], 5300).state, 'progressing', 'tier 3 waits three times as long');
  assert.equal(judge([], 5500).step, 'abandon');
  const gone = judge([{ at: at(100), source: 'process', alive: false, output_bytes: 0 }], 200);
  assert.equal(gone.reason, 'exited');
  assert.equal(gone.step, 'abandon');
  const finished = judge(
    [{ at: at(100), source: 'process', alive: false, output_bytes: 900 }],
    200,
  );
  assert.equal(finished.state, 'finished');
  assert.equal(finished.step, null);
  // A dispatch on another machine is that machine's watchdog's.
  const other = watchDispatches({
    inFlight: [entry],
    events,
    signals: () => [],
    policy: p,
    now: t + 9e6,
    host: 'elsewhere',
  })[0];
  assert.equal(other.state, 'foreign');
});

// --- Pause and resume ---------------------------------------------------------------------------

test('a quota pause records why and when the window resets; after the reset the run resumes and a cut-off executor is continued', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start']);
  const d = (await c.hitld(['dispatch', 'start', 'W-1'])).result.dispatch;
  await c.hitld(['dispatch', 'handle', '--dispatch', d, '--harness-ref', 'agent-1']);

  // The five-hour window reaches the reserve; it resets 3000 seconds after the start.
  c.status(80, 3000);
  c.at(60);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.result.gate.mode, 'stop');
  const resetsAt = new Date((Math.floor(c.t0 / 1000) + 3000) * 1000).toISOString();
  assert.equal(plan.result.gate.resets_at, resetsAt);
  assert.equal(plan.result.wake_at, resetsAt);
  assert.equal(plan.result.paused.limit, 'claude-five-hour');
  assert.match(plan.result.next, /wake_at: .* quota reset/);
  const paused = c.events().filter((e) => e.event === 'paused');
  assert.equal(paused.length, 1);
  assert.equal(paused[0].resets_at, resetsAt);
  assert.match(paused[0].notes, /stop at the reserve/);
  // Planning again records nothing new.
  await c.hitld(['dispatch', 'plan']);
  assert.equal(c.events().filter((e) => e.event === 'paused').length, 1);

  // The chief of staff reads when to wake the run.
  const status = await c.hitld(['run', 'status'], { HITLD_SESSION: 'cos' });
  assert.equal(status.result.wake_at, resetsAt);
  assert.match(status.result.next, /schedule one wake for/);

  // Before the reset a quiet executor may have hit the limit too: the ladder waits.
  c.at(2500);
  const before = await c.hitld(['dispatch', 'watch'], { HITLD_SESSION: 'cos' });
  assert.equal(before.result.dispatches[0].state, 'waiting_for_reset');
  assert.equal(before.result.resume.due, false);
  assert.equal(before.result.wake, false);

  // The scheduled wake, after the reset. The session's status line has a fresh reading.
  c.status(5, 3000 + 18000);
  c.at(3100);
  const after = await c.hitld(['dispatch', 'watch'], { HITLD_SESSION: 'cos' });
  assert.equal(after.result.resume.due, true);
  assert.equal(after.result.dispatches[0].state, 'cut_off');
  assert.equal(after.result.wake_message, `watch: ${d} cut off (follow-up); dispatch may resume`);

  const acted = await c.hitld(['dispatch', 'watch', '--act']);
  assert.equal(acted.exit, 0, JSON.stringify(acted.result));
  assert.equal(acted.result.actions[0].step, 'follow-up');
  assert.equal(acted.result.actions[0].reason, 'limit');
  assert.match(
    acted.result.actions[0].instruction.input.message,
    /usage limit, which has now reset/,
  );
  assert.equal(acted.result.resumed.reason, 'reset');
  assert.equal(acted.result.paused, null);
  assert.ok(acted.result.refill.start.some((/** @type {any} */ s) => s.item === 'W-2'));

  const events = c.events();
  assert.equal(events.find((e) => e.event === 'resumed')?.reason, 'reset');
  const limit = events.find((e) => e.event === 'stalled');
  assert.equal(limit?.reason, 'limit');
  assert.equal(limit?.step, 'follow-up');
  const s = summarize(events).stalls;
  assert.equal(s.cut_off_by_limit, 1);
  assert.equal(s.stalled, 0, 'a limit is not the executor failing');
  assert.equal(s.pauses, 1);
  assert.equal(s.resumes, 1);
  assert.equal(historyFromLedger(events, () => undefined).length, 0, 'nor a miss for calibration');
});

test('a raised budget through config write re-plans at once, before the reset', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start']);
  c.status(80, 72000);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.result.gate.mode, 'stop');
  assert.ok(plan.result.paused);

  // Raising a reserve that stays tight changes nothing.
  const still = await c.hitld([
    'config',
    'write',
    'person',
    '--merge',
    '--data',
    '{"quota":{"reserve":0.3}}',
  ]);
  assert.equal(still.exit, 0, JSON.stringify(still.result));
  assert.equal(still.result.replan.lifts, false);

  // The owner lowers their reserve: the gate lets dispatch go again, and the next plan resumes.
  const raised = await c.hitld([
    'config',
    'write',
    'person',
    '--merge',
    '--data',
    '{"quota":{"reserve":0.1}}',
  ]);
  assert.equal(raised.exit, 0, JSON.stringify(raised.result));
  assert.equal(raised.result.replan.lifts, true);
  assert.match(raised.result.replan.next, /wake the session holding the lease now/);
  assert.ok(!c.events().some((e) => e.event === 'resumed'), 'config write does not hold the lease');

  const again = await c.hitld(['dispatch', 'plan']);
  assert.notEqual(again.result.gate.mode, 'stop');
  assert.equal(again.result.resumed.reason, 'budget');
  assert.equal(again.result.paused, null);
  assert.equal(c.events().findLast((e) => e.event === 'resumed')?.reason, 'budget');
});

test('pause transitions: one pause per limit and reset, kept while the reading is pending, resumed once', () => {
  const stop = {
    mode: 'stop',
    reason: 'stop at the reserve',
    binding: 'five',
    resets_at: '2026-11-15T12:00:00.000Z',
  };
  const first = pauseTransition(stop, null, 0);
  assert.equal(first?.event, 'paused');
  const active = {
    id: 'E-9',
    at: '2026-11-15T10:00:00.000Z',
    limit: 'five',
    resets_at: stop.resets_at,
    reason: 'x',
  };
  assert.equal(pauseTransition(stop, active, 0), null, 'the same pause again');
  assert.equal(
    pauseTransition({ ...stop, resets_at: null }, active, 0),
    null,
    'no reading yet just after a reset',
  );
  assert.equal(pauseTransition({ ...stop, binding: 'weekly' }, active, 0)?.event, 'paused');
  const go = { mode: 'normal', reason: 'ample', binding: null, resets_at: null };
  assert.equal(pauseTransition(go, active, Date.parse(stop.resets_at))?.reason, 'reset');
  assert.equal(pauseTransition(go, active, 0)?.reason, 'budget');
  assert.equal(pauseTransition(go, null, 0), null);
});

test('a declared reset stands in where no reading gives one', () => {
  const anchor = Date.parse('2026-11-15T09:00:00Z');
  const limit = { window: 'rolling_5h', resets_at: '2026-11-15T09:00:00Z' };
  assert.equal(declaredReset(limit, anchor - 1000), anchor);
  assert.equal(declaredReset(limit, anchor + 3_600_000), anchor + 5 * 3_600_000);
  assert.equal(declaredReset(limit, anchor + 11 * 3_600_000), anchor + 15 * 3_600_000);
  assert.equal(
    declaredReset({ window: 'run', resets_at: '2026-11-15T09:00:00Z' }, anchor + 1),
    null,
  );
  const p = policy({
    quota: {
      limits: [
        {
          id: 'budget',
          unit: 'tokens',
          window: 'weekly',
          limit: 1000,
          source: 'declared',
          hard: false,
          resets_at: '2026-11-16T00:00:00Z',
        },
      ],
    },
  });
  const [q] = evaluateQuotas({ policy: p, now: Date.parse('2026-11-15T12:00:00Z') });
  assert.equal(q.resets_at, '2026-11-16T00:00:00.000Z');
});

test('ledger events of the watchdog and the pause are checked', () => {
  const lines = readFileSync(
    resolve(fileURLToPath(new URL('../../schemas/ledger-entry.schema.json', import.meta.url))),
    'utf8',
  );
  assert.match(lines, /"stalled"/);
  const store = openStore(join(makeConsumer().base, 'store'));
  const bad = [
    { event: 'stalled', dispatch: 'D-1', item: 'W-1', reason: 'handover', step: 'poke' },
    { event: 'stalled', dispatch: 'D-1', item: 'W-1', reason: 'no_progress' },
    { event: 'resumed', reason: 'deadline' },
    { event: 'poked', dispatch: 'D-1', item: 'W-1', step: 'poke' },
  ];
  for (const e of bad) {
    store.write(
      'ledger.jsonl',
      JSON.stringify({ schema_version: 2, id: 'E-1', at: '2026-11-15T10:00:00Z', ...e }) + '\n',
    );
    assert.equal(readLedger(store).events.length, 0, JSON.stringify(e));
  }
});

test('an interactive session cut off by a limit is poked through the chief of staff, once', () => {
  const { t, at, entry, events } = synthetic({ tier: 3, mode: 'interactive' });
  const p = policy();
  const pause = { id: 'E-2', at: at(600), limit: 'five', resets_at: at(3000), reason: 'x' };
  /** @param {any[]} evs @param {number} s */
  const judge = (evs, s) =>
    watchDispatches({
      inFlight: [entry],
      events: evs,
      signals: () => [],
      policy: p,
      now: t + s * 1000,
      pause: null,
      timedPause: pause,
    })[0];
  const cut = judge(events, 3700);
  assert.equal(cut.state, 'cut_off');
  assert.equal(cut.step, 'poke', 'an interactive session is continued with a message');
  const after = [
    ...events,
    {
      id: 'E-4',
      event: 'stalled',
      dispatch: 'D-1',
      item: 'W-1',
      reason: 'limit',
      step: 'poke',
      at: at(3700),
    },
  ];
  assert.equal(judge(after, 3800).state, 'progressing', 'its clock starts again from the poke');
  assert.equal(judge(after, 3700 + 5400).step, 'poke', 'then the ordinary ladder');
});

// --- A silent orchestrator (HITLD-144) -----------------------------------------------------------

test('silentOrchestrator: woken or working after the last message heard, and quiet past the limit', () => {
  const lease = {
    session: 's-1',
    harness_ref: 'session_orch',
    renewed_at: '2026-11-16T10:00:00.000Z',
  };
  const now = Date.parse('2026-11-16T11:00:00.000Z');
  // No record: no chief of staff records messages here, so nothing is judged.
  assert.equal(silentOrchestrator({ record: null, lease, now }), null);
  // A released lease is the successor path, not this one.
  assert.equal(
    silentOrchestrator({
      record: { schema_version: 1, woke_at: '2026-11-16T10:10:00.000Z' },
      lease: { ...lease, released: { reason: 'handover' } },
      now,
    }),
    null,
  );
  // Woken at 10:10 and nothing heard: silent after the default 900 seconds.
  const s = silentOrchestrator({
    record: { schema_version: 1, woke_at: '2026-11-16T10:10:00.000Z' },
    lease,
    now,
  });
  assert.equal(s?.session, 'session_orch');
  assert.equal(s?.since, '2026-11-16T10:10:00.000Z');
  assert.equal(s?.quiet_seconds, 3000);
  assert.match(String(s?.why), /was woken .* its turn ended without one/);
  // Heard after the wake: all is well.
  assert.equal(
    silentOrchestrator({
      record: {
        schema_version: 1,
        woke_at: '2026-11-16T10:10:00.000Z',
        heard_at: '2026-11-16T10:12:00.000Z',
      },
      lease,
      now,
    }),
    null,
  );
  // Within the limit: the turn may still be running.
  assert.equal(
    silentOrchestrator({
      record: { schema_version: 1, woke_at: '2026-11-16T10:10:00.000Z' },
      lease,
      now,
      afterSeconds: 3600,
    }),
    null,
  );
  // The lease renewed after the last message: work recorded, then no message.
  const w = silentOrchestrator({
    record: { schema_version: 1, heard_at: '2026-11-16T09:00:00.000Z' },
    lease,
    now,
  });
  assert.match(
    String(w?.why),
    /recorded work at 2026-11-16T10:00:00.000Z .*last heard 2026-11-16T09:00:00.000Z/,
  );
});

test('the watch reports an orchestrator whose turn ended with no message to the chief of staff', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start', '--harness-ref', 'session_orch']);
  const cos = { HITLD_SESSION: 'cos' };

  // Without the chief of staff's record, nothing is judged.
  c.at(5000);
  assert.equal((await c.hitld(['dispatch', 'watch'], cos)).result.orchestrator_silent, undefined);

  // The chief of staff wakes the orchestrator and records it.
  c.at(5010);
  const woke = await c.hitld(['run', 'woke', '--to', 'session_orch'], cos);
  assert.equal(woke.exit, 0, JSON.stringify(woke.result));
  assert.equal(woke.result.messages.woke_to, 'session_orch');

  // Its turn may still run: within the limit, no flag.
  c.at(5500);
  const early = await c.hitld(['dispatch', 'watch'], cos);
  assert.equal(early.result.orchestrator_silent, undefined);
  assert.equal(early.result.wake, false);

  // Past the limit with no message heard: the turn ended without one, and the check-in says so.
  c.at(6000);
  const late = await c.hitld(['dispatch', 'watch'], cos);
  assert.equal(late.result.orchestrator_silent.session, 'session_orch');
  assert.equal(late.result.wake, true);
  assert.match(
    late.result.wake_message,
    /^watch: no message from you since .*: send your end-of-turn message to the chief of staff$/,
  );

  // Its message arrives and the chief of staff records it: no flag.
  c.at(6100);
  assert.equal((await c.hitld(['run', 'heard', '--from', 'session_orch'], cos)).exit, 0);
  c.at(8000);
  assert.equal((await c.hitld(['dispatch', 'watch'], cos)).result.orchestrator_silent, undefined);

  // It records work afterwards (a checkpoint renews the lease) and sends nothing: flagged again.
  c.at(8100);
  assert.equal((await c.hitld(['run', 'checkpoint'])).exit, 0);
  c.at(9100);
  const worked = await c.hitld(['dispatch', 'watch'], cos);
  assert.match(worked.result.orchestrator_silent.why, /recorded work/);

  // The record is the chief of staff's: an executor is refused.
  const refused = await c.hitld(['run', 'heard'], {
    HITLD_ROLE: 'executor',
    HITLD_DISPATCH: 'D-9',
  });
  assert.equal(refused.result.error, 'not-permitted');
});

test('repeated silence goes to the owner: the third unanswered wake sets escalate_to_owner, a message heard resets it', async () => {
  const c = clocked();
  c.status(10, 72000);
  await c.hitld(['run', 'start', '--harness-ref', 'session_orch']);
  const cos = { HITLD_SESSION: 'cos' };
  /** Wake at `t`, and read the watch past the quiet limit. @param {number} t */
  const wakeThenWatch = async (t) => {
    c.at(t);
    assert.equal((await c.hitld(['run', 'woke', '--to', 'session_orch'], cos)).exit, 0);
    c.at(t + 1000);
    return (await c.hitld(['dispatch', 'watch'], cos)).result.orchestrator_silent;
  };

  const first = await wakeThenWatch(1000);
  assert.equal(first.wakes_since_heard, 1);
  assert.equal(first.escalate_to_owner, false);
  const second = await wakeThenWatch(3000);
  assert.equal(second.wakes_since_heard, 2);
  assert.equal(second.escalate_to_owner, false, 'two wakes: not yet');
  const third = await wakeThenWatch(5000);
  assert.equal(third.wakes_since_heard, 3);
  assert.equal(third.escalate_after_wakes, 3);
  assert.equal(third.escalate_to_owner, true, 'three wakes: the owner is told');

  // A message heard resets the count; the next silence starts again from one wake.
  c.at(6100);
  const heard = await c.hitld(['run', 'heard', '--from', 'session_orch'], cos);
  assert.equal(heard.result.messages.wakes_since_heard, 0);
  const again = await wakeThenWatch(7000);
  assert.equal(again.wakes_since_heard, 1);
  assert.equal(again.escalate_to_owner, false);
});
