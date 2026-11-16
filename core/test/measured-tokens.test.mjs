// A completion's tokens are measured from the harness's own record, and an executor's own figure
// is kept apart as a guess (HITLD-438).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  headlessCompletion,
  jsonValues,
  selfReportedTokens,
  sessionRecordCompletion,
  subagentCompletion,
  usageFromNotification,
} from '../harness/claude-code/completion.mjs';
import { completionOf } from '../harness/claude-code/adapter.mjs';
import { reportedEvent } from '../lib/run/protocol.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { summarize } from '../lib/ledger/summary.mjs';
import { estimateTokens, historyFromLedger, measuredFirst } from '../lib/dispatch/sizing.mjs';
import { tokensPerItem } from '../lib/quota/report.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { STATUS_INPUT, item, makeConsumer, report } from './orchestrator-fixture.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';

/**
 * One turn's result as a cloud session's event list returns it: an event with its time, the result
 * message inside an envelope.
 * @param {{ at: string, uuid: string, input?: number, output: number, write: number, read: number,
 *   cost: number, text?: string, breakdown?: boolean }} t
 */
const turn = (t) => {
  const usage = {
    input_tokens: t.input ?? 0,
    output_tokens: t.output,
    cache_creation_input_tokens: t.write,
    cache_read_input_tokens: t.read,
  };
  return {
    created_at: t.at,
    result: {
      uuid: t.uuid,
      envelope: {
        subtype: 'success',
        is_error: false,
        duration_ms: 60000,
        result: t.text ?? 'working',
        session_id: 'sess-x',
        total_cost_usd: t.cost,
        usage,
        ...(t.breakdown === false
          ? {}
          : {
              model_usage_since_last_result: {
                large: {
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens,
                  cacheCreationInputTokens: usage.cache_creation_input_tokens,
                  cacheReadInputTokens: usage.cache_read_input_tokens,
                  costUSD: t.cost,
                },
              },
            }),
      },
    },
  };
};

/** An event-list page, as the tool returns it. @param {unknown[]} data */
const page = (data) => ({ ccr: { data, has_more: false } });

// --- The readers ------------------------------------------------------------------------------

test('a session record: the turns since the dispatch started, with cache reads and cost apart', () => {
  const before = turn({
    at: '2026-11-16T09:00:00Z',
    uuid: 'u0',
    output: 999,
    write: 999,
    read: 999,
    cost: 9,
  });
  const one = turn({
    at: '2026-11-16T10:30:00Z',
    uuid: 'u1',
    input: 100,
    output: 20_000,
    write: 80_000,
    read: 6_000_000,
    cost: 2.5,
  });
  const two = turn({
    at: '2026-11-16T11:00:00Z',
    uuid: 'u2',
    input: 84,
    output: 32_284,
    write: 86_519,
    read: 10_453_592,
    cost: 3.1692864,
    text: 'item: W-1\nresult: done',
  });
  // Two pages that overlap, saved to one file round the tool's own wrapper text.
  const text = `<record>\n${JSON.stringify(page([before, one]), null, 2)}\n${JSON.stringify(page([one, two]))}\n</record>`;
  const c = sessionRecordCompletion(text, { since: '2026-11-16T10:00:00Z' });
  assert.equal(c.tokensSource, 'session-record');
  assert.equal(c.turns, 2, 'the turn before the dispatch started is left out; u1 counts once');
  assert.deepEqual(c.parts, {
    input_tokens: 184,
    output_tokens: 52_284,
    cache_write_tokens: 166_519,
    cache_read_tokens: 16_453_592,
    cost_usd: 5.6693,
  });
  // Output plus fresh input; the 16M cache reads are not a cost.
  assert.equal(c.usage?.tokens, 184 + 52_284 + 166_519);
  assert.equal(c.usage?.durationMs, 120_000);
  assert.equal(c.report, 'item: W-1\nresult: done', "the last turn's final message");

  // Without a per-turn breakdown, several turns give no cost: total_cost_usd may add up the turns
  // before it. One turn's is its own.
  const plain = (/** @type {any} */ t) => turn({ ...t, breakdown: false });
  const several = sessionRecordCompletion(
    JSON.stringify(
      page([
        plain({ at: '2026-11-16T10:30:00Z', uuid: 'a', output: 1, write: 2, read: 3, cost: 1 }),
        plain({ at: '2026-11-16T10:40:00Z', uuid: 'b', output: 1, write: 2, read: 3, cost: 2 }),
      ]),
    ),
  );
  assert.equal(several.parts?.cost_usd, null);
  assert.equal(several.usage?.tokens, 6);
  const single = sessionRecordCompletion(
    JSON.stringify(
      plain({ at: '2026-11-16T10:30:00Z', uuid: 'a', output: 1, write: 2, read: 3, cost: 0.25 }),
    ),
  );
  assert.equal(single.parts?.cost_usd, 0.25);

  // claude -p stream JSON: one message per line, the result among them.
  const stream = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [] } },
    {
      type: 'result',
      subtype: 'success',
      result: 'item: W-2',
      total_cost_usd: 0.4,
      usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 500 },
    },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n');
  const s = sessionRecordCompletion(stream);
  assert.deepEqual([s.usage?.tokens, s.parts?.cache_read_tokens, s.report], [7, 500, 'item: W-2']);

  assert.throws(() => sessionRecordCompletion('{"ccr":{"data":[]}}'), /holds no result message/);
  assert.throws(
    () =>
      sessionRecordCompletion(JSON.stringify(page([before])), { since: '2026-11-16T10:00:00Z' }),
    /no turn that ended after the dispatch started/,
  );
  assert.equal(jsonValues('a {"x": "}{"} b [1]').length, 2, 'brackets inside strings');
});

