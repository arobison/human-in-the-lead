// The executor's budget (HITLD-782): a PostToolUse hook sums the executor's usage since its dispatch
// started from its transcript's per-message usage and, at the cap, tells it to close; a PreToolUse
// rule then refuses all but the closing steps; the reconcile pass stops an overrun the hook missed.
// The hook reads only the numbers: a marker in the transcript appears nowhere it writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import {
  BUDGET_REACHED,
  budgetOf,
  isClosingStep,
  transcriptUsage,
} from '../lib/dispatch/budget.mjs';
import { closingAllowance } from '../lib/cli/commands/reconcile.mjs';
import { renderBrief } from '../lib/dispatch/brief.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer } from './orchestrator-fixture.mjs';

const HOOKS = new URL('../harness/claude-code/hooks/', import.meta.url);
const PROGRESS = fileURLToPath(new URL('progress.mjs', HOOKS));
const GUARD = fileURLToPath(new URL('guard.mjs', HOOKS));
const MARKER = 'MARKER-7f3a-transcript-content-never-leaves';

/**
 * One transcript line of a model response, with the marker in its content.
 * @param {{ id: string, at: string, input?: number, output: number, write?: number, read?: number }} m
 */
const response = (m) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: m.at,
    uuid: `u-${m.id}-${m.output}`,
    message: {
      id: m.id,
      role: 'assistant',
      model: MARKER,
      content: [{ type: 'text', text: `${MARKER} said this` }],
      usage: {
        input_tokens: m.input ?? 0,
        output_tokens: m.output,
        cache_creation_input_tokens: m.write ?? 0,
        cache_read_input_tokens: m.read ?? 0,
      },
    },
  });

/** A user line carrying the marker and a decoy usage field in its content. */
const userLine = (/** @type {string} */ at) =>
  JSON.stringify({
    type: 'user',
    timestamp: at,
    message: { role: 'user', content: `${MARKER} "usage": {"output_tokens": 999999}` },
    toolUseResult: { stdout: MARKER, usage: { output_tokens: 999999 } },
  });

test('transcript usage: output plus fresh input since the start, each response once, never cache reads or content', () => {
  const text = [
    response({ id: 'm0', at: '2026-01-01T09:00:00Z', output: 50_000 }), // before the dispatch
    userLine('2026-01-01T10:00:01Z'),
    response({ id: 'm1', at: '2026-01-01T10:00:02Z', input: 3, output: 100, write: 900 }),
    // The same response written again for its next content block: counted once, by its last line.
    response({ id: 'm1', at: '2026-01-01T10:00:02Z', input: 3, output: 200, write: 900 }),
    response({ id: 'm2', at: '2026-01-01T10:00:05Z', output: 1000, read: 5_000_000 }),
    '{not json "usage" "assistant"',
    '',
  ].join('\n');
  const u = transcriptUsage(text, { since: '2026-01-01T10:00:00Z' });
  assert.deepEqual(u, { tokens: 3 + 200 + 900 + 1000, messages: 2 });
  assert.equal(transcriptUsage(text).tokens, 50_000 + 2103);
  assert.doesNotMatch(JSON.stringify(u), new RegExp(MARKER));
  assert.deepEqual(transcriptUsage(''), { tokens: 0, messages: 0 });
});

test('the cap is the start estimate times report_at_budget_multiple, from the dispatched event', () => {
  const events = /** @type {any[]} */ ([
    {
      event: 'dispatched',
      id: 'e1',
      dispatch: 'D-1',
      item: 'W-1',
      tier: 2,
      at: '2026-01-01T10:00:00Z',
      estimate_tokens: 100_000,
      estimate_source: 'item',
    },
  ]);
  assert.deepEqual(budgetOf(events, 'D-1', {}), {
    cap: 150_000,
    since: '2026-01-01T10:00:00Z',
    item: 'W-1',
  });
  assert.equal(budgetOf(events, 'D-1', { report_at_budget_multiple: 2 })?.cap, 200_000);
  assert.equal(budgetOf(events, 'D-2', {}), null, 'no such dispatch: nothing enforced');
  const none = [{ ...events[0], estimate_tokens: undefined }];
  assert.equal(budgetOf(/** @type {any[]} */ (none), 'D-1', {}), null, 'no estimate');
});

