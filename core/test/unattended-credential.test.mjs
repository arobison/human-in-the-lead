// The credential detached executors run on (HITLD-880, GitHub issue 547): install reports it on
// setup and upgrade, the guide keeps it in the keychain or the machine directory, the launcher
// reads it into the child's environment only and refuses without it, env status names it without
// its value, and a run that loses it mid-run is recorded blocked with the reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../lib/install/install.mjs';
import { POLICY_PATH } from '../lib/policy/policy.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { judgeDispatch } from '../lib/dispatch/reconcile.mjs';
import { createRedactor } from '../lib/env/secrets.mjs';
import { headlessCompletion } from '../harness/claude-code/completion.mjs';
import {
  KEYCHAIN_TIMEOUT_MS,
  SERVICE,
  TOKEN_ENV,
  signInState,
  childEnv,
  credentialFailure,
  readToken,
  setupSteps,
  signInEnds,
  signInEndsIn,
  unattendedCredential,
} from '../harness/claude-code/credential.mjs';
import { LAUNCHER, credentialEnv } from '../harness/claude-code/launch.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
const TOKEN = 'sk-ant-oat01-' + 'x'.repeat(95);
const POSIX = process.platform !== 'win32';
/** The day `n` days from now, YYYY-MM-DD, as Claude Code writes it. @param {number} n */
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A directory of stand-in keychain tools: each prints `token` for the service, or fails when it
 * is null, so no real keychain on the machine running the test is read.
 * @param {string | null} token
 */