test('a headless result with large cache reads: they are kept apart, never counted', () => {
  const h = headlessCompletion(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'item: W-1',
      total_cost_usd: 1.2345678,
      usage: {
        input_tokens: 12,
        output_tokens: 8_000,
        cache_creation_input_tokens: 40_000,
        cache_read_input_tokens: 1_882_231,
      },
    }),
  );
  assert.equal(h.usage?.tokens, 48_012);
  assert.equal(h.tokensSource, 'result-file');
  assert.deepEqual(h.parts, {
    input_tokens: 12,
    output_tokens: 8_000,
    cache_write_tokens: 40_000,
    cache_read_tokens: 1_882_231,
    cost_usd: 1.2346,
  });
});

test("an executor's own figure is a guess: read apart, never as the notification's usage", () => {
  assert.equal(
    selfReportedTokens('  - tokens: self-reported, a guess: about 270k tokens'),
    270_000,
  );
  assert.equal(selfReportedTokens('I used roughly 1.2M tokens, under the 400k budget'), 1_200_000);
  assert.equal(selfReportedTokens('tokens: about 90,000 (my own guess)'), 90_000);
  assert.equal(selfReportedTokens('Budget: ~400k tokens'), null, 'the budget is not a guess');
  assert.equal(
    selfReportedTokens('my own guess: well under the 400k tokens budget'),
    null,
    'nor is a budget named beside one',
  );
  assert.equal(selfReportedTokens(report({ item: 'W-1', sha: 'abc1234', branch: 'b' })), null);

  // A `tokens:` line in the report is the executor's own words, not the harness's usage block.
  const said = `${report({ item: 'W-1', sha: 'abc1234', branch: 'b' })}tokens: 270000\n`;
  assert.equal(usageFromNotification(said), null);
  assert.equal(subagentCompletion({ text: said }).usage, null);
  const block = subagentCompletion({ text: `${said}<usage>total_tokens: 5000</usage>` });
  assert.deepEqual([block.usage?.tokens, block.tokensSource], [5000, 'notification']);
  // Typed by hand wins over the block, and says so.
  const typed = subagentCompletion({ text: said, usage: { tokens: 4200 } });
  assert.deepEqual([typed.usage?.tokens, typed.tokensSource], [4200, 'typed']);

  // The reported event keeps the guess apart from the measured figure.
  const c = completionOf('D-9', {
    kind: 'session',
    record: JSON.stringify(
      turn({
        at: '2026-11-16T10:30:00Z',
        uuid: 'r',
        output: 50_000,
        write: 150_000,
        read: 9_000_000,
        cost: 4,
        text: `${report({ item: 'W-1', sha: 'abc1234', branch: 'b' })}`.replace(
          '  - node --test test/: 1 passed',
          '  - node --test test/: 1 passed\n  - token use, self-reported, a guess: about 270k tokens',
        ),
      }),
    ),
  });
  const e = reportedEvent({ dispatch: 'D-9', item: 'W-1' }, c);
  assert.equal(e.tokens, 200_000);
  assert.equal(e.tokens_source, 'session-record');
  assert.equal(e.self_reported_tokens, 270_000);
  assert.deepEqual(e.usage, {
    input_tokens: 0,
    output_tokens: 50_000,
    cache_write_tokens: 150_000,
    cache_read_tokens: 9_000_000,
    cost_usd: 4,
  });
  const line = { ...e, schema_version: 2, at: '2026-11-16T11:00:00Z' };
  assert.deepEqual(schemas().validate('ledger-entry', line), []);
  // Only a completion carries them.
  assert.ok(
    schemas()
      .validate('ledger-entry', { ...line, usage: {} })
      .some((x) => /at least 1/.test(x.message)),
  );
});

