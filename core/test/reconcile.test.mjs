// The reconcile pass (HITLD-779, HITLD-780): completions recorded from what can be observed, the
// executor's closing commit with its report and the harness showing it ended, once, whichever
// orchestrator runs the pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { parseClosing, withCommit } from '../lib/dispatch/reconcile.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

/** One turn's result as a cloud session's event list returns it. */
const turn = (/** @type {{ at: string, output: number, write: number, text: string }} */ t) => ({
  created_at: t.at,
  result: {
    uuid: `u-${t.at}`,
    envelope: {
      subtype: 'success',
      is_error: false,
      duration_ms: 60000,
      result: t.text,
      session_id: 'sess-x',
      total_cost_usd: 1,
      usage: {
        input_tokens: 0,
        output_tokens: t.output,
        cache_creation_input_tokens: t.write,
        cache_read_input_tokens: 5e6,
      },
    },
  },
});

const ITEMS = ['W-4', 'W-5', 'W-6', 'W-7', 'W-8'];

/** A consumer with five tier-3 items, a run started, and each dispatched in the mode given. */
async function setUp() {
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 6 } } },
    files: Object.fromEntries(
      ITEMS.map((id) => [
        `work/items/${id}-change.md`,
        item({
          id,
          title: `change ${id}`,
          kind: 'work',
          state: 'planned',
          tier_override: '3',
          touches: [`src/${id.toLowerCase()}.js`],
        }),
      ]),
    ),
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const started = await c.hitld(['run', 'start']);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  /** @type {Record<string, { dispatch: string, branch: string, ref: string, worktree: string }>} */
  const by = {};
  const modes = { 'W-4': 'interactive', 'W-5': 'interactive', 'W-6': 'interactive' };
  for (const id of ITEMS) {
    const mode = /** @type {Record<string, string>} */ (modes)[id] ?? 'headless';
    const start = await c.hitld(['dispatch', 'start', id, '--mode', mode]);
    assert.equal(start.exit, 0, `${id} ${JSON.stringify(start.result)}`);
    const ref = `session-${id}`;
    await c.hitld([
      'dispatch',
      'handle',
      '--dispatch',
      start.result.dispatch,
      '--harness-ref',
      ref,
    ]);
    by[id] = {
      dispatch: start.result.dispatch,
      branch: start.result.branch,
      ref,
      worktree: start.result.worktree,
    };
  }
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const ledger = () => readLedger(store).events;
  /**
   * Commit in a dispatch's worktree, on its branch: a code change, then the closing commit.
   * @param {string} id @param {{ dispatch?: string, body?: string | null }} [o]
   */
  const close = (id, o = {}) => {
    const { branch, dispatch, worktree } = by[id];
    put(worktree, { [`src/${id.toLowerCase()}.js`]: 'export const x = 1;\n' });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `work on ${id}`);
    const body =
      o.body === undefined ? report({ item: id, sha: 'none', branch }).trim() : (o.body ?? '');
    const message = [
      `close: ${id}`,
      ...(body ? ['', body] : []),
      '',
      `Work-Item: ${id}\nDispatch: ${o.dispatch ?? dispatch}`,
    ].join('\n');
    git(worktree, 'commit', '-q', '--allow-empty', '-m', message);
    return git(worktree, 'rev-parse', 'HEAD');
  };
  return { c, by, store, ledger, close };
}