function keychainTools(token) {
  const bin = tempDir('hitld-880-bin-');
  const log = `printf '%s\\n' "$(basename "$0") $*" >> ${join(bin, 'calls')}`;
  for (const tool of ['security', 'secret-tool']) {
    const body =
      token === null
        ? 'exit 1'
        : `case "$*" in *${SERVICE}*) printf '%s\\n' '${token}' ;; *) exit 1 ;; esac`;
    writeFileSync(join(bin, tool), `#!/bin/sh\n${log}\n${body}\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  return bin;
}

/** The token file in a machine directory. @param {string} machineDir @param {number} mode */
function tokenFile(machineDir, mode = 0o600) {
  const file = join(machineDir, 'credentials', SERVICE);
  mkdirSync(join(machineDir, 'credentials'), { recursive: true });
  writeFileSync(file, `${TOKEN.slice(0, 60)}\n${TOKEN.slice(60)}\n`, { mode });
  chmodSync(file, mode);
  return file;
}

test(
  'the keychain is read through keychain.mjs by service and account on macOS and Linux, Credential Manager on Windows; the two printed lines join into one value',
  { skip: !POSIX },
  () => {
    const bin = keychainTools(`${TOKEN.slice(0, 60)}\n${TOKEN.slice(60)}`);
    const env = { PATH: `${bin}:${process.env.PATH}`, USER: 'owner' };
    const darwin = readToken({ env, machineDir: null, platform: 'darwin' });
    assert.deepEqual(darwin, { value: TOKEN, source: 'keychain' }, 'a break pasted in goes');
    const linux = readToken({ env, machineDir: null, platform: 'linux' });
    assert.deepEqual(linux, { value: TOKEN, source: 'secret-service' });
    assert.deepEqual(readFileSync(join(bin, 'calls'), 'utf8').trim().split('\n'), [
      `security find-generic-password -s ${SERVICE} -a owner -w`,
      `secret-tool lookup service ${SERVICE} account owner`,
    ]);
    /** @type {[string, string[]][]} */
    const calls = [];
    const win = readToken({
      env: {},
      machineDir: null,
      platform: 'win32',
      run: (program, args) => {
        calls.push([program, args]);
        return `${TOKEN.slice(0, 50)}\r\n${TOKEN.slice(50)}`;
      },
    });
    assert.deepEqual(win, { value: TOKEN, source: 'credential-manager' });
    const [program, args] = /** @type {[string, string[]]} */ (calls.at(-1));
    assert.equal(program, 'powershell.exe');
    const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
    assert.match(script, /CredRead/);
    assert.match(script, new RegExp(SERVICE));
    const none = readToken({
      env: { PATH: `${keychainTools(null)}:${process.env.PATH}`, USER: 'owner' },
      machineDir: null,
      platform: 'linux',
    });
    assert.equal(none.value, null);
    assert.deepEqual('looked_in' in none ? none.looked_in : [], [
      `the Secret Service through libsecret (service ${SERVICE}, account owner)`,
    ]);
  },
);

test(
  'a keychain tool that does not answer counts as finding nothing after the time limit',
  { skip: !POSIX },
  () => {
    const bin = tempDir('hitld-880-slow-');
    for (const tool of ['security', 'secret-tool']) {
      writeFileSync(join(bin, tool), `#!/bin/sh\nexec sleep 30\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    const t0 = Date.now();
    const r = readToken({
      env: { PATH: `${bin}:${process.env.PATH}`, USER: 'owner' },
      machineDir: null,
      platform: 'linux',
      timeoutMs: 300,
    });
    assert.equal(r.value, null);
    assert.ok(Date.now() - t0 < 10_000, `it gave up at the limit, not after ${Date.now() - t0} ms`);
    assert.equal(KEYCHAIN_TIMEOUT_MS, 10_000, 'about ten seconds by default');
  },
);

test(
  'the machine file is used when the keychain has none, and refused when others can read it',
  { skip: !POSIX },
  () => {
    const machineDir = tempDir('hitld-880-machine-');
    const file = tokenFile(machineDir);
    const run = () => null;
    assert.deepEqual(readToken({ env: {}, machineDir, platform: 'linux', run }), {
      value: TOKEN,
      source: 'machine-file',
    });
    for (const mode of [0o644, 0o640, 0o604, 0o620]) {
      chmodSync(file, mode);
      const open = readToken({ env: {}, machineDir, platform: 'linux', run });
      assert.equal(open.value, null, `mode ${mode.toString(8)} is refused`);
      assert.match(
        'problems' in open ? open.problems.join() : '',
        /read by other users: chmod 600/,
      );
    }
    chmodSync(file, 0o400);
    assert.equal(readToken({ env: {}, machineDir, platform: 'linux', run }).value, TOKEN);
  },
);

test(
  'setup and upgrade: install reports whether unattended runs have a long-lived credential, and how the owner makes one',
  { skip: !POSIX },
  () => {
    const root = tempDir('hitld-880-install-');
    execFileSync('git', ['init', '-q', root]);
    const data = tempDir('hitld-880-data-');
    const env = { PATH: `${keychainTools(null)}:${process.env.PATH}`, XDG_DATA_HOME: data };
    const run = () => install({ marketplace: CHECKOUT, key: 'SAM' }, { cwd: root, env });

    // Setup: none stored.
    const first = run();
    assert.equal(first.ok, true, JSON.stringify(first));
    const report = /** @type {Record<string, any>} */ (first.unattended_credential);
    assert.equal(report.long_lived, false);
    assert.equal(report.kind, 'interactive');
    const warnings = /** @type {string[]} */ (first.warnings);
    assert.ok(
      warnings.some((w) => /no long-lived credential/.test(w) && /claude setup-token/.test(w)),
      JSON.stringify(warnings),
    );
    const next = /** @type {string[]} */ (first.next).join('\n');
    assert.match(next, /run claude setup-token yourself, in a terminal outside any agent session/);
    assert.match(next, /prints on two lines of which only one may be masked/);
    assert.match(next, /secret-tool store|security add-generic-password/);
    assert.match(next, /wc -c/, 'how to check it without printing it');

    // Upgrade, with the token stored now: reported long-lived, by source and length only.
    tokenFile(join(data, 'human-in-the-lead', '_machine'));
    const again = run();
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual(
      { .../** @type {Record<string, any>} */ (again.unattended_credential), looked_in: [] },
      {
        long_lived: true,
        kind: 'oauth-token',
        source: 'machine-file',
        length: TOKEN.length,
        problems: [],
        looked_in: [],
      },
    );
    assert.ok(!JSON.stringify(again).includes(TOKEN.slice(20, 40)), 'never the value');
    assert.ok(!/no long-lived credential/.test(/** @type {string[]} */ (again.warnings).join()));

    // Executors that run interactive need none: nothing is reported.
    const policyPath = join(root, POLICY_PATH);
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    policy.dispatch = { ...(policy.dispatch ?? {}), tier3_mode: 'interactive' };
    writeFileSync(policyPath, JSON.stringify(policy, null, 2));
    assert.equal(run().unattended_credential, undefined);
  },
);

test('the guide keeps the token in the keychain or the machine directory and checks it by length', () => {
  const guide = readFileSync(join(CHECKOUT, 'docs/guide/unattended-credential.md'), 'utf8');
  for (const want of [
    'claude setup-token',
    'outside any agent session',
    'only one of them may be masked',
    'security add-generic-password',
    'cmdkey /generic:claude-code-oauth-token',
    'secret-tool store',
    '_machine/credentials/claude-code-oauth-token',
    'wc -c',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ]) {
    assert.ok(guide.includes(want), want);
  }
  assert.match(guide, /Never keep it in the project, in a log, or in an environment file/);
  assert.doesNotMatch(guide, /export CLAUDE_CODE_OAUTH_TOKEN|>> ?\.env/);
  // install's steps name the same stores.
  assert.match(
    setupSteps('darwin').join(),
    /security add-generic-password -a "\$USER" -s claude-code-oauth-token -w/,
  );
  assert.match(setupSteps('win32').join(), /cmdkey \/generic:claude-code-oauth-token/);
  assert.match(setupSteps('linux', '/m').join(), /\/m\/credentials\/claude-code-oauth-token/);
});

test('the launcher gives the child the token in its environment only, with tracing variables out, and drops it', () => {
  const env = { PATH: '/bin', SHELLOPTS: 'xtrace', BASH_XTRACEFD: '2', PS4: '+ ' };
  const child = childEnv(env, TOKEN);
  assert.equal(child[TOKEN_ENV], TOKEN);
  assert.equal(child.SHELLOPTS, undefined);
  assert.equal(child.BASH_XTRACEFD, undefined);
  assert.equal(
    env[/** @type {keyof typeof env} */ (TOKEN_ENV)],
    undefined,
    "the caller's is untouched",
  );
  const started = credentialEnv({ env, machineDir: null, platform: 'win32', run: () => TOKEN });
  assert.deepEqual(started.credential, { kind: 'oauth-token', source: 'credential-manager' });
  assert.equal(started.env[TOKEN_ENV], TOKEN);
  // One the environment already gives is used as it is, and nothing is read.
  const given = credentialEnv({
    env: { ANTHROPIC_API_KEY: 'k' },
    machineDir: null,
    run: () => assert.fail('the keychain is not read'),
  });
  assert.deepEqual(given.credential, {
    kind: 'api-key',
    source: 'environment',
    variable: 'ANTHROPIC_API_KEY',
  });
});

test(
  'the launcher refuses to start an executor without a long-lived credential, saying why without any value',
  { skip: !POSIX },
  () => {
    const dir = tempDir('hitld-880-launch-');
    const child = join(dir, 'child.mjs');
    writeFileSync(
      child,
      `process.stdout.write(JSON.stringify({ token: process.env.${TOKEN_ENV} === ${JSON.stringify(TOKEN)}, shellopts: process.env.SHELLOPTS ?? null }));\n`,
    );
    writeFileSync(join(dir, 'brief.md'), 'brief');
    const machineDir = join(dir, 'machine');
    /** @param {string | null} token */
    const launch = (token) =>
      spawnSync(
        process.execPath,
        [
          LAUNCHER,
          '--credential',
          'claude-code',
          '--machine-dir',
          machineDir,
          '--pid',
          join(dir, 'run.pid'),
          '--in',
          join(dir, 'brief.md'),
          '--out',
          join(dir, 'run.json'),
          '--err',
          join(dir, 'run.stderr'),
          '--',
          process.execPath,
          child,
        ],
        {
          encoding: 'utf8',
          env: { PATH: `${keychainTools(token)}:${process.env.PATH}`, SHELLOPTS: 'xtrace' },
        },
      );

    const refused = launch(null);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refused to start the executor: no long-lived credential/);
    assert.match(refused.stderr, /claude setup-token/);
    assert.equal(existsSync(join(dir, 'run.pid')), false, 'nothing started');
    assert.equal(existsSync(join(dir, 'run.json')), false, 'no result file to look like a run');

    const started = launch(TOKEN);
    assert.equal(started.status, 0, started.stderr);
    assert.ok(!started.stdout.includes(TOKEN) && !started.stderr.includes(TOKEN));
    assert.match(
      started.stdout,
      /"credential":\{"kind":"oauth-token","source":"(secret-service|keychain)"\}/,
    );
    const pid = Number(readFileSync(join(dir, 'run.pid'), 'utf8'));
    for (let i = 0; i < 200; i++) {
      if (readFileSync(join(dir, 'run.json'), 'utf8')) break;
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']);
    }
    assert.ok(pid > 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), {
      token: true,
      shellopts: null,
    });
  },
);

