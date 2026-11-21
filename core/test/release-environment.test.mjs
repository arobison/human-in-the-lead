// The release workflow's check that the `release` environment has a required reviewer
// (HITLD-140), that administrators cannot bypass it, and that it takes deployments from the branch
// `main` only (HITLD-229). A local HTTP server stands in for the GitHub API; every case but a
// protected environment fails closed.
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
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
const MAIN_ONLY = {
  total_count: 1,
  branch_policies: [{ id: 7, node_id: 'p7', name: 'main', type: 'branch' }],
};
const ok = (/** @type {unknown} */ body) => ({ status: 200, body: JSON.stringify(body) });
const MAIN = ok(MAIN_ONLY);

test('judge: a required-reviewers rule with a reviewer passes', () => {
  assert.deepEqual(judgeEnvironment('release', ok(PROTECTED), MAIN), {
    ok: true,
    environment: 'release',
    reviewers: 1,
  });
});

test('judge: no required reviewer is refused, with how to add one', () => {
  const rest = {
    can_admins_bypass: false,
    deployment_branch_policy: PROTECTED.deployment_branch_policy,
  };
  for (const body of [
    { name: 'release', protection_rules: [], ...rest },
    { name: 'release', ...rest },
    { name: 'release', protection_rules: [{ type: 'branch_policy' }], ...rest },
    { name: 'release', protection_rules: [{ type: 'required_reviewers', reviewers: [] }], ...rest },
    { name: 'release', protection_rules: [{ type: 'required_reviewers' }], ...rest },
    null,
  ]) {
    const r = judgeEnvironment('release', ok(body), MAIN);
    assert.equal(r.ok, false, JSON.stringify(body));
    if (r.ok) continue;
    assert.match(r.problem, /has no required reviewer/);
    assert.match(r.problem, /Settings → Environments → release → .*Required reviewers/);
  }
});