test('a closing commit: its item, its dispatch trailer and the report in its body', () => {
  const msg = `close: W-4\n\n${report({ item: 'W-4', sha: 'abc1234', branch: 'b' }).trim()}\n\nWork-Item: W-4\nDispatch: D-9\nSigned-off-by: A <a@b>`;
  const c = parseClosing(msg);
  assert.equal(c.item, 'W-4');
  assert.equal(c.dispatch, 'D-9');
  assert.match(/** @type {string} */ (c.report), /^item: W-4\n/);
  assert.doesNotMatch(/** @type {string} */ (c.report), /Dispatch:/);
  // The close commit `hitld work close` makes today carries no report.
  assert.equal(parseClosing('close: W-4\n\nWork-Item: W-4\nDispatch: D-9').report, null);
  assert.equal(parseClosing('work on W-4').item, null);
  // The commit line names the head it was read from; none stays none.
  assert.match(
    withCommit('item: W\ncommit: abc (branch x)\n', 'f00', 'x'),
    /^commit: f00 \(branch x\)$/m,
  );
  assert.match(withCommit('commit: none\n', 'f00', 'x'), /^commit: none$/m);
});

test('reconcile records an ended executor from its closing commit, once, and shows the rest with evidence', async () => {
  const { c, by, ledger, close } = await setUp();
  const w4 = by['W-4'];
  const since = /** @type {string} */ (
    ledger().find((e) => e.event === 'dispatched' && e.dispatch === w4.dispatch)?.at
  );
  // W-4 completed: its closing commit carries its report, its session ended.
  const head4 = close('W-4');
  const record = join(c.base, 'record-w4.json');
  writeFileSync(
    record,
    JSON.stringify({
      ccr: {
        data: [
          turn({
            at: new Date(Date.parse(since) + 60_000).toISOString(),
            output: 20_000,
            write: 30_000,
            text: 'the last message, which is not the report',
          }),
        ],
        has_more: false,
      },
    }),
  );
  // W-5 ended with no report: its branch has work, but its close commit carries none.
  close('W-5', { body: null });
  // W-6: the report on its branch is for a different dispatch.
  close('W-6', { dispatch: 'D-999' });
  // W-7, headless: its process is gone without a result and its branch has no report.
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  store.write(`dispatch/pids/${by['W-7'].dispatch}.pid`, String(gone));
  // W-8, headless: alive (this test's own process) and quiet.
  store.write(`dispatch/pids/${by['W-8'].dispatch}.pid`, String(process.pid));

  const ended = [w4.ref, by['W-5'].ref, by['W-6'].ref].join(',');
  const pass = await c.hitld([
    'dispatch',
    'reconcile',
    '--ended',
    ended,
    '--session-record',
    `${w4.dispatch}=${record}`,
  ]);
  assert.equal(pass.exit, 0, JSON.stringify(pass.result));
  const state = Object.fromEntries(
    pass.result.dispatches.map((/** @type {any} */ d) => [d.item, d]),
  );
  assert.equal(state['W-4'].state, 'complete');
  assert.equal(state['W-4'].recorded, true, JSON.stringify(state['W-4']));
  assert.equal(state['W-4'].completion.result, 'done');
  assert.equal(state['W-4'].completion.queued_to_merge, w4.branch);
  assert.equal(state['W-4'].completion.tokens.source, 'session-record');
  assert.equal(state['W-4'].completion.tokens.recorded, 50_000, 'from the harness record');
  assert.equal(state['W-5'].state, 'unreported');
  assert.match(state['W-5'].why, /carries no report/);
  assert.ok(state['W-5'].report_request);
  assert.equal(state['W-6'].state, 'unreported', 'a report for another dispatch is not its own');
  assert.match(state['W-6'].why, /for D-999, not /);
  assert.equal(state['W-6'].evidence.heads[0].dispatch, 'D-999');
  assert.equal(state['W-7'].state, 'dead');
  assert.deepEqual(state['W-7'].evidence.process, { alive: false, output_bytes: 0 });
  assert.equal(state['W-8'].state, 'running');
  assert.equal(state['W-8'].evidence.process.alive, true);
  assert.equal(typeof state['W-8'].evidence.quiet_seconds, 'number');
  assert.deepEqual(pass.result.recorded, [w4.dispatch]);

  const reported = ledger().filter((e) => e.event === 'reported');
  assert.equal(reported.length, 1);
  assert.equal(reported[0].dispatch, w4.dispatch);
  assert.equal(reported[0].commit, head4, 'the head the report was read from');
  assert.equal(reported[0].tokens, 50_000);
  assert.equal(reported[0].tokens_source, 'session-record');
  // Nothing was done to the others: no stall, no abandonment.
  assert.equal(ledger().filter((e) => ['stalled', 'abandoned'].includes(e.event)).length, 0);

  // A repeat pass records nothing: W-4 is no longer in flight.
  const again = await c.hitld([
    'dispatch',
    'reconcile',
    '--ended',
    ended,
    '--session-record',
    `${w4.dispatch}=${record}`,
  ]);
  assert.equal(again.exit, 0, JSON.stringify(again.result));
  assert.deepEqual(again.result.recorded, []);
  assert.equal(
    again.result.dispatches.some((/** @type {any} */ d) => d.item === 'W-4'),
    false,
  );
  assert.equal(ledger().filter((e) => e.event === 'reported').length, 1);
  // And dispatch complete, given the same dispatch, answers already.
  const twice = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    w4.dispatch,
    '--report-file',
    record,
  ]);
  assert.equal(twice.result.already, true, JSON.stringify(twice.result));
});

