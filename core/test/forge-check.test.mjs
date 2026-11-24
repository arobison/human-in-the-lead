// `hitld check forge` (HITLD-953): the live forge settings the owner applies by hand (HITLD-952),
// read back with a read-only token and reported as ok, wrong or cannot-read. A fake forge answers
// each API path from a map, so every check is tested offline: the settings as specified read ok,
// one change per check reads wrong, and a refusal per check reads cannot-read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  checkForge,
  clean,
  FORGE_CHECKS,
  httpForge,
  NOT_CHECKED,
  permissionFor,
  redacting,
  TOKEN_GUIDANCE,
  TOKEN_PERMISSIONS,
} from '../lib/forge/check.mjs';
import { main, EXIT } from '../lib/cli/main.mjs';
import { tempDir } from './helpers/tmp.mjs';

const REPO = 'owner/project';
const R = `/repos/${REPO}`;
const CONTEXTS = ['check', 'tests', 'dco'];
const QUEUE_ID = 101;
const EXECUTOR_ID = 102;
const RELEASE_ID = 103;
const ACTIONS = 15368;
const TOKEN = 'github_pat_FAKE0123456789abcdefSECRET';

/** @param {string} type @param {Record<string, unknown>} [parameters] */
const rule = (type, parameters) => (parameters ? { type, parameters } : { type });

/**
 * @param {number} id @param {string} name @param {string} target @param {string[]} include
 * @param {string[]} exclude @param {object[]} rules @param {object[]} [bypass]
 */
const ruleset = (id, name, target, include, exclude, rules, bypass = []) => ({
  id,
  name,
  target,
  source_type: 'Repository',
  enforcement: 'active',
  conditions: { ref_name: { include, exclude } },
  rules,
  bypass_actors: bypass,
});

/** @param {number} id */
const app = (id) => ({ actor_id: id, actor_type: 'Integration', bypass_mode: 'always' });

/** The forge as HITLD-952 specifies it: every check reads ok. @returns {Record<string, any>} */
function goodForge() {
  const rulesets = [
    ruleset(
      1,
      'main',
      'branch',
      ['~DEFAULT_BRANCH'],
      [],
      [
        rule('deletion'),
        rule('non_fast_forward'),
        rule('required_linear_history'),
        rule('required_signatures'),
        rule('pull_request', {
          allowed_merge_methods: ['squash'],
          require_code_owner_review: false,
          required_approving_review_count: 0,
        }),
        rule('required_status_checks', {
          strict_required_status_checks_policy: true,
          required_status_checks: CONTEXTS.map((context) => ({ context, integration_id: ACTIONS })),
        }),
      ],
    ),
    ruleset(
      2,
      'main updates',
      'branch',
      ['refs/heads/main'],
      [],
      [rule('update')],
      [app(QUEUE_ID)],
    ),
    ruleset(
      3,
      'other branches',
      'branch',
      ['~ALL'],
      ['refs/heads/hitld/**', 'refs/heads/dependabot/**', 'refs/heads/main'],
      [rule('creation'), rule('update'), rule('deletion'), rule('non_fast_forward')],
    ),
    ruleset(
      4,
      'executor branches',
      'branch',
      ['refs/heads/hitld/**'],
      [],
      [rule('non_fast_forward')],
    ),
    ruleset(
      5,
      'tags',
      'tag',
      ['refs/tags/v*'],
      [],
      [rule('creation'), rule('update'), rule('deletion'), rule('non_fast_forward')],
      [app(RELEASE_ID)],
    ),
  ];
  /** @type {Record<string, any>} */
  const forge = {
    [R]: {
      owner: { login: 'owner' },
      default_branch: 'main',
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      allow_auto_merge: false,
      delete_branch_on_merge: true,
    },
    [`${R}/rulesets?per_page=100`]: rulesets.map(({ id, name, target, enforcement }) => ({
      id,
      name,
      target,
      enforcement,
    })),
    '/apps/hitld-queue': { id: QUEUE_ID, slug: 'hitld-queue' },
    '/apps/hitld-executor': { id: EXECUTOR_ID, slug: 'hitld-executor' },
    '/apps/hitld-release': { id: RELEASE_ID, slug: 'hitld-release' },
    [`${R}/branches/main/protection`]: { status: 404, body: { message: 'Branch not protected' } },
    [`${R}/environments/release`]: {
      name: 'release',
      can_admins_bypass: false,
      protection_rules: [
        { type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'owner' } }] },
      ],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    },
    [`${R}/environments/release/deployment-branch-policies?per_page=100`]: {
      branch_policies: [{ name: 'main', type: 'branch' }],
    },
    [`${R}/actions/permissions`]: {
      enabled: true,
      allowed_actions: 'selected',
      sha_pinning_required: true,
    },
    [`${R}/actions/permissions/selected-actions`]: {
      github_owned_allowed: true,
      verified_allowed: false,
      patterns_allowed: ['ossf/scorecard-action@0123456789abcdef0123456789abcdef01234567'],
    },
    [`${R}/actions/permissions/workflow`]: {
      default_workflow_permissions: 'read',
      can_approve_pull_request_reviews: false,
    },
    [`${R}/actions/secrets?per_page=100`]: { total_count: 0, secrets: [] },
    [`${R}/keys?per_page=100`]: [],
    [`${R}/collaborators?affiliation=direct&per_page=100`]: [{ login: 'owner' }],
  };
  for (const r of rulesets) forge[`${R}/rulesets/${r.id}`] = r;
  return forge;
}

