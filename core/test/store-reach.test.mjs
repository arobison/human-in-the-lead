// Why the store does not sync here (HITLD-142): each named cause, from git's own words and from
// what this device's copy of the store says. The run-level tests are in store-auto-sync.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_CAUSES,
  causesLine,
  cloudSession,
  failureCauses,
  remoteCause,
  syncCauses,
} from '../lib/store/reach.mjs';

const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const HERE = {};
const HTTPS = 'https://git.example.invalid/owner/store.git';

// What git says, as a cloud session and machines have shown it.
const NO_USERNAME =
  "could not reach the remote: fatal: could not read Username for 'https://git.example.invalid': terminal prompts disabled";
const NO_KEY =
  'could not reach the remote: git@git.example.invalid: Permission denied (publickey).\nfatal: Could not read from remote repository.';
const NOT_FOUND =
  'could not reach the remote: remote: Repository not found.\nfatal: repository not found';
const NOT_A_REPO =
  "could not reach the remote: fatal: '/srv/store.git' does not appear to be a git repository";
const REFUSED =
  "could not reach the remote: fatal: unable to access 'https://127.0.0.1:9/o/s.git/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server";
const PROXY =
  "could not reach the remote: fatal: unable to access 'https://git.example.invalid/o/s.git/': CONNECT tunnel failed, response 403";
const DNS =
  "could not reach the remote: fatal: unable to access 'https://git.example.invalid/o/s.git/': Could not resolve host: git.example.invalid";

/** @param {string} message @param {NodeJS.ProcessEnv} env @param {string} [url] */
const of = (message, env, url = HTTPS) => remoteCause(message, { env, url }).cause;

test('a cloud session is told by CLAUDE_CODE_REMOTE', () => {
  assert.equal(cloudSession(CLOUD), true);
  assert.equal(cloudSession({ CLAUDE_CODE_REMOTE: 'false' }), false);
  assert.equal(cloudSession({ CLAUDE_CODE_REMOTE: '0' }), false);
  assert.equal(cloudSession(HERE), false);
});

test('repository-not-attached: a refused sign-in or a missing repository in a cloud session', () => {
  assert.equal(of(NO_USERNAME, CLOUD), 'repository-not-attached');
  assert.equal(of(NO_KEY, CLOUD), 'repository-not-attached');
  assert.equal(of(NOT_FOUND, CLOUD), 'repository-not-attached');
  // A local or mounted repository is never one the session has to attach.
  assert.equal(of(NOT_A_REPO, CLOUD, '/srv/store.git'), 'repository-not-found');
  assert.equal(of(NOT_A_REPO, CLOUD, 'file:///srv/store.git'), 'repository-not-found');
});

test('no-credentials: a refused sign-in on a machine', () => {
  assert.equal(of(NO_USERNAME, HERE), 'no-credentials');
  assert.equal(of(NO_KEY, HERE), 'no-credentials');
  assert.equal(
    of('fatal: Authentication failed for https://git.example.invalid/', HERE),
    'no-credentials',
  );
});

test('repository-not-found: the host answered, and there is no such repository', () => {
  assert.equal(of(NOT_FOUND, HERE), 'repository-not-found');
  assert.equal(of(NOT_A_REPO, HERE, '/srv/store.git'), 'repository-not-found');
});

test('host-unreachable: no connection, a refusing proxy or a name that does not resolve, anywhere', () => {
  for (const env of [HERE, CLOUD]) {
    assert.equal(of(REFUSED, env), 'host-unreachable');
    assert.equal(of(PROXY, env), 'host-unreachable');
    assert.equal(of(DNS, env), 'host-unreachable');
  }
});

test('remote-failed: anything else keeps git words in the error, not in the cause', () => {
  assert.equal(of('fatal: unable to fork', HERE), 'remote-failed');
});

test('a pull that failed: the remote cause, and device-not-pulled when this copy cannot tell', () => {
  const unreachable = { code: 'remote-unreachable', message: NO_USERNAME };
  const fresh = { identity: 'AGE-SECRET-KEY-1X', enrolled: false };
  assert.deepEqual(
    failureCauses(unreachable, { env: CLOUD, url: HTTPS, devices: fresh }).map((c) => c.cause),
    ['repository-not-attached', 'device-not-pulled'],
  );
  assert.deepEqual(
    failureCauses(unreachable, {
      env: CLOUD,
      url: HTTPS,
      devices: { ...fresh, enrolled: true },
    }).map((c) => c.cause),
    ['repository-not-attached'],
  );
  assert.deepEqual(
    failureCauses({ code: 'age-no-match', message: 'no key opens it' }, { env: HERE }).map(
      (c) => c.cause,
    ),
    ['device-not-enrolled'],
  );
  assert.deepEqual(failureCauses({ code: 'conflict', message: 'x' }, { env: HERE }), []);
});

test('syncCauses: ready only when the remote is read and this device opens it', () => {
  const key = { identity: 'AGE-SECRET-KEY-1X', enrolled: true };
  /** @type {Parameters<typeof syncCauses>[0]} */
  const base = {
    address: HTTPS,
    required: false,
    env: HERE,
    remoteError: null,
    remoteEmpty: false,
    opens: true,
    devices: key,
  };
  assert.deepEqual(syncCauses(base), { ready: true, local_only: false, causes: [] });
  const codes = (/** @type {Partial<typeof base>} */ o) =>
    syncCauses({ ...base, ...o }).causes.map((c) => c.cause);
  // No address: a machine's own store is fine; a cloud session or a required remote is not.
  assert.deepEqual(syncCauses({ ...base, address: null }), {
    ready: true,
    local_only: true,
    causes: [],
  });
  assert.deepEqual(codes({ address: null, env: CLOUD }), ['no-remote']);
  assert.deepEqual(codes({ address: null, required: true }), ['no-remote']);
  assert.deepEqual(codes({ devices: { identity: null, enrolled: false }, opens: null }), [
    'device-no-key',
  ]);
  assert.deepEqual(codes({ opens: false }), ['device-not-enrolled']);
  assert.deepEqual(
    codes({ remoteEmpty: true, opens: null, devices: { ...key, enrolled: false } }),
    ['device-not-enrolled'],
  );
  assert.deepEqual(
    codes({
      env: CLOUD,
      remoteError: { code: 'remote-unreachable', message: NO_USERNAME },
      opens: null,
      devices: { ...key, enrolled: false },
    }),
    ['repository-not-attached', 'device-not-pulled'],
  );
});

test('every cause names things by role and says what fixes it', () => {
  for (const [code, c] of Object.entries(STORE_CAUSES)) {
    assert.match(code, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(c.message.length > 20 && c.fix.length > 20, code);
    assert.doesNotMatch(`${c.message} ${c.fix}`, /https?:\/\/|@/, code);
  }
  const line = causesLine([remoteCause(NO_USERNAME, { env: CLOUD, url: HTTPS })]);
  assert.match(
    line,
    /^repository-not-attached: the store repository is not attached.*To fix: attach/,
  );
  assert.doesNotMatch(line, /git\.example\.invalid/);
});
