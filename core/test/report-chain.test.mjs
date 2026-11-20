// Every executor reports up the chain (HITLD-147): `hitld dispatch` writes the communication block
// into the brief of an executor that reports by message, naming the orchestrator's own session;
// `dispatch start` refuses one whose brief would lack it; and `dispatch watch` lists an interactive
// session that ended its turn with no report, to chase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasReportBlock,
  renderBrief,
  reportBlock,
  reportsByMessage,
} from '../lib/dispatch/brief.mjs';
import { watchDispatches } from '../lib/dispatch/watch.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { join } from 'node:path';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer } from './orchestrator-fixture.mjs';

/** A consumer with one tier-3 item and a run started by session `orch-session`. */
async function consumer() {
  const c = makeConsumer({
    policy: { execution: { max_executors: { value: 4 } } },
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/redesign.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const started = await c.hitld(['run', 'start'], { env: { HITLD_SESSION: 'orch-session' } });
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  const ledger = () => readLedger(openStore(join(c.data, 'human-in-the-lead/orch-fixture'))).events;
  return { c, ledger };
}

test('only an executor that reports by message gets the block', () => {
  assert.equal(reportsByMessage({ tier: 3, mode: 'interactive' }), true);
  assert.equal(reportsByMessage({ tier: 3, mode: 'headless' }), false);
  assert.equal(reportsByMessage({ tier: 2, mode: null }), false);
  const block = reportBlock('session_abc');
  assert.match(block, /^Report up the chain: the orchestrator is session session_abc\. /);
  assert.match(block, /last act of every turn is to send it your report in the fixed shape/);
  assert.match(block, /or your exact blocker/);
  assert.match(block, /even when nothing changed/);
  assert.equal(hasReportBlock(`x\n${block}\n`, 'session_abc'), true);
  assert.equal(hasReportBlock(`x\n${block}\n`, 'session_other'), false, 'it names this session');
});

test('renderBrief writes the block only when given the session to report to', () => {
  const r = {
    item: { id: 'W-1', title: 'x', path: 'work/items/W-1-x.md' },
    sizing: /** @type {any} */ ({ areas: [], estimate_tokens: 100_000, owner_review: null }),
    dispatch: 'D-1',
    branch: 'hitld/W-1-x',
    policy: { project: { id: 'p' } },
    isolation: /** @type {const} */ ('none'),
  };
  const plain = renderBrief(r);
  assert.equal(hasReportBlock(plain, 'orch'), false);
  assert.doesNotMatch(plain, /Report up the chain/);
  const withBlock = renderBrief({ ...r, reportTo: 'orch' });
  assert.equal(hasReportBlock(withBlock, 'orch'), true);
  assert.match(withBlock.trimEnd().split('\n').at(-1) ?? '', /^Report up the chain/, 'it is last');
});

test('dispatch start writes the block naming the session its commands use, not one pasted in', async () => {
  const { c } = await consumer();
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive'], {
    env: { HITLD_SESSION: 'orch-session' },
  });
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.equal(start.result.instruction.tool, 'session');
  const brief = readFileSync(start.result.brief_file, 'utf8');
  assert.equal(hasReportBlock(brief, 'orch-session'), true, brief);
  // The flag names the session too, as for every other command.
  const { c: other } = await consumer();
  const flagged = await other.hitld(
    ['dispatch', 'start', 'W-4', '--mode', 'interactive', '--session', 'orch-session'],
    { env: { HITLD_SESSION: '' } },
  );
  assert.equal(flagged.exit, 0, JSON.stringify(flagged.result));
  assert.equal(
    hasReportBlock(readFileSync(flagged.result.brief_file, 'utf8'), 'orch-session'),
    true,
  );
});

test('a headless or subagent dispatch gets no block: its harness channel carries the report', async () => {
  const { c } = await consumer();
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'headless'], {
    env: { HITLD_SESSION: 'orch-session' },
  });
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.doesNotMatch(readFileSync(start.result.brief_file, 'utf8'), /Report up the chain/);
});

