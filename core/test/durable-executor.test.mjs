// Print-mode executors are durable processes (HITLD-746): the adapter's call starts each one in a
// process group of its own, its events, process ID and result in the store, and returns at once.
// Ending the orchestrator's turn, even killing its whole process group, does not reach it; nothing
// waits for it, and a later reconcile pass (HITLD-780) records it from its closing commit, whose
// message body is the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { watchDispatches } from '../lib/dispatch/watch.mjs';
import { processSignal } from '../lib/run/reality.mjs';
import { headlessCompletion } from '../harness/claude-code/completion.mjs';
import { followUpInstruction, instructionFor } from '../harness/claude-code/instructions.mjs';
import { LAUNCHER, parseLaunchArgs } from '../harness/claude-code/launch.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer, report } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const HITLD = fileURLToPath(new URL('../bin/hitld.mjs', import.meta.url));

/**
 * An environment without the credentials Claude Code would take from it, so the launcher reads
 * the stored token whatever the machine running the test has set. @param {NodeJS.ProcessEnv} env
 */
const withoutCredentials = (env) => {
  const out = { ...env };
  for (const k of Object.keys(out)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_|CLAUDE_CODE_REMOTE$)/.test(k)) {
      delete out[k];
    }
  }
  return out;
};

/** Whether a process is alive. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
};

/** Wait until `ok` holds, or fail after `ms`. @param {() => boolean} ok @param {string} what */
async function until(ok, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const STREAM_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1200,
  result: 'the last message, which is not the report',
  session_id: 'sess-durable',
  usage: { input_tokens: 10, output_tokens: 1000, cache_creation_input_tokens: 2000 },
};

test('a headless call starts a durable process: the launcher, stream-json events, its pid and result in the store, in the foreground', () => {
  const call = instructionFor(
    {
      dispatch: 'D-7',
      item: 'W-1',
      brief: 'b',
      tier: 2,
      role: 'executor',
      isolation: 'none',
      classification: 'internal',
    },
    {
      worktree: '/w/t',
      briefPath: '/s/brief.md',
      resultPath: '/s/dispatch/results/D-7.json',
      pidPath: '/s/dispatch/pids/D-7.pid',
      tier3Mode: 'headless',
      env: { HITLD_PROJECT_ID: 'p', HITLD_ROLE: 'executor' },
    },
  );
  assert.equal(call.tool, 'Bash');
  const input = /** @type {{ command: string, run_in_background: boolean }} */ (call.input);
  assert.equal(input.run_in_background, false, 'it returns at once: nothing waits for it');
  assert.ok(input.command.startsWith('cd /w/t && HITLD_DISPATCH=D-7 '), input.command);
  assert.ok(
    input.command.includes(
      `node ${LAUNCHER} --credential claude-code --pid /s/dispatch/pids/D-7.pid`,
    ),
    'a claude run starts on a long-lived credential or not at all (HITLD-880)',
  );
  assert.ok(input.command.includes('--in /s/brief.md --out /s/dispatch/results/D-7.json'));
  assert.ok(input.command.includes('--err /s/dispatch/results/D-7.stderr'));
  assert.match(input.command, / -- claude -p --output-format stream-json --verbose /);
  assert.doesNotMatch(input.command, /[<>]/, 'no shell redirection: the launcher opens the files');
  // The launcher reads back what the command gives it.
  const words = input.command.split(' && ')[1].split(' ');
  words.splice(0, words.indexOf(LAUNCHER) + 1);
  const a = parseLaunchArgs(words);
  assert.equal(a.pidFile, '/s/dispatch/pids/D-7.pid');
  assert.equal(a.command, 'claude');
  assert.equal(a.credential, 'claude-code');
  assert.deepEqual(a.args.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  // Without headless, a tier-2 dispatch stays a background agent.
  const agent = instructionFor(
    {
      dispatch: 'D-8',
      item: 'W-1',
      brief: 'b',
      tier: 2,
      role: 'executor',
      isolation: 'worktree',
      classification: 'internal',
    },
    { tier3Mode: undefined },
  );
  assert.equal(agent.tool, 'Agent');
  // A follow-up of a headless run resumes it the same durable way, at any tier.
  const more = followUpInstruction({
    harnessRef: '123',
    message: 'm',
    tier: 2,
    mode: 'headless',
    dispatch: 'D-9',
    worktree: '/w/t',
    sessionId: 'sess-1',
    briefPath: '/s/m.md',
    resultPath: '/s/dispatch/results/D-9.json',
    pidPath: '/s/dispatch/pids/D-9.pid',
  });
  assert.equal(more.tool, 'Bash');
  assert.match(
    /** @type {{ command: string }} */ (more.input).command,
    /-- claude -p --output-format stream-json --verbose --permission-mode acceptEdits --resume sess-1$/,
  );
});

test('a stream-json result: the result event gives the tokens; a run with no result event gives none', () => {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-durable' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
    STREAM_RESULT,
  ].map((x) => JSON.stringify(x));
  const done = headlessCompletion(`${lines.join('\n')}\n`);
  assert.equal(done.usage?.tokens, 3010);
  assert.equal(done.tokensSource, 'result-file');
  assert.equal(done.sessionId, 'sess-durable');
  // Stopped part-way: a line cut short, and no result event.
  const cut = headlessCompletion(`${lines.slice(0, 2).join('\n')}\n{"type":"assis`);
  assert.equal(cut.usage?.tokens, null);
  assert.equal(cut.report, '');
  assert.equal(cut.sessionId, 'sess-durable', 'the session a follow-up resumes');
  assert.throws(() => headlessCompletion('not json at all'), /not JSON/);
});

