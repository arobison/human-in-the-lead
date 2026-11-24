// The credential detached executors run on (HITLD-880, GitHub issue 547): install reports it on
// setup and upgrade, the guide keeps it in the keychain or the machine directory, the launcher
// reads it into the child's environment only and refuses without it, env status names it without
// its value, and a run that loses it mid-run is recorded blocked with the reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../lib/install/install.mjs';
import { POLICY_PATH } from '../lib/policy/policy.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { openStore } from '../lib/store/store.mjs';
import { judgeDispatch } from '../lib/dispatch/reconcile.mjs';
import { headlessCompletion } from '../harness/claude-code/completion.mjs';
import {
  SERVICE,
  TOKEN_ENV,
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

/**
 * A directory of stand-in keychain tools: each prints `token` for the service, or fails when it
 * is null, so no real keychain on the machine running the test is read.
 * @param {string | null} token
 */
function keychainTools(token) {
  const bin = tempDir('hitld-880-bin-');
  for (const tool of ['security', 'secret-tool']) {
    const body =
      token === null
        ? 'exit 1'
        : `case "$*" in *${SERVICE}*) printf '%s\\n' '${token}' ;; *) exit 1 ;; esac`;
    writeFileSync(join(bin, tool), `#!/bin/sh\n${body}\n`);
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

test('the keychain is read with no shell, by service, per platform; the two printed lines join into one value', () => {
  /** @type {[string, string[]][]} */
  const calls = [];
  /** @param {string | null} out */
  const fake = (out) => (/** @type {string} */ program, /** @type {string[]} */ args) => {
    calls.push([program, args]);
    return out;
  };
  const darwin = readToken({
    env: {},
    machineDir: null,
    platform: 'darwin',
    run: fake(`${TOKEN}\n`),
  });
  assert.deepEqual(darwin, { value: TOKEN, source: 'keychain' });
  assert.deepEqual(calls.at(-1), ['security', ['find-generic-password', '-s', SERVICE, '-w']]);
  const linux = readToken({ env: {}, machineDir: null, platform: 'linux', run: fake(TOKEN) });
  assert.deepEqual(linux, { value: TOKEN, source: 'secret-service' });
  assert.deepEqual(calls.at(-1), ['secret-tool', ['lookup', 'service', SERVICE]]);
  const win = readToken({
    env: {},
    machineDir: null,
    platform: 'win32',
    run: fake(`${TOKEN.slice(0, 50)}\r\n${TOKEN.slice(50)}`),
  });
  assert.deepEqual(win, { value: TOKEN, source: 'credential-manager' }, 'a break pasted in goes');
  const [program, args] = /** @type {[string, string[]]} */ (calls.at(-1));
  assert.equal(program, 'powershell.exe');
  const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
  assert.match(script, /CredRead/);
  assert.match(script, new RegExp(SERVICE));
  const none = readToken({ env: {}, machineDir: null, platform: 'linux', run: fake(null) });
  assert.equal(none.value, null);
  assert.deepEqual('looked_in' in none ? none.looked_in : [], [
    `the Secret Service through libsecret (service ${SERVICE})`,
  ]);
});

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
    chmodSync(file, 0o644);
    const open = readToken({ env: {}, machineDir, platform: 'linux', run });
    assert.equal(open.value, null);
    assert.match('problems' in open ? open.problems.join() : '', /read by other users: chmod 600/);
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
  const started = credentialEnv({ env, machineDir: null, platform: 'linux', run: () => TOKEN });
  assert.deepEqual(started.credential, { kind: 'oauth-token', source: 'secret-service' });
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
    writeFileSync(
      join(store, 'dispatch/results/D-1.stderr'),
      'Your sign-in can end at any time before 2026-12-20; renewing it does not move the date. For unattended jobs, use claude setup-token.\n',
    );
    const before = await c.hitld(['env', 'status'], { env });
    assert.equal(before.exit, 0, JSON.stringify(before.result));
    const credential = before.result.credential;
    assert.equal(credential.long_lived, false);
    assert.equal(credential.kind, 'interactive');
    assert.equal(credential.sign_in_ends, '2026-12-20');
    assert.match(
      credential.summary,
      /interactive sign-in, which can end at any time before 2026-12-20/,
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
  assert.equal(signInEndsIn('nothing about it'), null);
  assert.equal(
    signInEndsIn('can end before December 20, 2026. Use claude setup-token'),
    'December 20, 2026',
  );
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
    platform: 'linux',
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
      said({ type: 'user', message: { content: 'use claude setup-token before 2030-01-01' } }),
      said({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'setup-token by 2031-01-01' }] },
      }),
    ].join('\n'),
  );
  assert.equal(signInEnds(dir), null);
  writeFileSync(
    join(dir, 'D-3.json'),
    said({
      type: 'system',
      subtype: 'notice',
      text: 'Your sign-in can end before 2026-12-20. For unattended jobs use claude setup-token',
    }),
  );
  assert.deepEqual(signInEnds(dir), { date: '2026-12-20', from: 'D-3.json' });
});