test('dispatch start refuses an interactive executor whose brief would lack the block', async () => {
  const { c, ledger } = await consumer();
  const before = ledger().length;
  // No --session, no $HITLD_SESSION, no harness ID: only the run's record names this session.
  const refused = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive'], {
    env: { HITLD_SESSION: '' },
  });
  assert.notEqual(refused.exit, 0);
  assert.equal(refused.result.error, 'no-report-block', JSON.stringify(refused.result));
  assert.match(refused.result.message, /communication block/);
  assert.match(refused.result.message, /--session/);
  assert.equal(ledger().length, before, 'nothing is recorded for a refused start');
});

/** An interactive dispatch in flight, as the watch sees it. */
function inFlight() {
  const t = 1_800_000_000_000;
  const at = (/** @type {number} */ s) => new Date(t + s * 1000).toISOString();
  const entry = {
    dispatch: 'D-1',
    item: 'W-1',
    tier: 3,
    mode: /** @type {'interactive' | 'headless'} */ ('interactive'),
    harness: 'claude-code',
    harness_ref: 'session_exec',
    host: 'orchestrator-host',
    worktree: null,
    branch: 'hitld/W-1-x',
    serial_resources: [],
    started_at: at(0),
  };
  const events = [
    { id: 'E-1', event: 'dispatched', dispatch: 'D-1', item: 'W-1', tier: 3, at: at(0) },
  ];
  return { t, entry, events };
}

test('the watch lists an interactive session that ended with no report, by reference or dispatch', () => {
  const { t, entry, events } = inFlight();
  /** @param {Set<string>} ended @param {Partial<typeof entry>} [over] */
  const judge = (ended, over = {}) =>
    watchDispatches({
      inFlight: [/** @type {any} */ ({ ...entry, ...over })],
      events: /** @type {any} */ (events),
      signals: () => [],
      policy: {},
      now: t + 60_000,
      host: 'chief-of-staff-host',
      ended,
    })[0];
  const byRef = judge(new Set(['session_exec']));
  assert.equal(byRef.state, 'unreported', 'whatever host the watch runs on');
  assert.equal(byRef.step, null, 'it is chased, not put on the ladder');
  assert.equal(judge(new Set(['D-1'])).state, 'unreported');
  assert.equal(judge(new Set()).state, 'foreign', 'no word from the harness: as before');
  assert.notEqual(
    judge(new Set(['session_exec']), { mode: 'headless' }).state,
    'unreported',
    'only an interactive session',
  );
});

test('dispatch watch --ended: an interactive dispatch whose session ended with no report is chased', async () => {
  const { c } = await consumer();
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive'], {
    env: { HITLD_SESSION: 'orch-session' },
  });
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const handled = await c.hitld(
    ['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'session_exec'],
    { env: { HITLD_SESSION: 'orch-session' } },
  );
  assert.equal(handled.exit, 0, JSON.stringify(handled.result));
  const cos = { env: { HITLD_SESSION: 'cos' } };

  const running = await c.hitld(['dispatch', 'watch'], cos);
  assert.equal(running.exit, 0, JSON.stringify(running.result));
  assert.equal(running.result.unreported, undefined, 'a running session is not chased');

  const watch = await c.hitld(['dispatch', 'watch', '--ended', 'session_other, session_exec'], cos);
  assert.equal(watch.exit, 0, JSON.stringify(watch.result));
  assert.equal(watch.result.unreported.length, 1);
  const [u] = watch.result.unreported;
  assert.deepEqual([u.dispatch, u.item, u.harness_ref], ['D-1', 'W-4', 'session_exec']);
  assert.match(u.next, /read the final state of session session_exec/);
  assert.match(u.next, /relay it to the orchestrator as reported D-1/);
  assert.match(u.next, /Do not wait/);
  assert.match(u.report_request, /Send it now to the orchestrator's session your brief names/);
  assert.match(watch.result.next, /^chase each dispatch in unreported yourself/);
  assert.equal(
    watch.result.dispatches.find((/** @type {any} */ d) => d.dispatch === 'D-1').state,
    'unreported',
  );
});