test('the closing steps: commit, push, close, publish check, git reads, and the report message', () => {
  const bash = (/** @type {string} */ command) =>
    isClosingStep({ tool_name: 'Bash', tool_input: { command } });
  for (const ok of [
    'git add -A',
    "git add -A && git commit -q -m 'Close W-1' -m 'body; with | separators && words'",
    'git commit -F .git/MSG',
    'git push -u origin hitld/W-1-x',
    'git status --short && git log --oneline -3 && git rev-parse HEAD',
    'HITLD_DISPATCH=D-1 HITLD_ROLE=executor hitld work close W-1',
    'node core/bin/hitld.mjs work close W-1',
    'cd /tmp/x && git status',
    'hitld publish check --file report.md',
  ]) {
    assert.equal(bash(ok), true, ok);
  }
  for (const no of [
    'npm test',
    'git add -A && npm test',
    'git commit -m "$(rm -rf /)"',
    'git commit -m `id`',
    'git log > out.txt',
    'cat src/a.js',
    "git commit -m 'unbalanced",
    'hitld work claim W-2',
    '',
  ]) {
    assert.equal(bash(no), false, no);
  }
  assert.equal(isClosingStep({ tool_name: 'mcp__claude-code-remote__send_message' }), true);
  assert.equal(isClosingStep({ tool_name: 'SendMessage' }), true);
  for (const tool of ['Edit', 'Write', 'Read', 'Grep', 'Agent', 'mcp__github__push_files']) {
    assert.equal(isClosingStep({ tool_name: tool, tool_input: {} }), false, tool);
  }
});

