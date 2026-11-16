// The release workflow's check that the `release` environment has a required reviewer (HITLD-140).
// A local HTTP server stands in for the GitHub API; every case but a protected environment fails
// closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { judgeEnvironment } from '../../scripts/release-environment.mjs';

const script = fileURLToPath(new URL('../../scripts/release-environment.mjs', import.meta.url));
const workflow = fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url));

const PROTECTED = {
  name: 'release',
  protection_rules: [
    { id: 1, node_id: 'n1', type: 'wait_timer', wait_timer: 0 },
    {
      id: 2,
      node_id: 'n2',
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: 'owner', id: 1 } }],
    },
    { id: 3, node_id: 'n3', type: 'branch_policy' },
  ],
};
const ok = (/** @type {unknown} */ body) => ({ status: 200, body: JSON.stringify(body) });

test('judge: a required-reviewers rule with a reviewer passes', () => {
  assert.deepEqual(judgeEnvironment('release', ok(PROTECTED)), {
    ok: true,
    environment: 'release',
    reviewers: 1,
  });
});

test('judge: no required reviewer is refused, with how to add one', () => {
  for (const body of [
    { name: 'release', protection_rules: [] },
    { name: 'release' },
    { name: 'release', protection_rules: [{ type: 'branch_policy' }] },
    { name: 'release', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] },
    { name: 'release', protection_rules: [{ type: 'required_reviewers' }] },
    null,
  ]) {
    const r = judgeEnvironment('release', ok(body));
    assert.equal(r.ok, false, JSON.stringify(body));
    if (r.ok) continue;
    assert.match(r.problem, /has no required reviewer/);
    assert.match(r.problem, /Settings → Environments → release → .*Required reviewers/);
  }
});

test('judge: a missing environment is refused, with how to create it', () => {
  const r = judgeEnvironment('release', { status: 404, body: '{"message":"Not Found"}' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.problem, /has no release environment/);
  assert.match(r.problem, /New environment → Name release/);
  assert.match(r.problem, /Required reviewers/);
});

test('judge: an API error fails closed', () => {
  const cases = /** @type {const} */ ([
    [
      { status: 403, body: '{"message":"Resource not accessible by integration"}' },
      /answered 403 \(the record job needs the `actions: read` permission/,
    ],
    [{ status: 401, body: '' }, /answered 401 \(the record job needs/],
    [{ status: 500, body: '' }, /answered 500$/],
    [{ status: 200, body: '<html>' }, /answered with no JSON/],
    [
      new Error('connect ECONNREFUSED'),
      /could not read the release environment: connect ECONNREFUSED/,
    ],
  ]);
  for (const [answer, expected] of cases) {
    const r = judgeEnvironment('release', answer);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.problem, expected);
  }
});

/**
 * Run the script against a stand-in API that answers every request with `status` and `body`.
 * @param {number | null} status null: no server listening
 * @param {unknown} [body]
 * @param {string[]} [args]
 */
async function run(status, body, args = []) {
  /** @type {{ url?: string, auth?: string, version?: string }} */
  const seen = {};
  const server = createServer((req, res) => {
    seen.url = req.url;
    seen.auth = req.headers.authorization;
    seen.version = String(req.headers['x-github-api-version']);
    res.writeHead(status ?? 500, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  if (status === null) await new Promise((done) => server.close(done));
  const { NODE_TEST_CONTEXT: _t, GH_TOKEN: _g, GITHUB_REPOSITORY: _r, ...rest } = process.env;
  const child = spawn(process.execPath, [script, ...args], {
    env: {
      ...rest,
      GH_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_ACTIONS: 'true',
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((done) => child.on('close', done));
  if (status !== null) await new Promise((done) => server.close(done));
  return { code, stdout, stderr, seen };
}

test('script: a protected environment passes, read with the token at the environment URL', async () => {
  const r = await run(200, PROTECTED);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  assert.equal(r.seen.url, '/repos/owner/repo/environments/release');
  assert.equal(r.seen.auth, 'Bearer test-token');
  assert.equal(r.seen.version, '2022-11-28');
});

test('script: no reviewer, a missing environment and API errors exit 1 with an annotation', async () => {
  for (const [status, body, expected] of /** @type {const} */ ([
    [200, { name: 'release', protection_rules: [] }, /has no required reviewer/],
    [404, { message: 'Not Found' }, /has no release environment/],
    [403, { message: 'Resource not accessible by integration' }, /answered 403/],
    [502, 'bad gateway', /answered 502/],
    [null, undefined, /could not read the release environment: /],
  ])) {
    const r = await run(status, body);
    assert.equal(r.code, 1, `${status}: ${r.stdout}`);
    assert.match(r.stderr, expected);
    assert.match(r.stdout, /^::error title=Release refused::/m);
  }
});

test('script: usage errors exit 2 and make no request', async () => {
  const r = await run(200, PROTECTED, ['--repo', 'not a repo']);
  assert.equal(r.code, 2);
  assert.equal(r.seen.url, undefined);
});

test('workflow: the record job runs the check, with actions: read, before the release job', () => {
  const text = readFileSync(workflow, 'utf8');
  const record = text.slice(text.indexOf('\n  record:'), text.indexOf('\n  release:'));
  assert.match(record, /\n {6}actions: read\b/);
  assert.match(record, /node scripts\/release-environment\.mjs --environment release/);
  const release = text.slice(text.indexOf('\n  release:'), text.indexOf('\n  tagged:'));
  assert.match(release, /\n {4}needs: record\n/);
  assert.match(release, /\n {4}environment: release\n/);
});