/**
 * A fake forge: a body answers 200, `{ status, body }` answers as given, a missing path 404.
 * @param {Record<string, any>} forge @param {string[]} [seen]
 */
const fake =
  (forge, seen = []) =>
  async (/** @type {string} */ path) => {
    seen.push(path);
    const v = forge[path];
    if (v === undefined) return { status: 404, body: { message: 'Not Found' } };
    if (v && typeof v === 'object' && 'status' in v && 'body' in v) return v;
    return { status: 200, body: v };
  };

/** @param {Record<string, any>} forge */
const run = (forge) => checkForge({ get: fake(forge), repo: REPO, contexts: CONTEXTS });

/** @param {Awaited<ReturnType<typeof run>>} lines @param {string} name */
const line = (lines, name) => {
  const l = lines.find((x) => x.check === name);
  assert.ok(l, `no line for ${name}`);
  return l;
};

/** @param {Awaited<ReturnType<typeof run>>} lines @param {string} name */
const othersOk = (lines, name) =>
  assert.deepEqual(
    lines.filter((x) => x.check !== name && x.result !== 'ok').map((x) => x.line),
    [],
  );

test('the forge as specified reads ok on every check', async () => {
  const lines = await run(goodForge());
  assert.deepEqual(
    lines.map((l) => l.check),
    FORGE_CHECKS.map((c) => c.name),
  );
  for (const l of lines) assert.equal(l.result, 'ok', l.line);
  for (const l of lines) assert.match(l.line, /^ok: /);
});

/** @param {Record<string, any>} f @param {number} id */
const rs = (f, id) => f[`${R}/rulesets/${id}`];
/** @param {Record<string, any>} f @param {number} id @param {string} type */
const ruleOf = (f, id, type) => rs(f, id).rules.find((/** @type {any} */ x) => x.type === type);

