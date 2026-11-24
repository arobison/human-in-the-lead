// `hitld check forge` (HITLD-953): the live forge settings the owner applies by hand (HITLD-952),
// read back with a read-only token and reported as ok, wrong or cannot-read. A fake forge answers
// each API path from a map, so every check is tested offline: the settings as specified read ok,
// one change per check reads wrong, and a refusal per check reads cannot-read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkForge, FORGE_CHECKS } from '../lib/forge/check.mjs';
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
    '/user/installations?per_page=100': {
      installations: [
        { id: 11, app_slug: 'hitld-queue', repository_selection: 'selected' },
        { id: 12, app_slug: 'hitld-executor', repository_selection: 'selected' },
        { id: 13, app_slug: 'hitld-release', repository_selection: 'selected' },
        {
          id: 14,
          app_slug: 'some-reader',
          repository_selection: 'all',
          permissions: { metadata: 'read' },
        },
      ],
    },
    '/user/installations/11/repositories?per_page=100': { repositories: [{ full_name: REPO }] },
    '/user/installations/12/repositories?per_page=100': { repositories: [{ full_name: REPO }] },
    '/user/installations/13/repositories?per_page=100': { repositories: [{ full_name: REPO }] },
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
  [
    'installations',
    (f) =>
      f['/user/installations?per_page=100'].installations.push({
        id: 15,
        app_slug: 'writer-bot',
        repository_selection: 'all',
        permissions: { contents: 'write' },
      }),
    /writer-bot/,
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
  ['installations', '/user/installations?per_page=100'],
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