/** Every file under a directory, with its text. @param {string} dir @returns {string[]} */
function textsUnder(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/** A consumer with one item whose estimate is 10k tokens (cap 15k), dispatched interactively. */
async function setUp() {
  const c = makeConsumer({
    files: {
      'work/items/W-9-change.md': item({
        id: 'W-9',
        title: 'change W-9',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        estimate_tokens: '10000',
        touches: ['src/w9.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-9', '--mode', 'interactive']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const dispatch = /** @type {string} */ (start.result.dispatch);
  await c.hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', 'session-w9']);
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const since = /** @type {string} */ (
    readLedger(store).events.find((e) => e.event === 'dispatched' && e.dispatch === dispatch)?.at
  );
  const later = (/** @type {number} */ s) => new Date(Date.parse(since) + s * 1000).toISOString();
  return { c, dispatch, store, since, later, worktree: c.root };
}

test('the hook: under the cap it says nothing; at the cap it says budget reached and the guard refuses all but the closing steps; the marker appears nowhere', async () => {
  const { c, dispatch, store, later, worktree } = await setUp();
  const dir = join(c.base, 'transcripts');
  mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true });
  const transcript = join(dir, 'sess.jsonl');
  const env = { ...c.env, HITLD_DISPATCH: dispatch };
  /** @param {string} script @param {Record<string, any>} tool */
  const hook = (script, tool) =>
    spawnSync(process.execPath, [script], {
      input: JSON.stringify({
        session_id: 'sess',
        transcript_path: transcript,
        cwd: worktree,
        hook_event_name: script === GUARD ? 'PreToolUse' : 'PostToolUse',
        ...tool,
      }),
      encoding: 'utf8',
      cwd: worktree,
      env,
    });
  const edit = { tool_name: 'Edit', tool_input: { file_path: join(worktree, 'src/w1.js') } };
  /** @type {string[]} */
  const outputs = [];
  const run = (/** @type {string} */ s, /** @type {Record<string, any>} */ t) => {
    const r = hook(s, t);
    outputs.push(r.stdout, r.stderr);
    return r;
  };

  // Earlier usage in the same session (before the dispatch) does not count; 9k since does not reach 15k.
  writeFileSync(
    transcript,
    [
      response({ id: 'old', at: new Date(0).toISOString(), output: 900_000 }),
      userLine(later(1)),
      response({ id: 'a', at: later(2), output: 4_000, write: 5_000, read: 10_000_000 }),
    ].join('\n') + '\n',
  );
  assert.equal(run(PROGRESS, edit).stdout, '', 'under the cap: nothing said');
  assert.equal(run(GUARD, edit).stdout, '', 'under the cap: nothing refused');

  // A subagent of the executor's adds its usage: 9k + 7k reaches the 15k cap.
  writeFileSync(
    join(dir, 'sess', 'subagents', 'agent-x1.jsonl'),
    response({ id: 'b', at: later(3), output: 7_000 }) + '\n',
  );
  const post = run(PROGRESS, edit);
  const said = JSON.parse(post.stdout);
  assert.equal(said.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(said.hookSpecificOutput.additionalContext, new RegExp(BUDGET_REACHED));
  assert.match(said.hookSpecificOutput.additionalContext, /16000 of its 15000 tokens/);

  const refused = JSON.parse(run(GUARD, edit).stdout);
  assert.equal(refused.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(refused.hookSpecificOutput.permissionDecisionReason, new RegExp(BUDGET_REACHED));
  for (const command of ['npm test', 'cat src/w1.js']) {
    const r = run(GUARD, { tool_name: 'Bash', tool_input: { command } });
    assert.match(r.stdout, /"deny"/, command);
  }
  for (const t of [
    { tool_name: 'Bash', tool_input: { command: "git add -A && git commit -m 'W-1'" } },
    { tool_name: 'Bash', tool_input: { command: 'hitld work close W-1' } },
    { tool_name: 'mcp__claude-code-remote__send_message', tool_input: { message: 'report' } },
  ]) {
    assert.equal(run(GUARD, t).stdout, '', JSON.stringify(t));
  }

  // The marker reaches no output, no ledger line, no progress record, nothing in the store.
  for (const o of outputs) assert.doesNotMatch(o, new RegExp(MARKER));
  for (const t of textsUnder(store.root)) assert.doesNotMatch(t, new RegExp(MARKER));
  assert.ok(
    readLedger(store).events.every((e) => !JSON.stringify(e).includes(MARKER)),
    'the ledger',
  );

  // Someone else's session (no dispatch, outside the checkout) is never metered.
  const other = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ transcript_path: transcript, cwd: c.base, ...edit }),
    encoding: 'utf8',
    cwd: c.base,
    env: c.env,
  });
  assert.equal(other.stdout, '');
});

test('reconcile stops an overrun the hook missed, from the harness record, and leaves one within the closing allowance', async () => {
  const { c, dispatch, store, later } = await setUp();
  /** @param {number} output */
  const record = (output) => {
    const file = join(c.base, `record-${output}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        ccr: {
          data: [
            {
              created_at: later(60),
              result: {
                uuid: `u-${output}`,
                envelope: {
                  subtype: 'success',
                  is_error: false,
                  duration_ms: 1000,
                  result: 'still working',
                  session_id: 'sess',
                  total_cost_usd: 1,
                  usage: {
                    input_tokens: 0,
                    output_tokens: output,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 9e6,
                  },
                },
              },
            },
          ],
          has_more: false,
        },
      }),
    );
    return file;
  };
  assert.equal(closingAllowance(15_000), 1_500);
  // Past the cap but within the closing allowance: the hook may be closing it; nothing acts.
  const within = await c.hitld([
    'dispatch',
    'reconcile',
    '--session-record',
    `${dispatch}=${record(16_000)}`,
  ]);
  assert.equal(within.exit, 0, JSON.stringify(within.result));
  const w = within.result.dispatches[0];
  assert.equal(w.state, 'running');
  assert.equal(w.overrun, undefined);
  assert.equal(readLedger(store).events.filter((e) => e.event === 'interrupted').length, 0);

  // Past it: stopped, once.
  const file = record(40_000);
  const pass = await c.hitld(['dispatch', 'reconcile', '--session-record', `${dispatch}=${file}`]);
  assert.equal(pass.exit, 0, JSON.stringify(pass.result));
  const d = pass.result.dispatches[0];
  assert.deepEqual(d.overrun, { tokens: 40_000, cap: 15_000 });
  assert.equal(d.stopped.ok, true, JSON.stringify(d.stopped));
  assert.equal(d.stopped.stop.harness_ref, 'session-w9');
  assert.deepEqual(pass.result.stopped, [dispatch]);
  assert.match(pass.result.next, /stopped past its token cap/);
  const stops = readLedger(store).events.filter((e) => e.event === 'interrupted');
  assert.equal(stops.length, 1);
  assert.match(String(stops[0].notes), /40000 of its 15000 tokens/);
  const again = await c.hitld(['dispatch', 'reconcile', '--session-record', `${dispatch}=${file}`]);
  assert.deepEqual(again.result.dispatches, [], 'no longer in flight');
  assert.equal(readLedger(store).events.filter((e) => e.event === 'interrupted').length, 1);
  // Stopping it by hand now says it is not in flight.
  const byHand = await c.hitld(['dispatch', 'stop', '--dispatch', dispatch]);
  assert.equal(byHand.result.error, 'not-in-flight');
});

test('a cloud executor with no store: the cap rides in its claim commit, and the hook stops it there (HITLD-841)', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-9-change.md': item({
        id: 'W-9',
        title: 'change W-9',
        kind: 'work',
        state: 'planned',
        touches: ['src/w9.js'],
      }),
    },
  });
  const dispatch = 'D-01M87Y65JTA2QW5M';
  spawnSync('git', ['-C', c.root, 'checkout', '-q', '-b', 'hitld/W-9'], { encoding: 'utf8' });
  // A dispatch the ledger does not hold (there is no store): the figure given is the one written.
  const claim = await c.hitld([
    'work',
    'claim',
    'W-9',
    '--dispatch',
    dispatch,
    '--budget-tokens',
    '15000',
  ]);
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  assert.equal(claim.result.budget_tokens, 15000);
  const message = spawnSync('git', ['-C', c.root, 'log', '-1', '--format=%B'], {
    encoding: 'utf8',
  }).stdout;
  assert.match(message, /^claim: W-9\n/);
  assert.match(message, /^Dispatch: D-01M87Y65JTA2QW5M$/m);
  assert.match(message, /^Budget-Tokens: 15000$/m);
  assert.equal(
    existsSync(join(c.data, 'human-in-the-lead/orch-fixture')),
    false,
    'no private store',
  );

  const dir = join(c.base, 'transcripts');
  mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true });
  const transcript = join(dir, 'sess.jsonl');
  // The hook's environment has no HITLD_DISPATCH: a cloud session is known by its claim commit.
  /** @param {string} script @param {Record<string, any>} tool */
  const hook = (script, tool) =>
    spawnSync(process.execPath, [script], {
      input: JSON.stringify({
        session_id: 'sess',
        transcript_path: transcript,
        cwd: c.root,
        hook_event_name: script === GUARD ? 'PreToolUse' : 'PostToolUse',
        ...tool,
      }),
      encoding: 'utf8',
      cwd: c.root,
      env: c.env,
    });
  const edit = { tool_name: 'Edit', tool_input: { file_path: join(c.root, 'src/w9.js') } };
  // Usage counts from the claim: the session's earlier usage (an earlier dispatch's) does not.
  const claimed = Date.parse(
    spawnSync('git', ['-C', c.root, 'log', '-1', '--format=%aI'], {
      encoding: 'utf8',
    }).stdout.trim(),
  );
  const after = (/** @type {number} */ s) => new Date(claimed + s * 1000).toISOString();
  const at = after(10);

  writeFileSync(
    transcript,
    [
      response({ id: 'old', at: after(-60), output: 900_000 }),
      response({ id: 'a', at, output: 4_000, write: 5_000 }),
    ].join('\n') + '\n',
  );
  assert.equal(hook(PROGRESS, edit).stdout, '', 'under the cap: nothing said');
  assert.equal(hook(GUARD, edit).stdout, '', 'under the cap: nothing refused');

  // A subagent's usage is the executor's too: 9k + 7k passes the 15k cap.
  writeFileSync(
    join(dir, 'sess', 'subagents', 'agent-x1.jsonl'),
    response({ id: 'b', at, output: 7_000 }) + '\n',
  );
  const said = JSON.parse(hook(PROGRESS, edit).stdout);
  assert.match(said.hookSpecificOutput.additionalContext, new RegExp(BUDGET_REACHED));
  assert.match(said.hookSpecificOutput.additionalContext, /16000 of its 15000 tokens/);
  const refused = JSON.parse(hook(GUARD, edit).stdout);
  assert.equal(refused.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(refused.hookSpecificOutput.permissionDecisionReason, /D-01M87Y65JTA2QW5M/);
  for (const t of [
    { tool_name: 'Bash', tool_input: { command: "git add -A && git commit -m 'W-9'" } },
    { tool_name: 'mcp__claude-code-remote__send_message', tool_input: { message: 'report' } },
  ]) {
    assert.equal(hook(GUARD, t).stdout, '', `the closing steps stay open: ${JSON.stringify(t)}`);
  }

  // A follow-up in the same session starts after the item's close: the usage before it is spent.
  const closed = spawnSync(
    'git',
    [
      '-C',
      c.root,
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'close: W-9',
      '-m',
      `Dispatch: ${dispatch}`,
    ],
    { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: after(100) } },
  );
  assert.equal(closed.status, 0, closed.stderr);
  writeFileSync(
    transcript,
    readFileSync(transcript, 'utf8') + response({ id: 'c', at: after(200), output: 5_000 }) + '\n',
  );
  assert.equal(hook(PROGRESS, edit).stdout, '', 'the follow-up: 5k since the close');
  assert.equal(hook(GUARD, edit).stdout, '', 'the follow-up: nothing refused');
});

test('a store that holds the dispatch decides: one no longer in flight is not metered from its claim', async () => {
  const { c, dispatch, later } = await setUp();
  spawnSync('git', ['-C', c.root, 'checkout', '-q', '-b', 'hitld/W-9'], { encoding: 'utf8' });
  const claim = await c.hitld(['work', 'claim', 'W-9', '--dispatch', dispatch]);
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  assert.equal(claim.result.budget_tokens, 15000, 'the ledger cap, with no figure given');
  const stopped = await c.hitld(['dispatch', 'stop', '--dispatch', dispatch]);
  assert.equal(stopped.exit, 0, JSON.stringify(stopped.result));
  const transcript = join(c.base, 'sess.jsonl');
  writeFileSync(transcript, response({ id: 'a', at: later(5), output: 20_000 }) + '\n');
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({
      transcript_path: transcript,
      cwd: c.root,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(c.root, 'src/w9.js') },
    }),
    encoding: 'utf8',
    cwd: c.root,
    env: c.env,
  });
  assert.equal(r.stdout, '', 'the ledger says the dispatch is over: its claim cap is not read');
});

test('a token cap past twelve digits is refused, since the hook would not read it', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-9-change.md': item({
        id: 'W-9',
        title: 'change W-9',
        kind: 'work',
        state: 'planned',
      }),
    },
  });
  spawnSync('git', ['-C', c.root, 'checkout', '-q', '-b', 'hitld/W-9'], { encoding: 'utf8' });
  const args = ['work', 'claim', 'W-9', '--dispatch', 'D-01M87Y65JTA2QW5M', '--budget-tokens'];
  const big = await c.hitld([...args, '1000000000000']);
  assert.notEqual(big.exit, 0);
  assert.equal(big.result.error, 'usage');
  const zero = await c.hitld([...args, '0']);
  assert.equal(zero.result.error, 'usage');
  assert.equal((await c.hitld([...args, '999999999999'])).exit, 0);
});

test('a store that cannot be read gives no reading: the claim cap is not read in its place', async () => {
  const { c, store, later } = await setUp();
  spawnSync('git', ['-C', c.root, 'checkout', '-q', '-b', 'hitld/W-9'], { encoding: 'utf8' });
  // A dispatch the ledger does not hold, so only a store read that throws keeps its cap unread.
  const other = 'D-01M87Y65JTA2QW5M';
  const claim = await c.hitld([
    'work',
    'claim',
    'W-9',
    '--dispatch',
    other,
    '--budget-tokens',
    '1000',
  ]);
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  const transcript = join(c.base, 'sess.jsonl');
  writeFileSync(transcript, response({ id: 'a', at: later(5), output: 20_000 }) + '\n');
  const guard = () =>
    spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({
        transcript_path: transcript,
        cwd: c.root,
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: join(c.root, 'src/w9.js') },
      }),
      encoding: 'utf8',
      cwd: c.root,
      env: c.env,
    }).stdout;
  assert.match(guard(), /"deny"/, 'a readable store without the dispatch: the claim cap holds');
  // The ledger's legacy file becomes a directory: reading the store now throws.
  const legacy = join(store.root, 'ledger.jsonl');
  rmSync(legacy, { force: true });
  mkdirSync(legacy);
  assert.throws(() => readLedger(store));
  assert.equal(guard(), '', 'a store that throws: no reading, as before HITLD-841');
});

test('the brief passes the cap to the claim only when there is one', () => {
  /** @param {number} estimate */
  const brief = (estimate) =>
    renderBrief({
      item: { id: 'W-1', title: 'x', path: 'work/items/W-1-x.md' },
      sizing: /** @type {any} */ ({ areas: [], estimate_tokens: estimate, owner_review: null }),
      dispatch: 'D-1',
      branch: 'hitld/W-1-x',
      policy: { project: { id: 'p' } },
      isolation: 'none',
    });
  assert.match(
    brief(10_000),
    /hitld work claim W-1 --dispatch D-1 --branch hitld\/W-1-x --budget-tokens 15000\./,
  );
  const none = brief(0);
  assert.match(none, /hitld work claim W-1 --dispatch D-1 --branch hitld\/W-1-x\./);
  assert.doesNotMatch(none, /--budget-tokens/);
});

test('the claim writes the ledger cap when the store has the dispatch, over the figure given', async () => {
  const { c, dispatch } = await setUp();
  spawnSync('git', ['-C', c.root, 'checkout', '-q', '-b', 'hitld/W-9'], { encoding: 'utf8' });
  const claim = await c.hitld([
    'work',
    'claim',
    'W-9',
    '--dispatch',
    dispatch,
    '--budget-tokens',
    '99',
  ]);
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  const message = spawnSync('git', ['-C', c.root, 'log', '-1', '--format=%B'], {
    encoding: 'utf8',
  }).stdout;
  assert.match(message, /^Budget-Tokens: 15000$/m);
});