test('an old and a new orchestrator: the one without the lease records nothing, and the new one records each completion once', async () => {
  const { c, by, ledger, close } = await setUp();
  close('W-5');
  // Its report is on its branch, and its session still runs: it waits for it to end.
  const early = await c.hitld(['dispatch', 'reconcile']);
  const w5early = early.result.dispatches.find((/** @type {any} */ d) => d.item === 'W-5');
  assert.equal(w5early.state, 'closing', JSON.stringify(w5early));
  assert.deepEqual(early.result.recorded, []);
  // A new orchestrator takes the run over.
  const next = { env: { HITLD_SESSION: 'new-session' } };
  const taken = await c.hitld(['run', 'resume', '--force'], next);
  assert.equal(taken.exit, 0, JSON.stringify(taken.result));
  const args = ['dispatch', 'reconcile', '--ended', by['W-5'].ref];
  // The old one still runs a pass: it sees the completion and records nothing.
  const old = await c.hitld(args);
  assert.equal(old.exit, 0, JSON.stringify(old.result));
  assert.equal(old.result.holds_lease, false);
  const w5 = old.result.dispatches.find((/** @type {any} */ d) => d.item === 'W-5');
  // An interactive session's tokens come from its record: given none, it waits for it.
  assert.equal(w5.state, 'awaiting_record');
  assert.match(w5.next, /--session-record/);

  // A background-style completion that needs no record: a headless run that ended with output.
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const w7 = by['W-7'];
  close('W-7');
  store.write(
    `dispatch/pids/${w7.dispatch}.pid`,
    String(spawnSync(process.execPath, ['-e', '0']).pid),
  );
  store.write(
    `dispatch/results/${w7.dispatch}.json`,
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'the run ended',
      usage: { input_tokens: 10, output_tokens: 1000, cache_creation_input_tokens: 2000 },
    }),
  );
  const oldPass = await c.hitld(args);
  const w7old = oldPass.result.dispatches.find((/** @type {any} */ d) => d.item === 'W-7');
  assert.equal(w7old.state, 'complete');
  assert.equal(w7old.recorded, false, 'only the session holding the lease records');
  assert.equal(ledger().filter((e) => e.event === 'reported').length, 0);

  const newPass = await c.hitld(args, next);
  assert.equal(newPass.exit, 0, JSON.stringify(newPass.result));
  assert.deepEqual(newPass.result.recorded, [w7.dispatch]);
  const e = ledger().filter((x) => x.event === 'reported');
  assert.equal(e.length, 1);
  assert.equal(e[0].tokens, 3010, "from the headless run's result");
  assert.equal(e[0].tokens_source, 'result-file');
  // Both orchestrators again: nothing more.
  await c.hitld(args);
  await c.hitld(args, next);
  assert.equal(ledger().filter((x) => x.event === 'reported').length, 1);
});