// --- Who reads the figures --------------------------------------------------------------------

/** A finished executor dispatch on W-<n>, for summaries and estimates. */
const done = (
  /** @type {number} */ n,
  /** @type {number | null} */ tokens,
  /** @type {Record<string, any>} */ extra = {},
) => [
  {
    id: `dispatched-D-${n}`,
    event: 'dispatched',
    dispatch: `D-${n}`,
    item: `W-${n}`,
    tier: 2,
    role: 'executor',
    estimate_tokens: 100_000,
    at: `2026-11-16T10:${String(n).padStart(2, '0')}:00Z`,
  },
  {
    id: `reported-D-${n}`,
    event: 'reported',
    dispatch: `D-${n}`,
    item: `W-${n}`,
    result: 'done',
    tokens,
    estimate_tokens: 100_000,
    at: `2026-11-16T11:${String(n).padStart(2, '0')}:00Z`,
    ...extra,
  },
];

test('the summary, the quota report and the estimator never read the guess as a cost', () => {
  const events = [
    ...done(1, 200_000, { tokens_source: 'session-record', self_reported_tokens: 270_000 }),
    ...done(2, 90_000, { tokens_source: 'typed' }),
    // No measured or typed figure: the guess alone is no cost anywhere.
    ...done(3, null, { self_reported_tokens: 5_000_000 }),
    ...done(4, 50_000),
  ];
  const s = summarize(events);
  assert.deepEqual(s.estimate_vs_actual.sources, { measured: 1, typed: 1, unstated: 1 });
  assert.equal(s.estimate_vs_actual.median_ratio_measured, 2);
  const row = (/** @type {string} */ d) =>
    /** @type {Record<string, any>} */ (
      s.estimate_vs_actual.by_dispatch.find((/** @type {any} */ r) => r.dispatch === d)
    );
  assert.deepEqual(row('D-1'), {
    dispatch: 'D-1',
    item: 'W-1',
    estimate_tokens: 100_000,
    tokens: 200_000,
    tokens_source: 'session-record',
    ratio: 2,
    self_reported_tokens: 270_000,
  });
  assert.equal(row('D-3').tokens, null);
  assert.equal(row('D-3').ratio, null);
  assert.equal(row('D-3').self_reported_tokens, 5_000_000, 'shown beside, for comparison');
  const elsewhere = { ...s, estimate_vs_actual: { ...s.estimate_vs_actual, by_dispatch: [] } };
  assert.ok(!JSON.stringify(elsewhere).includes('5000000'), 'and counted nowhere');
  // The quota report (the digest's figures) counts what was measured or typed, never the guess.
  const perItem = tokensPerItem(events);
  assert.equal(perItem.get('W-3') ?? 0, 0);
  assert.equal(
    [...perItem.values()].reduce((a, b) => a + b, 0),
    340_000,
  );
  // The estimator's history: the guess is no figure, and a measured one says so.
  const history = historyFromLedger(events, (id) => ({ id, kind: 'work', area: 'core' }));
  assert.deepEqual(
    history.map((h) => [h.tokens, h.measured === true]),
    [
      [200_000, true],
      [90_000, false],
      [null, false],
      [50_000, false],
    ],
  );
});