test(
  'env status says which credential executors run on, and when the interactive sign-in can end, never the value',
  { skip: !POSIX },
  async () => {
    const c = makeConsumer();
    const env = { PATH: `${keychainTools(null)}:${process.env.PATH}` };
    const store = join(c.data, 'human-in-the-lead/orch-fixture');
    mkdirSync(join(store, 'dispatch/results'), { recursive: true });
    // What Claude Code prints on standard error when a headless run starts on the sign-in.
    writeFileSync(
      join(store, 'dispatch/results/D-1.stderr'),
      `Warning: this sign-in ends between ${day(5)} and ${day(11)} (in 5 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.\n`,
    );
    const before = await c.hitld(['env', 'status'], { env });
    assert.equal(before.exit, 0, JSON.stringify(before.result));
    const credential = before.result.credential;
    assert.equal(credential.long_lived, false);
    assert.equal(credential.kind, 'interactive');
    const ends = credential.sign_in_ends;
    assert.equal(ends.earliest, day(5));
    assert.equal(ends.latest, day(11));
    assert.equal(ends.from, 'D-1.stderr');
    assert.equal(ends.state, 'ahead');
    assert.ok([4, 5].includes(ends.days_left), String(ends.days_left));
    assert.match(
      credential.summary,
      new RegExp(
        `interactive sign-in, which can end in [45] days at the earliest, between ${day(5)} and ${day(11)}`,
      ),
    );
    assert.ok(
      before.result.warnings.some((/** @type {string} */ w) => /claude setup-token/.test(w)),
    );

    tokenFile(join(c.data, 'human-in-the-lead/_machine'));
    const after = await c.hitld(['env', 'status'], { env });
    assert.equal(after.result.credential.long_lived, true);
    assert.equal(after.result.credential.source, 'machine-file');
    assert.equal(after.result.credential.length, TOKEN.length);
    assert.match(after.result.credential.summary, /long-lived credential/);
    assert.equal(after.result.warnings, undefined);
    assert.ok(!JSON.stringify(after.result).includes(TOKEN.slice(20, 40)), 'never the value');

    // A run whose warning said the sign-in may already have ended: status says it has.
    rmSync(join(c.data, 'human-in-the-lead/_machine/credentials'), { recursive: true });
    writeFileSync(
      join(store, 'dispatch/results/D-1.stderr'),
      `Warning: this sign-in may have ended between ${day(-10)} and ${day(-3)}. If requests are refused, run claude auth login, or use claude setup-token for unattended jobs.\n`,
    );
    const ended = await c.hitld(['env', 'status'], { env });
    assert.equal(ended.result.credential.sign_in_ends.state, 'ended');
    assert.match(ended.result.credential.summary, /which has ended/);

    const fromEnv = await c.hitld(['env', 'status'], { env: { ...env, ANTHROPIC_API_KEY: 'k' } });
    assert.equal(fromEnv.result.credential.source, 'environment');
    assert.equal(fromEnv.result.credential.variable, 'ANTHROPIC_API_KEY');
  },
);