/** One change per check that makes it, and only it, wrong. @type {[string, (f: Record<string, any>) => void, RegExp?][]} */
const WRONG = [
  ['squash-only', (f) => (f[R].allow_merge_commit = true), /merge commits/],
  ['auto-merge-off', (f) => (f[R].allow_auto_merge = true)],
  ['delete-head-branches', (f) => (f[R].delete_branch_on_merge = false)],
  ['ruleset-main', (f) => (rs(f, 1).enforcement = 'evaluate'), /enforcement/],
  [
    'ruleset-main',
    (f) => ruleOf(f, 1, 'required_status_checks').parameters.required_status_checks.pop(),
    /contexts/,
  ],
  [
    'ruleset-main',
    (f) => (ruleOf(f, 1, 'pull_request').parameters.allowed_merge_methods = ['squash', 'merge']),
    /merge methods/,
  ],
  ['ruleset-main', (f) => rs(f, 1).bypass_actors.push(app(QUEUE_ID)), /bypass/],
  ['ruleset-main', (f) => (rs(f, 1).rules = rs(f, 1).rules.slice(1)), /deletion/],
  ['ruleset-main-updates', (f) => (rs(f, 2).bypass_actors = [app(EXECUTOR_ID)]), /bypass/],
  ['ruleset-branches', (f) => (rs(f, 3).rules = rs(f, 3).rules.slice(1)), /creation/],
  ['ruleset-executor-branches', (f) => rs(f, 4).bypass_actors.push(app(EXECUTOR_ID)), /bypass/],
  ['ruleset-tags', (f) => (rs(f, 5).rules = [rule('creation')]), /update/],
  [
    'rulesets-other',
    (f) => {
      f[`${R}/rulesets?per_page=100`].push({
        id: 9,
        name: 'x',
        target: 'push',
        enforcement: 'active',
      });
      f[`${R}/rulesets/9`] = ruleset(9, 'x', 'push', [], [], []);
    },
    /x/,
  ],
  [
    'classic-protection',
    (f) => (f[`${R}/branches/main/protection`] = { url: 'x', required_status_checks: {} }),
  ],
  [
    'release-environment',
    (f) => (f[`${R}/environments/release`].can_admins_bypass = true),
    /admin/,
  ],
  [
    'release-environment',
    (f) =>
      f[`${R}/environments/release/deployment-branch-policies?per_page=100`].branch_policies.push({
        name: 'dev',
        type: 'branch',
      }),
    /branches/,
  ],
  [
    'actions-permissions',
    (f) => (f[`${R}/actions/permissions`].sha_pinning_required = false),
    /pinning/,
  ],
  [
    'actions-permissions',
    (f) => (f[`${R}/actions/permissions/selected-actions`].verified_allowed = true),
    /verified/,
  ],
  [
    'workflow-permissions',
    (f) => (f[`${R}/actions/permissions/workflow`].can_approve_pull_request_reviews = true),
  ],
  [
    'secrets',
    (f) =>
      (f[`${R}/actions/secrets?per_page=100`] = { total_count: 1, secrets: [{ name: 'NPM' }] }),
    /NPM/,
  ],
  [
    'deploy-keys',
    (f) => f[`${R}/keys?per_page=100`].push({ id: 5, title: 'ci', read_only: false }),
    /ci/,
  ],
  [
    'collaborators',
    (f) => f[`${R}/collaborators?affiliation=direct&per_page=100`].push({ login: 'helper' }),
    /helper/,
  ],
];

for (const [name, change, says] of WRONG) {
  test(`check forge: ${name} reads wrong${says ? ` (${says.source})` : ''}`, async () => {
    const forge = goodForge();
    change(forge);
    const lines = await run(forge);
    const l = line(lines, name);
    assert.equal(l.result, 'wrong', l.line);
    assert.ok(l.found !== undefined && l.expected !== undefined && l.ui, JSON.stringify(l));
    assert.match(l.line, /^wrong: .*found .*expected .*Settings/);
    if (says) assert.match(l.line, says);
    othersOk(lines, name);
  });
}

test('a ruleset on other refs reads as missing where it belongs and as one outside the specification', async () => {
  const forge = goodForge();
  rs(forge, 3).conditions.ref_name.exclude.push('refs/heads/release/**');
  const lines = await run(forge);
  assert.match(line(lines, 'ruleset-branches').line, /^wrong: .*no ruleset/);
  assert.match(line(lines, 'rulesets-other').line, /^wrong: .*other branches/);
  assert.deepEqual(
    lines.filter((l) => l.result !== 'ok').map((l) => l.check),
    ['ruleset-branches', 'rulesets-other'],
  );
});