test('an alive durable process is never stopped by a timer; its process ending without a result is the stall', () => {
  const policy = { dispatch: { stall_after: 60, deadline: 120, poke_wait: 30, redispatch_max: 1 } };
  const started = Date.parse('2026-11-01T00:00:00Z');
  const entry = /** @type {any} */ ({
    dispatch: 'D-1',
    item: 'W-1',
    tier: 2,
    mode: 'headless',
    harness_ref: '4242',
    started_at: new Date(started).toISOString(),
    host: null,
    branch: 'b',
  });
  /** @param {Record<string, any>} proc */
  const judge = (proc) =>
    watchDispatches({
      inFlight: [entry],
      events: [],
      signals: () => [{ source: 'process', at: entry.started_at, ...proc }],
      policy,
      now: started + 30 * 86_400_000,
    })[0];
  const quiet = judge({ alive: true, output_bytes: 10, result: false });
  assert.equal(quiet.step, null, 'thirty days quiet, far past its deadline: nothing acts on it');
  assert.match(quiet.why, /process is alive/);
  assert.match(quiet.why, /past its deadline/);
  const gone = judge({ alive: false, output_bytes: 10, result: false });
  assert.equal(gone.step, 'abandon', 'its process ended without its result');
  assert.equal(gone.reason, 'exited');
  const finished = judge({ alive: false, output_bytes: 10, result: true });
  assert.equal(finished.state, 'finished');
  assert.equal(finished.step, null);
});

test('a print-mode executor outlives its orchestrator, finishes, and a later reconcile pass records it from its closing commit', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-4-change.md': item({
        id: 'W-4',
        title: 'change W-4',
        kind: 'work',
        state: 'planned',
        tier_override: '2',
        touches: ['src/w-4.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'headless']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const { dispatch, branch, worktree, instruction } = start.result;
  assert.equal(start.result.tier, 2);
  assert.equal(instruction.tool, 'Bash', 'a tier-2 item in print mode is a durable process');
  assert.ok(worktree, 'its worktree is cut for it, as for tier 3');
  assert.match(start.result.on_complete, /hitld dispatch reconcile/);
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  const ledger = () => readLedger(store).events;
  assert.equal(
    ledger().find((e) => e.event === 'dispatched' && e.dispatch === dispatch)?.mode,
    'headless',
  );

  // A stand-in for claude: it reads its brief, writes its first event, waits until it is let go,
  // then does the work as an executor does (claim, a code commit, close with the report) and
  // writes its result event.
  const bin = tempDir('hitld-746-bin-');
  const go = join(bin, 'go');
  const fake = join(bin, 'claude.mjs');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec ${process.execPath} ${fake} "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  // The long-lived credential it starts on (HITLD-880): the token in the machine directory's file,
  // with no keychain on this PATH, so a real one on the machine running the test is never read.
  for (const tool of ['security', 'secret-tool']) {
    writeFileSync(join(bin, tool), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, tool), 0o755);
  }
  const token = 'sk-ant-oat01-durable-fixture-token';
  mkdirSync(join(c.data, 'human-in-the-lead/_machine/credentials'), { recursive: true });
  writeFileSync(
    join(c.data, 'human-in-the-lead/_machine/credentials/claude-code-oauth-token'),
    `${token}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    fake,
    `import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const brief = readFileSync(0, 'utf8');
const out = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 'sess-durable', brief_bytes: brief.length, token_given: process.env.CLAUDE_CODE_OAUTH_TOKEN === ${JSON.stringify(token)} });
while (!existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 50));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
const hitld = (...args) => run(process.execPath, [${JSON.stringify(HITLD)}, ...args]);
hitld('work', 'claim', 'W-4', '--dispatch', process.env.HITLD_DISPATCH, '--branch', ${JSON.stringify(branch)});
mkdirSync('src', { recursive: true });
writeFileSync('src/w-4.js', 'export const x = 1;\\n');
run('git', ['add', 'src/w-4.js']);
run('git', ['commit', '-q', '-m', 'work on W-4']);
writeFileSync(${JSON.stringify(join(bin, 'report.txt'))}, ${JSON.stringify(
      report({ item: 'W-4', sha: 'pending', branch }),
    )});