test('a credential lost mid-run is read from the run output: the result event, an authentication_failed event, or its errors', () => {
  const line = (/** @type {unknown} */ x) => JSON.stringify(x);
  const expired = [
    line({ type: 'system', subtype: 'init', session_id: 's' }),
    line({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'OAuth token has expired. Please obtain a new token or refresh your existing token.',
      session_id: 's',
    }),
  ].join('\n');
  assert.match(String(headlessCompletion(expired).credentialFailure), /OAuth token has expired/);
  assert.match(
    String(
      credentialFailure([
        {
          type: 'assistant',
          error: 'authentication_failed',
          message: { content: [{ type: 'text', text: 'Invalid API key' }] },
        },
      ]),
    ),
    /authentication failed: Invalid API key/,
  );
  assert.match(
    String(credentialFailure([], 'Error: Invalid API key · Please run /login\n')),
    /Invalid API key/,
  );
  assert.equal(credentialFailure([{ type: 'result', result: 'item: W-1\nresult: done' }]), null);
  assert.match(
    String(
      credentialFailure(
        [],
        'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again\n',
      ),
    ),
    /reached its time limit/,
  );
  // A credential in the line is redacted by its shape.
  assert.equal(
    credentialFailure([], `401 authentication_error for token ${TOKEN}\n`),
    '401 authentication_error for token [REDACTED:ANTHROPIC_TOKEN]',
  );
});