/** The path whose refusal makes each check cannot-read. @type {[string, string][]} */
const UNREADABLE = [
  ['squash-only', R],
  ['auto-merge-off', R],
  ['delete-head-branches', R],
  ['ruleset-main', `${R}/rulesets?per_page=100`],
  ['ruleset-main-updates', '/apps/hitld-queue'],
  ['ruleset-branches', `${R}/rulesets/3`],
  ['ruleset-executor-branches', `${R}/rulesets/4`],
  ['ruleset-tags', '/apps/hitld-release'],
  ['rulesets-other', `${R}/rulesets?per_page=100`],
  ['classic-protection', `${R}/branches/main/protection`],
  ['release-environment', `${R}/environments/release`],
  ['actions-permissions', `${R}/actions/permissions/selected-actions`],
  ['workflow-permissions', `${R}/actions/permissions/workflow`],
  ['secrets', `${R}/actions/secrets?per_page=100`],
  ['deploy-keys', `${R}/keys?per_page=100`],
  ['collaborators', `${R}/collaborators?affiliation=direct&per_page=100`],
];

for (const [name, path] of UNREADABLE) {
  test(`check forge: ${name} reads cannot-read when the forge refuses ${path}`, async () => {
    const forge = goodForge();
    forge[path] = {
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
    };
    const l = line(await run(forge), name);
    assert.equal(l.result, 'cannot-read', l.line);
    assert.equal(l.status, 403);
    assert.ok(l.permission, JSON.stringify(l));
    assert.match(l.line, /^cannot-read: .*403.*needs /);
  });
}

test('every check has a wrong case and a cannot-read case', () => {
  for (const c of FORGE_CHECKS) {
    assert.ok(
      WRONG.some(([n]) => n === c.name),
      `no wrong case for ${c.name}`,
    );
    assert.ok(
      UNREADABLE.some(([n]) => n === c.name),
      `no cannot-read case for ${c.name}`,
    );
  }
});

test('an unreachable forge reads cannot-read, never a crash', async () => {
  const lines = await checkForge({
    get: async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    },
    repo: REPO,
    contexts: CONTEXTS,
  });
  for (const l of lines) assert.equal(l.result, 'cannot-read', l.line);
});

/** A project with the required checks in its policy. */
function project() {
  const root = tempDir('hitld-forge-');
  mkdirSync(join(root, '.human-in-the-lead'));
  writeFileSync(
    join(root, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
      merge: { mode: 'owner', via: 'pull-request', pull_request: { checks: CONTEXTS } },
    }),
  );
  return root;
}

/** @param {string[]} argv @param {NodeJS.ProcessEnv} env @param {Record<string, any>} forge */
async function hitld(argv, env, forge) {
  let out = '';
  let err = '';
  /** @type {string[]} */
  const tokens = [];
  const code = await main(argv, {
    out: (t) => (out += t),
    err: (t) => (err += t),
    cwd: project(),
    env,
    forge: (token) => {
      tokens.push(token);
      return fake(forge);
    },
  });
  return { code, out, err, tokens, result: JSON.parse(out) };
}

test('hitld check forge takes the token from the caller, prints none of it, and exits by the result', async () => {
  const env = { HITLD_FORGE_TOKEN: TOKEN };
  const good = await hitld(['check', 'forge', '--repo', REPO], env, goodForge());
  assert.equal(good.code, EXIT.ok, good.out);
  assert.deepEqual(good.tokens, [TOKEN]);
  assert.equal(good.result.ok, true);
  assert.equal(good.result.lines.length, FORGE_CHECKS.length);
  assert.ok(!good.out.includes(TOKEN) && !good.err.includes(TOKEN));

  const forge = goodForge();
  forge[`${R}/keys?per_page=100`] = [{ id: 1, title: 'old', read_only: true }];
  forge[`${R}/actions/secrets?per_page=100`] = { status: 403, body: { message: 'no' } };
  const bad = await hitld(['check', 'forge', '--repo', REPO], env, forge);
  assert.equal(bad.code, EXIT.failed);
  assert.equal(bad.result.wrong, 1);
  assert.equal(bad.result.cannot_read, 1);
  assert.ok(!bad.out.includes(TOKEN) && !bad.err.includes(TOKEN));

  const named = await hitld(
    ['check', 'forge', '--repo', REPO, '--token-env', 'MY_READ_TOKEN'],
    { MY_READ_TOKEN: TOKEN },
    goodForge(),
  );
  assert.equal(named.code, EXIT.ok, named.out);
  assert.deepEqual(named.tokens, [TOKEN]);
});