test('the estimator weighs measured figures over typed ones', () => {
  const at = (/** @type {number} */ tokens, /** @type {boolean} */ measured) => ({
    area: 'core',
    kind: 'work',
    tier: 2,
    tokens,
    firstPass: true,
    ...(measured ? { measured: true } : {}),
  });
  const policy = { default_estimates: { 2: 100_000 } };
  const item = /** @type {any} */ ({ id: 'W-9', kind: 'work' });
  // Three measured figures set the estimate; the typed ones, here too high, are set aside.
  const mixed = [
    at(120_000, true),
    at(130_000, true),
    at(140_000, true),
    at(900_000, false),
    at(950_000, false),
    at(990_000, false),
    at(999_000, false),
  ];
  assert.equal(measuredFirst(mixed, 3).length, 3);
  assert.equal(estimateTokens(item, 2, ['core'], mixed, policy).tokens, 130_000);
  // Too few measured: every figure counts, as before the ledger said where they came from.
  const few = [at(120_000, true), at(90_000, false), at(80_000, false)];
  assert.equal(measuredFirst(few, 3).length, 3);
  assert.equal(estimateTokens(item, 2, ['core'], few, policy).tokens, 90_000);
  // The minimum is the policy's (dispatch.estimate_min_samples): at 1, the one measured figure
  // sets the estimate and the typed ones are set aside.
  const one = { ...policy, estimate_min_samples: 1 };
  assert.equal(estimateTokens(item, 2, ['core'], few, one).tokens, 120_000);
});

// --- dispatch complete ------------------------------------------------------------------------

/** A consumer with a tier-3 item, a run started and the item dispatched in the given mode. */
async function dispatched(/** @type {'interactive' | 'headless'} */ mode) {
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
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', mode]);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'session-1']);
  const ledger = () =>
    readLedger(
      /** @type {any} */ ({
        read: (/** @type {string} */ k) =>
          k === 'ledger.jsonl'
            ? readFileSync(join(c.data, 'human-in-the-lead/orch-fixture/ledger.jsonl'), 'utf8')
            : null,
      }),
    ).events;
  const reported = () =>
    /** @type {Record<string, any>} */ (ledger().find((e) => e.event === 'reported'));
  const text = report({ item: 'W-4', sha: 'abc1234', branch: start.result.branch }).replace(
    '  - node --test test/: 1 passed',
    '  - node --test test/: 1 passed\n  - token use: self-reported, a guess: about 270k tokens',
  );
  return { c, start, ledger, reported, text };
}

test('an interactive completion is measured from the session record, the guess kept apart', async () => {
  const { c, start, ledger, reported, text } = await dispatched('interactive');
  assert.equal(start.result.instruction.tool, 'session');
  assert.match(start.result.on_complete, /--session-record <file>/);
  const since = /** @type {string} */ (ledger().find((e) => e.event === 'dispatched')?.at);
  const later = (/** @type {number} */ ms) => new Date(Date.parse(since) + ms).toISOString();
  const record = join(c.base, 'record.json');
  writeFileSync(
    record,
    JSON.stringify(
      page([
        // A turn of an earlier dispatch in the same session: not this one's cost.
        turn({ at: '2020-01-01T00:00:00Z', uuid: 'old', output: 7, write: 7, read: 7, cost: 7 }),
        turn({ at: later(60_000), uuid: 't1', output: 20_000, write: 60_000, read: 4e6, cost: 2 }),
        turn({
          at: later(120_000),
          uuid: 't2',
          input: 30,
          output: 10_000,
          write: 30_000,
          read: 8e6,
          cost: 1.5,
          text,
        }),
      ]),
    ),
  );
  // A typed figure beside the record is refused: the record is measured.
  const both = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    'D-1',
    '--session-record',
    record,
    '--tokens',
    '1',
  ]);
  assert.equal(both.result.error, 'usage', JSON.stringify(both.result));
  assert.match(both.result.message, /--session-record is measured/);

  const out = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    'D-1',
    '--session-record',
    record,
  ]);
  assert.equal(out.exit, 0, JSON.stringify(out.result));
  assert.equal(out.result.result, 'done', 'the report is the last turn of the record');
  assert.equal(out.result.tokens.recorded, 120_030);
  assert.equal(out.result.tokens.source, 'session-record');
  assert.equal(out.result.tokens.turns, 2);
  assert.equal(out.result.tokens.warning, undefined);
  assert.deepEqual(out.result.tokens.self_reported, {
    tokens: 270_000,
    note: "the executor's own figure: a guess, kept apart and never the recorded cost",
    ratio_to_measured: 2.25,
  });
  const e = reported();
  assert.equal(e.tokens, 120_030, 'the measured figure, not the guess');
  assert.equal(e.tokens_source, 'session-record');
  assert.equal(e.self_reported_tokens, 270_000);
  assert.deepEqual(e.usage, {
    input_tokens: 30,
    output_tokens: 30_000,
    cache_write_tokens: 90_000,
    cache_read_tokens: 12_000_000,
    cost_usd: 3.5,
  });

  // The summary shows the source and the guess beside the measured figure.
  const sum = await c.hitld(['ledger', 'summary']);
  const row = sum.result.estimate_vs_actual.by_dispatch[0];
  assert.deepEqual(
    [row.tokens, row.tokens_source, row.self_reported_tokens],
    [120_030, 'session-record', 270_000],
  );

  // A correction by hand is typed, and the harness's counts do not stand beside it.
  const fix = await c.hitld([
    'ledger',
    'correct-tokens',
    e.id,
    '--tokens',
    '100000',
    '--why',
    'a test of a correction',
  ]);
  assert.equal(fix.exit, 0, JSON.stringify(fix.result));
  assert.equal(fix.result.event.tokens_source, 'typed');
  assert.equal(fix.result.event.usage, undefined);
  assert.equal(fix.result.event.self_reported_tokens, 270_000);
});