test("the sign-in's end is read in each of Claude Code's wordings and compared with now", () => {
  const now = Date.parse('2026-12-10T12:00:00Z');
  /** @type {[string, Record<string, unknown>, Record<string, unknown>][]} */
  const cases = [
    [
      'Warning: this sign-in ends between 2026-12-15 and 2026-12-20 (in 5 days at the earliest). Renewing it does not move those dates.',
      { earliest: '2026-12-15', latest: '2026-12-20', said_ended: false },
      { state: 'ahead', days_left: 4 },
    ],
    [
      'Warning: this sign-in can end at any time from now until 2026-12-12. Renewing it does not move that date.',
      { earliest: null, latest: '2026-12-12', said_ended: false },
      { state: 'any-day-now', days_left: 0 },
    ],
    [
      'Warning: this sign-in may have ended between 2026-12-01 and 2026-12-06. If requests are refused, run claude auth login',
      { earliest: '2026-12-01', latest: '2026-12-06', said_ended: true },
      { state: 'ended', days_left: 0 },
    ],
    [
      'Sign-in ends: between 2026-12-08 and 2026-12-14 (2026-12-14T09:00:00.000Z)',
      { earliest: '2026-12-08', latest: '2026-12-14', said_ended: false },
      { state: 'any-day-now', days_left: 0 },
    ],
    [
      'Sign-in ends: any day now, by 2026-12-11 (2026-12-11T09:00:00.000Z)',
      { earliest: null, latest: '2026-12-11', said_ended: false },
      { state: 'any-day-now', days_left: 0 },
    ],
    [
      'Sign-in may have ended: between 2026-11-20 and 2026-11-27 (2026-11-27T09:00:00.000Z)',
      { earliest: '2026-11-20', latest: '2026-11-27', said_ended: true },
      { state: 'ended', days_left: 0 },
    ],
  ];
  for (const [line, end, state] of cases) {
    const got = signInEndsIn(`something else\n${line}\n`);
    assert.deepEqual(got, end, line);
    assert.deepEqual(signInState(/** @type {any} */ (got), now), state, line);
  }
  // A date passed since the warning was printed: the run said "ahead", now it has ended.
  const old = /** @type {any} */ (signInEndsIn(cases[0][0]));
  assert.equal(signInState(old, Date.parse('2026-12-21T00:00:01Z')).state, 'ended');
  assert.equal(signInEndsIn('nothing about it'), null);
  assert.equal(
    signInEndsIn('use claude setup-token before 2026-12-20'),
    null,
    'no invented wording',
  );
});

test('a token found by its shape is redacted from what hitld shows, declared or not', () => {
  const r = createRedactor({});
  assert.equal(
    r.redact(
      `env: CLAUDE_CODE_OAUTH_TOKEN=${TOKEN} ANTHROPIC_API_KEY=sk-ant-api03-abcdefghij_KLM-123`,
    ),
    'env: CLAUDE_CODE_OAUTH_TOKEN=[REDACTED:ANTHROPIC_TOKEN] ANTHROPIC_API_KEY=[REDACTED:ANTHROPIC_TOKEN]',
  );
  assert.equal(r.counts.ANTHROPIC_TOKEN, 2);
  assert.equal(r.redact('sk-ant- is a prefix, not a token'), 'sk-ant- is a prefix, not a token');
  assert.ok(r.longest >= 128, 'a capture cut short keeps room for a whole token');
});