test('hitld check forge without a token says where to put one and reads nothing', async () => {
  const none = await hitld(['check', 'forge', '--repo', REPO], {}, goodForge());
  assert.equal(none.code, EXIT.failed);
  assert.equal(none.result.error, 'no-forge-token');
  assert.match(none.result.message, /HITLD_FORGE_TOKEN/);
  assert.deepEqual(none.tokens, []);
});

test('the token guidance names every permission the checks need, and no other', async () => {
  /** @type {string[]} */
  const seen = [];
  await checkForge({ get: fake(goodForge(), seen), repo: REPO, contexts: CONTEXTS });
  const needed = new Set(seen.filter((p) => !p.startsWith('/apps/')).map(permissionFor));
  assert.deepEqual([...needed].sort(), [...TOKEN_PERMISSIONS].sort());
  assert.ok(TOKEN_PERMISSIONS.includes('Secrets: read'));
  assert.ok(!TOKEN_GUIDANCE.includes('Contents'));
  for (const p of TOKEN_PERMISSIONS) assert.ok(TOKEN_GUIDANCE.includes(p), p);
  const none = await hitld(['check', 'forge', '--repo', REPO], {}, goodForge());
  assert.ok(none.result.message.includes(TOKEN_GUIDANCE));
});

test('installations are listed as not checked, never as ok', async () => {
  const good = await hitld(
    ['check', 'forge', '--repo', REPO],
    { HITLD_FORGE_TOKEN: TOKEN },
    goodForge(),
  );
  assert.ok(!good.result.lines.some((/** @type {any} */ l) => l.check === 'installations'));
  assert.deepEqual(
    good.result.not_checked.map((/** @type {any} */ n) => n.check),
    ['installations'],
  );
  assert.deepEqual(good.result.not_checked, JSON.parse(JSON.stringify(NOT_CHECKED)));
});

/** A 200 whose answer lacks the expected shape, per path: each reads cannot-read, never ok. @type {[string, string, unknown][]} */
const MALFORMED = [
  ['squash-only', R, null],
  ['auto-merge-off', R, 'not json'],
  ['ruleset-main', `${R}/rulesets?per_page=100`, null],
  ['rulesets-other', `${R}/rulesets?per_page=100`, { rulesets: [] }],
  ['ruleset-main-updates', '/apps/hitld-queue', { slug: 'hitld-queue' }],
  ['release-environment', `${R}/environments/release`, { can_admins_bypass: false }],
  ['actions-permissions', `${R}/actions/permissions`, null],
  ['workflow-permissions', `${R}/actions/permissions/workflow`, []],
  ['secrets', `${R}/actions/secrets?per_page=100`, { total_count: 0 }],
  ['secrets', `${R}/actions/secrets?per_page=100`, null],
  ['deploy-keys', `${R}/keys?per_page=100`, null],
  ['deploy-keys', `${R}/keys?per_page=100`, { keys: [] }],
  ['collaborators', `${R}/collaborators?affiliation=direct&per_page=100`, null],
];

for (const [name, path, body] of MALFORMED) {
  test(`check forge: ${name} reads cannot-read on a 200 from ${path} with ${JSON.stringify(body)}`, async () => {
    const forge = goodForge();
    forge[path] = { status: 200, body };
    const lines = await run(forge);
    assert.equal(lines.length, FORGE_CHECKS.length);
    const l = line(lines, name);
    assert.equal(l.result, 'cannot-read', l.line);
    assert.match(l.line, /^cannot-read: .*answered 200, but /);
  });
}

test('a ruleset without bypass actors or rules reads cannot-read, not none', async () => {
  for (const key of ['bypass_actors', 'rules']) {
    const forge = goodForge();
    delete rs(forge, 1)[key];
    const l = line(await run(forge), 'ruleset-main');
    assert.equal(l.result, 'cannot-read', l.line);
    assert.match(l.line, new RegExp(`no ${key} list`));
  }
});

test('an answer that throws inside a check reads cannot-read and the other lines still print', async () => {
  const forge = goodForge();
  rs(forge, 1).rules = [null];
  const lines = await run(forge);
  assert.equal(lines.length, FORGE_CHECKS.length);
  for (const l of lines) assert.match(l.line, /^(ok|wrong|cannot-read): /);
});