hitld('work', 'close', 'W-4', '--report-file', ${JSON.stringify(join(bin, 'report.txt'))});
out(${JSON.stringify(STREAM_RESULT)});
`,
  );

  // The orchestrator's turn: a process group of its own that makes the call as printed, then
  // goes on running until the harness ends the turn by killing the whole group.
  const turn = spawn('sh', ['-c', `${instruction.input.command} && exec sleep 600`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: withoutCredentials({ ...process.env, ...c.env, PATH: `${bin}:${process.env.PATH}` }),
  });
  let printed = '';
  turn.stdout.on('data', (b) => (printed += b));
  let errors = '';
  turn.stderr.on('data', (b) => (errors += b));
  await until(() => /"pid":\d+/.test(printed), `the launcher's pid (${errors})`);
  const pid = Number(/"pid":(\d+)/.exec(printed)?.[1]);
  assert.match(printed, /"credential":\{"kind":"oauth-token","source":"machine-file"\}/);
  assert.ok(!printed.includes(token) && !errors.includes(token), 'the token is in no output');
  assert.ok(!instruction.input.command.includes(token), 'nor on the command line');
  const pidFile = join(store.root, `dispatch/pids/${dispatch}.pid`);
  const resultFile = join(store.root, `dispatch/results/${dispatch}.json`);
  assert.equal(Number(readFileSync(pidFile, 'utf8').trim()), pid, 'its pid is in the store');
  await c.hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', String(pid)]);
  await until(() => existsSync(resultFile) && readFileSync(resultFile, 'utf8').length > 0, 'init');
  assert.match(readFileSync(resultFile, 'utf8'), /"token_given":true/, 'the child has the token');

  // The orchestrator exits: its turn ends, and everything in its process group is killed.
  const exited = new Promise((r) => turn.once('exit', r));
  process.kill(-(/** @type {number} */ (turn.pid)), 'SIGKILL');
  await exited;
  assert.equal(alive(/** @type {number} */ (turn.pid)), false, 'the orchestrator is gone');
  assert.equal(alive(pid), true, 'the executor is not');
  const during = processSignal({ pidFile, outputFile: resultFile });
  assert.deepEqual(
    { alive: during?.alive, result: during?.result },
    { alive: true, result: false },
    'running: events written, no result yet',
  );

  // A pass while it runs records nothing and acts on nothing.
  const early = await c.hitld(['dispatch', 'reconcile']);
  assert.equal(early.exit, 0, JSON.stringify(early.result));
  assert.equal(early.result.dispatches[0].state, 'running', JSON.stringify(early.result));
  assert.deepEqual(early.result.recorded, []);

  // It finishes on its own, after the orchestrator exited.
  writeFileSync(go, '');
  await until(() => !alive(pid), 'the executor to finish');
  const head = git(worktree, 'rev-parse', 'HEAD');
  const message = git(worktree, 'log', '-1', '--format=%B');
  assert.match(message, /^close: W-4\n\nitem: W-4\nresult: done\n/, 'the commit is the report');
  assert.match(
    message,
    new RegExp(`\\n\\nWork-Item: W-4\\nDispatch: ${dispatch}\\nAgent-Role: executor$`),
  );

  // A later pass, by any orchestrator holding the lease, records it once.
  const pass = await c.hitld(['dispatch', 'reconcile']);
  assert.equal(pass.exit, 0, JSON.stringify(pass.result));
  assert.deepEqual(pass.result.recorded, [dispatch], JSON.stringify(pass.result));
  const shown = pass.result.dispatches[0];
  assert.equal(shown.state, 'complete');
  assert.deepEqual(shown.evidence.process, {
    alive: false,
    output_bytes: shown.evidence.process.output_bytes,
    result: true,
  });
  const reported = ledger().filter((e) => e.event === 'reported');
  assert.equal(reported.length, 1);
  assert.equal(reported[0].dispatch, dispatch);
  assert.equal(reported[0].commit, head, 'the closing commit it was read from');
  assert.equal(reported[0].tokens, 3010, "from the run's result event");
  assert.equal(reported[0].tokens_source, 'result-file');
  const again = await c.hitld(['dispatch', 'reconcile']);
  assert.deepEqual(again.result.recorded, []);
  assert.equal(ledger().filter((e) => e.event === 'reported').length, 1);
});