test('a detached executor that loses its credential mid-run is recorded blocked with the reason, not left silent', async () => {
  // The judgment: ended or gone, no report, and the output says the credential failed.
  const entry = /** @type {any} */ ({
    dispatch: 'D-1',
    item: 'W-1',
    mode: 'headless',
    branch: 'b',
  });
  const gone = judgeDispatch({
    entry,
    heads: [],
    harness: {
      ended: false,
      gone: true,
      evidence: {},
      credentialFailure: 'OAuth token has expired',
    },
    hasRecord: false,
  });
  assert.equal(gone.state, 'blocked');
  assert.match(gone.why, /stopped for its credential \(OAuth token has expired\)/);

  // The pass records it.
  const c = makeConsumer({
    files: {
      'work/items/W-5-change.md': item({
        id: 'W-5',
        title: 'change W-5',
        kind: 'work',
        state: 'planned',
        tier_override: '2',
        touches: ['src/w-5.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-5', '--mode', 'headless']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const { dispatch } = start.result;
  const store = openStore(join(c.data, 'human-in-the-lead/orch-fixture'));
  // A run that has ended: a process that has exited, its output ending on the refused credential.
  const ended = spawnSync(process.execPath, ['-e', '0']);
  mkdirSync(join(store.root, 'dispatch/pids'), { recursive: true });
  writeFileSync(join(store.root, `dispatch/pids/${dispatch}.pid`), `${ended.pid}\n`);
  writeFileSync(
    join(store.root, `dispatch/results/${dispatch}.json`),
    [
      { type: 'system', subtype: 'init', session_id: 'sess-lost' },
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result:
          'Failed to authenticate. API Error: 401 authentication_error: OAuth token has expired',
        session_id: 'sess-lost',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n') + '\n',
  );
  const handled = await c.hitld([
    'dispatch',
    'handle',
    '--dispatch',
    dispatch,
    '--harness-ref',
    String(ended.pid),
  ]);
  assert.equal(handled.exit, 0, JSON.stringify(handled.result));
  const pass = await c.hitld(['dispatch', 'reconcile']);
  assert.equal(pass.exit, 0, JSON.stringify(pass.result));
  const shown = pass.result.dispatches.find((/** @type {any} */ d) => d.dispatch === dispatch);
  assert.equal(shown.state, 'blocked', JSON.stringify(shown));
  assert.match(shown.evidence.credential_failure, /OAuth token has expired/);
  assert.equal(shown.recorded, true, JSON.stringify(shown));
  assert.equal(shown.completion.result, 'blocked');
  assert.equal(shown.completion.blocked_by, 'credential');
  assert.match(shown.completion.next, /claude setup-token/);
  const reported = readLedger(store).events.filter(
    (e) => e.event === 'reported' && e.dispatch === dispatch,
  );
  assert.equal(reported.length, 1);
  assert.equal(reported[0].result, 'blocked');
  assert.match(String(reported[0].notes), /stopped for its credential: Failed to authenticate/);
  const again = await c.hitld(['dispatch', 'reconcile']);
  assert.deepEqual(again.result.recorded, [], 'recorded once');
});

test('an unattended credential report never carries the value', () => {
  const c = unattendedCredential({
    env: {},
    machineDir: null,
    platform: 'win32',
    run: () => 'not-a-setup-token',
  });
  assert.equal(c.long_lived, true);
  assert.equal(c.length, 'not-a-setup-token'.length);
  assert.match(c.problems.join(), /does not start with sk-ant-oat/);
  assert.ok(!JSON.stringify(c).includes('not-a-setup-token'));
});

test('the sign-in date is read from what the harness printed, never from the agent or the brief', () => {
  const dir = tempDir('hitld-880-results-');
  const said = (/** @type {Record<string, unknown>} */ e) => JSON.stringify(e);
  writeFileSync(
    join(dir, 'D-2.json'),
    [
      said({
        type: 'user',
        message: { content: 'this sign-in can end at any time from now until 2030-01-01' },
      }),
      said({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Sign-in ends: between 2031-01-01 and 2031-01-07' }],
        },
      }),
    ].join('\n'),
  );
  assert.equal(signInEnds(dir), null);
  writeFileSync(
    join(dir, 'D-3.json'),
    said({
      type: 'system',
      subtype: 'notice',
      text: 'Warning: this sign-in can end at any time from now until 2026-12-20. Renewing it does not move that date. Run claude auth login now, or use claude setup-token for unattended jobs.',
    }),
  );
  assert.deepEqual(signInEnds(dir), {
    earliest: null,
    latest: '2026-12-20',
    said_ended: false,
    from: 'D-3.json',
  });
});