test('strings from the forge are capped and stripped of control characters', async () => {
  const forge = goodForge();
  const long = `evil\u001b[31m\u202e${'x'.repeat(500)}`;
  forge[`${R}/keys?per_page=100`] = [{ id: 1, title: long, read_only: true }];
  forge[`${R}/actions/secrets?per_page=100`] = {
    total_count: 30,
    secrets: Array.from({ length: 30 }, (_, i) => ({ name: `S\n${i}` })),
  };
  forge[`${R}/collaborators?affiliation=direct&per_page=100`].push({ login: 'a\u0007b' });
  const lines = await run(forge);
  for (const l of lines) {
    assert.ok(!/[\u0000-\u001f\u007f-\u009f‪-‮]/.test(l.line), l.check);
  }
  const keys = line(lines, 'deploy-keys');
  assert.ok(keys.line.length < 300, keys.line);
  assert.ok(!keys.line.includes('x'.repeat(100)));
  assert.match(line(lines, 'secrets').line, /and 10 more/);
  assert.match(line(lines, 'collaborators').line, /ab/);
  assert.equal(clean('a'.repeat(200)).length, 80);
});

test('a --token-env value is never printed, whether or not it is shaped like a name', async () => {
  for (const value of [TOKEN, 'ghp-not/a name', `${TOKEN}-x`]) {
    const r = await hitld(
      ['check', 'forge', '--repo', REPO, '--token-env', value],
      {},
      goodForge(),
    );
    assert.equal(r.code, EXIT.failed);
    assert.equal(r.result.error, 'no-forge-token');
    assert.ok(!r.out.includes(value) && !r.err.includes(value), value);
    assert.ok(!r.out.includes(TOKEN));
    assert.deepEqual(r.tokens, []);
  }
});

test('a forge that echoes the token gets it into no line', async () => {
  const forge = goodForge();
  forge[`${R}/keys?per_page=100`] = [{ id: 1, title: `key ${TOKEN}`, read_only: true }];
  forge[`${R}/collaborators?affiliation=direct&per_page=100`].push({ login: TOKEN });
  const r = await hitld(['check', 'forge', '--repo', REPO], { HITLD_FORGE_TOKEN: TOKEN }, forge);
  assert.equal(r.code, EXIT.failed);
  assert.ok(!r.out.includes(TOKEN) && !r.err.includes(TOKEN));
  assert.match(r.out, /\[redacted\]/);
  const direct = await redacting(fake(forge), TOKEN)(`${R}/keys?per_page=100`);
  assert.ok(!JSON.stringify(direct).includes(TOKEN));
});

test('httpForge sends the token only in its header, and no answer or error path brings it out', async () => {
  /** @type {string[]} */
  const auth = [];
  const server = createServer((req, res) => {
    const header = String(req.headers.authorization ?? '');
    auth.push(header);
    const path = String(req.url);
    if (path.startsWith(`${R}/keys`)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 1, title: `echo ${header}`, read_only: true }]));
    } else if (path.startsWith(`${R}/actions/secrets`)) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`server error, you sent ${header}`);
    } else if (path.startsWith(`${R}/collaborators`)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`not json ${header}`);
    } else if (path === R) {
      res.destroy();
    } else {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: `refused ${header}` }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  try {
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const get = redacting(httpForge(TOKEN, { base: `http://127.0.0.1:${port}` }), TOKEN);
    const lines = await checkForge({ get, repo: REPO, contexts: CONTEXTS });
    assert.ok(auth.length > 0 && auth.every((a) => a === `Bearer ${TOKEN}`));
    const text = JSON.stringify(lines);
    assert.ok(!text.includes(TOKEN), text);
    assert.equal(line(lines, 'deploy-keys').result, 'wrong');
    assert.match(line(lines, 'deploy-keys').line, /\[redacted\]/);
    assert.equal(line(lines, 'secrets').status, 500);
    assert.equal(line(lines, 'collaborators').result, 'cannot-read');
    assert.equal(line(lines, 'squash-only').status, 0);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