test('judge: administrators who can bypass the rules are refused, with how to stop it', () => {
  for (const [bypass, expected] of /** @type {const} */ ([
    [true, /^administrators can bypass the release environment's protection rules/],
    [undefined, /^could not tell whether administrators can bypass/],
    ['false', /^could not tell whether administrators can bypass/],
    [null, /^could not tell whether administrators can bypass/],
  ])) {
    const r = judgeEnvironment('release', ok({ ...PROTECTED, can_admins_bypass: bypass }), MAIN);
    assert.equal(r.ok, false, String(bypass));
    if (r.ok) continue;
    assert.match(r.problem, expected);
    assert.match(
      r.problem,
      /Settings → Environments → release → Deployment protection rules → uncheck Allow administrators to bypass/,
    );
    assert.doesNotMatch(r.problem, /required reviewer|deployments from/);
  }
});

test('judge: an environment not limited to the branch main is refused, with how to limit it', () => {
  const custom = PROTECTED.deployment_branch_policy;
  const list = (/** @type {unknown[]} */ policies) =>
    ok({ total_count: policies.length, branch_policies: policies });
  const cases = /** @type {const} */ ([
    [null, MAIN, /takes deployments from any branch/],
    [undefined, MAIN, /takes deployments from any branch/],
    [
      { protected_branches: true, custom_branch_policies: false },
      MAIN,
      /from any protected branch, not only main/,
    ],
    [{ protected_branches: false, custom_branch_policies: false }, MAIN, /not limited to selected/],
    [{}, MAIN, /not limited to selected branches/],
    [custom, list([]), /from no rule, not the branch main only/],
    [
      custom,
      list([
        { name: 'main', type: 'branch' },
        { name: 'release/*', type: 'branch' },
      ]),
      /from branch main, branch release\/\*, not the branch main only/,
    ],
    [custom, list([{ name: 'main', type: 'tag' }]), /from tag main, not/],
    [custom, list([{ name: 'ma*', type: 'branch' }]), /from branch ma\*, not/],
    [custom, list([{ name: 'main' }]), /from unknown main, not/],
    [
      custom,
      ok({ total_count: 2, branch_policies: MAIN_ONLY.branch_policies }),
      /no complete list/,
    ],
    [custom, ok({ branch_policies: MAIN_ONLY.branch_policies }), /no complete list/],
    [custom, ok({ total_count: 0 }), /no complete list/],
    [custom, ok(null), /no complete list/],
    [custom, { status: 200, body: '<html>' }, /branch rules: the GitHub API answered with no JSON/],
    [custom, { status: 404, body: '' }, /branch rules: the GitHub API answered 404,/],
    [
      custom,
      { status: 403, body: '' },
      /branch rules: the GitHub API answered 403 \(the record job/,
    ],
    [custom, new Error('socket hang up'), /deployment branch rules: socket hang up/],
    [custom, undefined, /deployment branch rules: it was not read/],
  ]);
  for (const [policy, policies, expected] of cases) {
    const r = judgeEnvironment(
      'release',
      ok({ ...PROTECTED, deployment_branch_policy: policy }),
      policies,
    );
    assert.equal(r.ok, false, JSON.stringify(policy));
    if (r.ok) continue;
    assert.match(r.problem, expected);
    assert.match(
      r.problem,
      /Deployment branches and tags → Selected branches and tags → .*Ref type Branch, name pattern main/,
    );
    assert.doesNotMatch(r.problem, /required reviewer|administrators/);
  }
});

test('judge: the branch rules are not needed unless the environment uses selected branches', () => {
  const r = judgeEnvironment(
    'release',
    ok({ ...PROTECTED, deployment_branch_policy: null }),
    new Error('unused'),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(r.problem, /unused/);
});

test('judge: every problem is named at once', () => {
  const r = judgeEnvironment(
    'release',
    ok({ name: 'release', protection_rules: [], can_admins_bypass: true }),
    MAIN,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(
    r.problem,
    /has no required reviewer.* Also: administrators can bypass.* Also: the release environment takes deployments from any branch/,
  );
});

test('judge: a missing environment is refused, with how to create it', () => {
  const r = judgeEnvironment('release', { status: 404, body: '{"message":"Not Found"}' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.problem, /has no release environment/);
  assert.match(r.problem, /New environment → Name release/);
  assert.match(r.problem, /Required reviewers/);
  assert.match(r.problem, /uncheck Allow administrators to bypass configured protection rules/);
  assert.match(r.problem, /limit Deployment branches and tags to the branch main/);
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
 * Run the script against a stand-in API that answers the environment with `status` and `body`,
 * and its deployment branch rules with `policies` (status 200).
 * @param {number | null} status null: no server listening
 * @param {unknown} [body]
 * @param {string[]} [args]
 * @param {unknown} [policies]
 */
async function run(status, body, args = [], policies = MAIN_ONLY) {
  /** @type {{ urls: string[], auth?: string, version?: string }} */
  const seen = { urls: [] };
  const server = createServer((req, res) => {
    seen.urls.push(String(req.url));
    seen.auth = req.headers.authorization;
    seen.version = String(req.headers['x-github-api-version']);
    const rules = String(req.url).includes('/deployment-branch-policies');
    const [code, answer] = rules ? [200, policies] : [status ?? 500, body];
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(typeof answer === 'string' ? answer : JSON.stringify(answer));
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

test('script: a protected environment passes, read with the token at the environment URLs', async () => {
  const r = await run(200, PROTECTED);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  assert.deepEqual(r.seen.urls.sort(), [
    '/repos/owner/repo/environments/release',
    '/repos/owner/repo/environments/release/deployment-branch-policies?per_page=100',
  ]);
  assert.equal(r.seen.auth, 'Bearer test-token');
  assert.equal(r.seen.version, '2022-11-28');
});

test('script: each missing rule, a missing environment and API errors exit 1 with an annotation', async () => {
  for (const [status, body, expected, policies] of /** @type {const} */ ([
    [200, { ...PROTECTED, protection_rules: [] }, /has no required reviewer/],
    [200, { ...PROTECTED, can_admins_bypass: true }, /administrators can bypass/],
    [200, { ...PROTECTED, deployment_branch_policy: null }, /deployments from any branch/],
    [
      200,
      PROTECTED,
      /from branch main, tag v\*, not the branch main only/,
      {
        total_count: 2,
        branch_policies: [
          { name: 'main', type: 'branch' },
          { name: 'v*', type: 'tag' },
        ],
      },
    ],
    [404, { message: 'Not Found' }, /has no release environment/],
    [403, { message: 'Resource not accessible by integration' }, /answered 403/],
    [502, 'bad gateway', /answered 502/],
    [null, undefined, /could not read the release environment: /],
  ])) {
    const r = await run(status, body, [], policies);
    assert.equal(r.code, 1, `${status}: ${r.stdout}`);
    assert.match(r.stderr, expected);
    assert.match(r.stdout, /^::error title=Release refused::/m);
  }
});

test('script: usage errors exit 2 and make no request', async () => {
  const r = await run(200, PROTECTED, ['--repo', 'not a repo']);
  assert.equal(r.code, 2);
  assert.deepEqual(r.seen.urls, []);
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
