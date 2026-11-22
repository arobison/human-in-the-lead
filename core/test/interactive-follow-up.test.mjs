// A follow-up to an interactive executor is a dispatch of its own (HITLD-739). The chief of staff
// relays it to the session, so it needs no worktree, result file or process ID of its own. The
// executor's second report is completed under the new dispatch and queues its branch for the merge.
// A refused follow-up records nothing, so no dispatch is left holding an executor slot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { hasReportBlock } from '../lib/dispatch/brief.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer, report } from './orchestrator-fixture.mjs';

const ORCH = { env: { HITLD_SESSION: 'orch-session' } };

/** One turn of a cloud session's event list of kind result. @param {string} at @param {string} uuid @param {string} text */
const turn = (at, uuid, text) => ({
  created_at: at,
  result: {
    uuid,
    envelope: {
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      result: text,
      session_id: 'sess-x',
      total_cost_usd: 0.5,
      usage: {
        input_tokens: 10,
        output_tokens: uuid === 't1' ? 1000 : 3000,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 50_000,
      },
    },
  },
});

/** A consumer with one tier-3 item, a run started by `orch-session`, and the item dispatched. @param {'interactive' | 'headless'} mode */
async function dispatched(mode) {
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
  assert.equal((await c.hitld(['run', 'start'], ORCH)).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', mode], ORCH);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const d = String(start.result.dispatch);
  const handled = await c.hitld(
    ['dispatch', 'handle', '--dispatch', d, '--harness-ref', 'session_exec'],
    ORCH,
  );
  assert.equal(handled.exit, 0, JSON.stringify(handled.result));
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const ledger = () => readLedger(store).events;
  return { c, d, start, store, ledger };
}

/** Commit a change on the dispatch's branch in its worktree. @param {string} cwd @param {string} state */
function commit(cwd, state) {
  writeFileSync(join(cwd, 'src/redesign.js'), `export const state = '${state}';\n`);
  writeFileSync(
    join(cwd, 'work/items/W-4-redesign.md'),
    item({
      id: 'W-4',
      title: 'redesign',
      kind: 'work',
      state: state === 'done' ? 'done' : 'planned',
      tier_override: '3',
      touches: ['src/redesign.js'],
    }),
  );
  const g = (/** @type {string[]} */ ...a) =>
    execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  g('add', '-A');
  g('commit', '-q', '-m', `W-4 ${state}`);
  return g('rev-parse', 'HEAD');
}

test('an interactive dispatch completed as partial is followed up as a new dispatch, and its second report reaches the merge queue', async () => {
  const { c, d, start, ledger } = await dispatched('interactive');
  const branch = String(start.result.branch);
  const worktree = String(start.result.worktree);
  const oldSince = Date.parse(
    /** @type {string} */ (ledger().find((e) => e.event === 'dispatched' && e.dispatch === d)?.at),
  );

  // The first report: partial. It is recorded, and the branch does not go to the merge.
  const sha1 = commit(worktree, 'partial');
  const first = join(c.base, 'first.txt');
  writeFileSync(first, report({ item: 'W-4', sha: sha1, branch, result: 'partial' }));
  const partial = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d, '--report-file', first, '--tokens', '4000'],
    ORCH,
  );
  assert.equal(partial.exit, 0, JSON.stringify(partial.result));
  assert.equal(partial.result.result, 'partial');
  assert.equal(partial.result.queued_to_merge, undefined, 'a partial report is not queued');
  const again = await c.hitld(['dispatch', 'complete', '--dispatch', d, '--report-file', first]);
  assert.equal(again.result.already, true, 'a dispatch completed once is not completed again');
  assert.equal(again.result.continued_as, undefined, 'no follow-up yet');

  // The follow-up: a new dispatch on the same session, relayed, with nothing of its own on disk.
  const follow = await c.hitld(
    ['dispatch', 'follow-up', '--dispatch', d, '--message', 'Finish the redesign.'],
    ORCH,
  );
  assert.equal(follow.exit, 0, JSON.stringify(follow.result));
  const d2 = String(follow.result.dispatch);
  assert.notEqual(d2, d);
  assert.equal(follow.result.follows, d);
  assert.equal(follow.result.instruction.tool, 'relay');
  assert.equal(follow.result.instruction.input.session, 'session_exec');
  assert.equal(follow.result.instruction.input.dispatch, d2);
  const message = String(follow.result.instruction.input.message);
  assert.match(message, /^Finish the redesign\./);
  assert.ok(
    message.includes(`This is dispatch ${d2}: prefix hitld commands with HITLD_DISPATCH=${d2} `),
  );
  assert.equal(hasReportBlock(message, 'orch-session'), true, 'it names where to report');
  assert.ok(String(follow.result.then).includes(`complete it as ${d2}, not ${d}`));
  const recorded = ledger().filter((e) => e.dispatch === d2);
  assert.deepEqual(
    recorded.map((e) => e.event),
    ['dispatched', 'started'],
  );
  assert.equal(recorded[0].mode, 'interactive');
  assert.equal(recorded[0].branch, branch);
  assert.equal(recorded[1].harness_ref, 'session_exec');

  // The earlier dispatch now names its follow-up, where the second report lands.
  const named = await c.hitld(['dispatch', 'complete', '--dispatch', d, '--report-file', first]);
  assert.equal(named.result.already, true);
  assert.equal(named.result.continued_as, d2);
  assert.match(named.result.next, new RegExp(`hitld dispatch complete --dispatch ${d2}$`));

  // A record with no turn since the follow-up started does not hand back the earlier report.
  const sha2 = commit(worktree, 'done');
  const earlier = turn(
    new Date(oldSince + 1).toISOString(),
    't1',
    report({ item: 'W-4', sha: sha1, branch, result: 'partial' }),
  );
  const stale = join(c.base, 'stale.json');
  writeFileSync(stale, JSON.stringify({ ccr: { data: [earlier], has_more: false } }));
  const refused = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d2, '--session-record', stale],
    ORCH,
  );
  assert.notEqual(refused.exit, 0, JSON.stringify(refused.result));
  assert.equal(
    ledger().some((e) => e.event === 'reported' && e.dispatch === d2),
    false,
    'the earlier report is not recorded as the follow-up',
  );

  // The second report, in the session's record after the follow-up started: done, and queued.
  const since2 = Date.parse(/** @type {string} */ (recorded[0].at));
  const later = turn(
    new Date(since2 + 60_000).toISOString(),
    't2',
    report({ item: 'W-4', sha: sha2, branch }),
  );
  const record = join(c.base, 'record.json');
  writeFileSync(record, JSON.stringify({ ccr: { data: [earlier, later], has_more: false } }));
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d2, '--session-record', record],
    ORCH,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.result, 'done', 'the second report, not the first');
  assert.equal(done.result.queued_to_merge, branch);
  assert.equal(done.result.tokens.turns, 1, 'only the turns since the follow-up started');
  const reported = ledger().filter((e) => e.event === 'reported');
  assert.deepEqual(
    reported.map((e) => [e.dispatch, e.result]),
    [
      [d, 'partial'],
      [d2, 'done'],
    ],
  );
  const merged = await c.hitld(['merge'], ORCH);
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.deepEqual(merged.result.merged, ['W-4']);
});