test('an interactive completion without the record: a typed figure, which the ledger says', async () => {
  const { c, reported, text } = await dispatched('interactive');
  const note = join(c.base, 'report.txt');
  writeFileSync(note, text);
  const out = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    'D-1',
    '--report-file',
    note,
    '--tokens',
    '150000',
  ]);
  assert.equal(out.exit, 0, JSON.stringify(out.result));
  assert.equal(out.result.tokens.source, 'typed');
  assert.match(out.result.tokens.warning, /recorded as typed by hand.*--session-record/);
  assert.equal(
    out.result.tokens.self_reported.ratio_to_measured,
    undefined,
    'typed is not measured',
  );
  const e = reported();
  assert.deepEqual(
    [e.tokens, e.tokens_source, e.self_reported_tokens, e.usage],
    [150_000, 'typed', 270_000, undefined],
  );
  assert.match(e.notes, /tokens typed by hand: the harness record was not given/);
});

test('an interactive completion with neither: the guess is never recorded as the cost', async () => {
  const { c, reported, text } = await dispatched('interactive');
  const note = join(c.base, 'report.txt');
  writeFileSync(note, text);
  const out = await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
  assert.equal(out.exit, 0, JSON.stringify(out.result));
  assert.equal(out.result.tokens.recorded, null);
  assert.match(out.result.tokens.warning, /no figure is recorded/);
  const e = reported();
  assert.deepEqual([e.tokens, e.tokens_source, e.self_reported_tokens], [null, undefined, 270_000]);
});

test('a headless completion with large cache reads records them apart, measured', async () => {
  const { c, start, reported, text } = await dispatched('headless');
  const resultFile = start.result.on_complete.split('--result-file ')[1];
  writeFileSync(
    resultFile,
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: text,
      total_cost_usd: 6.5,
      usage: {
        input_tokens: 50,
        output_tokens: 40_000,
        cache_creation_input_tokens: 100_000,
        cache_read_input_tokens: 1_882_231,
      },
    }),
  );
  const typed = await c.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    'D-1',
    '--result-file',
    resultFile,
    '--tokens',
    '1882231',
  ]);
  assert.equal(typed.result.error, 'usage', 'a typed figure beside the result is refused');
  const out = await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1']);
  assert.equal(out.exit, 0, JSON.stringify(out.result));
  const e = reported();
  assert.deepEqual(
    [e.tokens, e.tokens_source, e.self_reported_tokens],
    [140_050, 'result-file', 270_000],
  );
  assert.deepEqual(e.usage, {
    input_tokens: 50,
    output_tokens: 40_000,
    cache_write_tokens: 100_000,
    cache_read_tokens: 1_882_231,
    cost_usd: 6.5,
  });
  assert.equal(out.result.tokens.self_reported.ratio_to_measured, 1.93);
});