test('a follow-up refused for its kind records nothing and holds no executor slot', async () => {
  // A headless dispatch that never wrote its result: its run has no session ID to resume.
  const { c, d, ledger } = await dispatched('headless');
  const note = join(c.base, 'note.txt');
  writeFileSync(
    note,
    report({ item: 'W-4', sha: 'abc1234', branch: 'hitld/W-4-redesign', result: 'partial' }),
  );
  const partial = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d, '--report-file', note, '--tokens', '4000'],
    ORCH,
  );
  assert.equal(partial.exit, 0, JSON.stringify(partial.result));
  const before = ledger().length;
  const inFlight = async () => (await c.hitld(['run', 'status'], ORCH)).result;
  const statusBefore = JSON.stringify(await inFlight());
  const refused = await c.hitld(
    ['dispatch', 'follow-up', '--dispatch', d, '--message', 'Finish it.'],
    ORCH,
  );
  assert.notEqual(refused.exit, 0, JSON.stringify(refused.result));
  assert.equal(refused.result.error, 'cannot-follow-up');
  assert.match(refused.result.message, /Nothing was recorded/);
  assert.equal(ledger().length, before, 'no dispatched or started event');
  assert.equal(JSON.stringify(await inFlight()), statusBefore, 'nothing in flight');
});

test('an interactive follow-up without a session to report to is refused before anything is recorded', async () => {
  const { c, d, start, ledger } = await dispatched('interactive');
  const note = join(c.base, 'note.txt');
  writeFileSync(
    note,
    report({ item: 'W-4', sha: 'abc1234', branch: String(start.result.branch), result: 'partial' }),
  );
  await c.hitld(
    ['dispatch', 'complete', '--dispatch', d, '--report-file', note, '--tokens', '4000'],
    ORCH,
  );
  const before = ledger().length;
  // The session only the run's record holds: no address the harness can send to.
  const refused = await c.hitld(
    ['dispatch', 'follow-up', '--dispatch', d, '--message', 'Finish it.'],
    { env: { HITLD_SESSION: '' } },
  );
  assert.notEqual(refused.exit, 0, JSON.stringify(refused.result));
  assert.equal(refused.result.error, 'no-report-block', JSON.stringify(refused.result));
  assert.equal(ledger().length, before, 'nothing is recorded');
});
