// The live forge settings, read back (HITLD-953). The owner applies the forge settings by hand
// (HITLD-952): squash-only merging, the rulesets, the release environment, the Actions settings,
// and no secrets, deploy keys, collaborators or stray write-capable Apps. Nothing checked them
// afterwards. This reads each through the GitHub REST API with a read-only token the caller
// supplies, and reports each as ok, wrong (found, expected, where in the UI to fix it) or
// cannot-read (the HTTP status, and the token permission it needs).
//
// The token never leaves the client: it goes into one request header and nowhere else. Nothing here
// prints, logs or writes it, and no line quotes a request or a header.

/**
 * @typedef {{ status: number, body: any }} ForgeResponse status 0: the forge could not be reached
 * @typedef {(path: string) => Promise<ForgeResponse>} ForgeGet one GET on the API, by path and query
 * @typedef {{ what: string, found: string, expected: string }} Problem
 * @typedef {object} ForgeLine
 * @property {string} check
 * @property {'ok' | 'wrong' | 'cannot-read'} result
 * @property {string} line the line as people read it
 * @property {string} [found] wrong: what the forge has
 * @property {string} [expected] wrong: what the specification says
 * @property {string} [ui] wrong or cannot-read: where in the forge's settings to look
 * @property {number} [status] cannot-read: the HTTP status, 0 when unreachable
 * @property {string} [path] cannot-read: the API path that was refused
 * @property {string} [permission] cannot-read: what the token needs to read it
 */

/** GitHub Actions' App ID: the required checks come from it. */
export const GITHUB_ACTIONS_APP_ID = 15368;

const UI = Object.freeze({
  general: 'Settings > General > Pull Requests',
  rulesets: 'Settings > Rules > Rulesets',
  branches: 'Settings > Branches > Branch protection rules',
  environment: 'Settings > Environments > release',
  actions: 'Settings > Actions > General',
  workflow: 'Settings > Actions > General > Workflow permissions',
  secrets: 'Settings > Secrets and variables > Actions',
  keys: 'Settings > Deploy keys',
  collaborators: 'Settings > Collaborators',
  apps: 'Settings > GitHub Apps',
});

/** Every check, in report order, with where to fix it. */
export const FORGE_CHECKS = Object.freeze([
  { name: 'squash-only', ui: UI.general },
  { name: 'auto-merge-off', ui: UI.general },
  { name: 'delete-head-branches', ui: UI.general },
  { name: 'ruleset-main', ui: UI.rulesets },
  { name: 'ruleset-main-updates', ui: UI.rulesets },
  { name: 'ruleset-branches', ui: UI.rulesets },
  { name: 'ruleset-executor-branches', ui: UI.rulesets },
  { name: 'ruleset-tags', ui: UI.rulesets },
  { name: 'rulesets-other', ui: UI.rulesets },
  { name: 'classic-protection', ui: UI.branches },
  { name: 'release-environment', ui: UI.environment },
  { name: 'actions-permissions', ui: UI.actions },
  { name: 'workflow-permissions', ui: UI.workflow },
  { name: 'secrets', ui: UI.secrets },
  { name: 'deploy-keys', ui: UI.keys },
  { name: 'collaborators', ui: UI.collaborators },
  { name: 'installations', ui: UI.apps },
]);

/** The fine-grained token permission that reads a path. @param {string} path */
export function permissionFor(path) {
  if (path.startsWith('/apps/')) return 'nothing: an App is public, so check the App slug';
  if (path.startsWith('/user/installations')) {
    return 'a user access token; a fine-grained repository token cannot list installations';
  }
  if (/\/environments\b/.test(path)) return 'Actions: read';
  if (/\/actions\/secrets\b/.test(path)) return 'Secrets: read';
  if (/\/collaborators\b/.test(path)) return 'Metadata: read';
  if (/\/(rulesets|branches|actions\/permissions|keys)\b/.test(path)) return 'Administration: read';
  return 'Metadata: read';
}

class Unreadable extends Error {
  /** @param {string} path @param {number} status */
  constructor(path, status) {
    super(`GET ${path} answered ${status}`);
    this.path = path;
    this.status = status;
  }
}

/** @param {unknown} xs @returns {string} */
const list = (xs) => (Array.isArray(xs) && xs.length ? xs.join(', ') : 'none');
/** @param {string[]} a @param {string[]} b */
const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * @typedef {object} Spec what one ruleset must be (HITLD-952 steps 7 to 10)
 * @property {string} name the check
 * @property {'branch' | 'tag'} target
 * @property {string[]} include refs, with the default branch spelled refs/heads/<default>
 * @property {string[]} exclude
 * @property {string} [marker] a rule that tells two rulesets on the same refs apart
 * @property {string[]} rules every one must be there
 * @property {string[]} [optional] rules that may be there
 * @property {'queue' | 'release'} [bypass] the one App that may bypass it; none when unset
 */

/** @param {string} main @returns {Spec[]} */
const rulesetSpecs = (main) => [
  {
    name: 'ruleset-main',
    target: 'branch',
    include: [main],
    exclude: [],
    marker: 'pull_request',
    rules: [
      'deletion',
      'non_fast_forward',
      'required_linear_history',
      'pull_request',
      'required_status_checks',
    ],
    // Dropped if the queue's squash merge is refused (HITLD-950).
    optional: ['required_signatures'],
  },
  {
    name: 'ruleset-main-updates',
    target: 'branch',
    include: [main],
    exclude: [],
    marker: 'update',
    rules: ['update'],
    bypass: 'queue',
  },
  {
    name: 'ruleset-branches',
    target: 'branch',
    include: ['~ALL'],
    exclude: ['refs/heads/hitld/**', 'refs/heads/dependabot/**', main],
    rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
  },
  {
    name: 'ruleset-executor-branches',
    target: 'branch',
    include: ['refs/heads/hitld/**'],
    exclude: [],
    rules: ['non_fast_forward'],
  },
  {
    name: 'ruleset-tags',
    target: 'tag',
    include: ['refs/tags/v*'],
    exclude: [],
    rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
    bypass: 'release',
  },
];

/**
 * Read the forge and judge each setting.
 * @param {{ get: ForgeGet, repo: string, contexts: string[],
 *   apps?: { queue?: string, executor?: string, release?: string }, allowApps?: string[] }} o
 *   repo: owner/name; contexts: the required checks, from policy.json; apps: the App slugs;
 *   allowApps: other Apps with write access the owner has reviewed and kept
 * @returns {Promise<ForgeLine[]>}
 */
export async function checkForge({ get, repo, contexts, apps = {}, allowApps = [] }) {
  const slugs = {
    queue: apps.queue ?? 'hitld-queue',
    executor: apps.executor ?? 'hitld-executor',
    release: apps.release ?? 'hitld-release',
  };
  const owner = repo.split('/')[0];
  const R = `/repos/${repo}`;
  /** @type {Map<string, Promise<ForgeResponse>>} */
  const cache = new Map();
  /** @param {string} path @returns {Promise<ForgeResponse>} */
  const raw = (path) => {
    if (!cache.has(path)) {
      cache.set(
        path,
        get(path).catch(() => ({ status: 0, body: null })),
      );
    }
    return /** @type {Promise<ForgeResponse>} */ (cache.get(path));
  };
  /** The body of a 200, else Unreadable. @param {string} path */
  const read = async (path) => {
    const r = await raw(path);
    if (r.status !== 200) throw new Unreadable(path, r.status);
    return r.body;
  };

  const repoBody = () => read(R);
  const mainRef = async () => {
    const r = await raw(R);
    return `refs/heads/${(r.status === 200 && r.body?.default_branch) || 'main'}`;
  };

  /** @param {string} slug */
  const appId = async (slug) => (await read(`/apps/${slug}`)).id;

  /** The rulesets in full, the default branch spelled out. */
  const rulesets = async () => {
    const main = await mainRef();
    const summaries = await read(`${R}/rulesets?per_page=100`);
    /** @param {string[]} refs */
    const norm = (refs) => (refs ?? []).map((x) => (x === '~DEFAULT_BRANCH' ? main : x));
    const full = [];
    for (const s of summaries ?? []) {
      const r = await read(`${R}/rulesets/${s.id}`);
      full.push({
        ...r,
        include: norm(r.conditions?.ref_name?.include),
        exclude: norm(r.conditions?.ref_name?.exclude),
        types: (r.rules ?? []).map((/** @type {any} */ x) => x.type),
      });
    }
    return { main, full };
  };

  /** @param {Spec} spec @param {any[]} full */
  const matching = (spec, full) =>
    full.filter(
      (r) =>
        r.target === spec.target &&
        sameSet(r.include, spec.include) &&
        sameSet(r.exclude, spec.exclude) &&
        (!spec.marker || r.types.includes(spec.marker)),
    );

  /** @param {Spec} spec @returns {Promise<Problem[]>} */
  const rulesetProblems = async (spec) => {
    const { main, full } = await rulesets();
    const s = rulesetSpecs(main).find((x) => x.name === spec.name) ?? spec;
    /** @type {Problem[]} */
    const problems = [];
    const bypassId = s.bypass ? await appId(slugs[s.bypass]) : null;
    const found = matching(s, full);
    const targets = `${s.target} refs ${list(s.include)}${s.exclude.length ? ` except ${list(s.exclude)}` : ''}`;
    if (found.length !== 1) {
      return [
        {
          what: found.length ? 'more than one ruleset' : 'no ruleset',
          found: found.length ? list(found.map((r) => r.name)) : 'none',
          expected: `one ruleset on ${targets}${s.marker ? ` with the ${s.marker} rule` : ''}`,
        },
      ];
    }
    const r = found[0];
    if (r.enforcement !== 'active') {
      problems.push({ what: 'enforcement', found: String(r.enforcement), expected: 'active' });
    }
    const missing = s.rules.filter((t) => !r.types.includes(t));
    if (missing.length) {
      problems.push({
        what: `missing rules ${list(missing)}`,
        found: list(r.types),
        expected: list(s.rules),
      });
    }
    const extra = r.types.filter(
      (/** @type {string} */ t) => !s.rules.includes(t) && !(s.optional ?? []).includes(t),
    );
    if (extra.length) {
      problems.push({
        what: `unexpected rules ${list(extra)}`,
        found: list(r.types),
        expected: list(s.rules),
      });
    }
    const actors = (r.bypass_actors ?? []).map((/** @type {any} */ a) =>
      `${a.actor_type} ${a.actor_id ?? ''}`.trim(),
    );
    const wanted = bypassId === null ? [] : [`Integration ${bypassId}`];
    if (!sameSet(actors, wanted)) {
      problems.push({
        what: 'bypass actors',
        found: list(actors),
        expected: s.bypass ? `Integration ${bypassId} (${slugs[s.bypass]}) only` : 'none',
      });
    }
    const param = (/** @type {string} */ type) =>
      (r.rules ?? []).find((/** @type {any} */ x) => x.type === type)?.parameters ?? {};
    if (r.types.includes('pull_request')) {
      const p = param('pull_request');
      const methods = p.allowed_merge_methods ?? [];
      if (!sameSet(methods, ['squash'])) {
        problems.push({ what: 'allowed merge methods', found: list(methods), expected: 'squash' });
      }
      if (p.require_code_owner_review) {
        problems.push({
          what: 'code-owner review',
          found: 'required',
          expected: 'not required (HITLD-946)',
        });
      }
    }
    if (r.types.includes('required_status_checks')) {
      const p = param('required_status_checks');
      const checks = p.required_status_checks ?? [];
      const names = checks.map((/** @type {any} */ c) => c.context);
      if (!sameSet(names, contexts)) {
        problems.push({
          what: 'required contexts',
          found: list(names),
          expected: `${list(contexts)} (policy.json)`,
        });
      }
      const notActions = checks
        .filter((/** @type {any} */ c) => c.integration_id !== GITHUB_ACTIONS_APP_ID)
        .map((/** @type {any} */ c) => c.context);
      if (notActions.length) {
        problems.push({
          what: 'required checks not from GitHub Actions',
          found: list(notActions),
          expected: `every check from GitHub Actions (App ${GITHUB_ACTIONS_APP_ID})`,
        });
      }
      if (p.strict_required_status_checks_policy !== true) {
        problems.push({
          what: 'branches up to date before merging',
          found: 'not required',
          expected: 'required',
        });
      }
    }
    return problems;
  };

  /** @type {Record<string, () => Promise<Problem[]>>} */
  const checks = {
    'squash-only': async () => {
      const b = await repoBody();
      /** @type {Problem[]} */
      const p = [];
      if (b.allow_squash_merge !== true)
        p.push({ what: 'squash merging', found: 'off', expected: 'on' });
      if (b.allow_merge_commit !== false)
        p.push({ what: 'merge commits', found: 'allowed', expected: 'off' });
      if (b.allow_rebase_merge !== false)
        p.push({ what: 'rebase merging', found: 'allowed', expected: 'off' });
      return p;
    },
    'auto-merge-off': async () =>
      (await repoBody()).allow_auto_merge === false
        ? []
        : [{ what: 'auto-merge', found: 'allowed', expected: 'off' }],
    'delete-head-branches': async () =>
      (await repoBody()).delete_branch_on_merge === true
        ? []
        : [{ what: 'delete head branches', found: 'off', expected: 'on' }],
    ...Object.fromEntries(
      rulesetSpecs('refs/heads/main').map((s) => [s.name, () => rulesetProblems(s)]),
    ),
    'rulesets-other': async () => {
      const { main, full } = await rulesets();
      const specs = rulesetSpecs(main);
      const others = full.filter(
        (r) => r.enforcement !== 'disabled' && !specs.some((s) => matching(s, full).includes(r)),
      );
      return others.length
        ? [
            {
              what: 'rulesets outside the specification',
              found: list(others.map((r) => `${r.name} (${r.target}, ${r.enforcement})`)),
              expected: 'none, or disabled',
            },
          ]
        : [];
    },
    'classic-protection': async () => {
      const main = (await mainRef()).replace('refs/heads/', '');
      const path = `${R}/branches/${encodeURIComponent(main)}/protection`;
      const r = await raw(path);
      if (r.status === 404 && /not protected/i.test(String(r.body?.message ?? ''))) return [];
      if (r.status !== 200) throw new Unreadable(path, r.status);
      return [
        {
          what: `a classic branch protection rule on ${main}`,
          found: 'present',
          expected: 'none: the rulesets govern the branch',
        },
      ];
    },
    'release-environment': async () => {
      const path = `${R}/environments/release`;
      const r = await raw(path);
      if (r.status === 404)
        return [{ what: 'the release environment', found: 'none', expected: 'present' }];
      if (r.status !== 200) throw new Unreadable(path, r.status);
      const e = r.body;
      /** @type {Problem[]} */
      const p = [];
      const reviewers = (e.protection_rules ?? [])
        .filter((/** @type {any} */ x) => x.type === 'required_reviewers')
        .flatMap((/** @type {any} */ x) => x.reviewers ?? [])
        .map(
          (/** @type {any} */ x) =>
            `${x.type} ${x.reviewer?.login ?? x.reviewer?.slug ?? x.reviewer?.id}`,
        );
      if (!sameSet(reviewers, [`User ${owner}`])) {
        p.push({
          what: 'required reviewers',
          found: list(reviewers),
          expected: `User ${owner} only`,
        });
      }
      if (e.can_admins_bypass !== false) {
        p.push({ what: 'admin bypass', found: 'allowed', expected: 'off' });
      }
      const policy = e.deployment_branch_policy;
      if (
        !policy ||
        policy.custom_branch_policies !== true ||
        policy.protected_branches !== false
      ) {
        p.push({
          what: 'deployment branches',
          found: policy ? 'not selected branches' : 'any branch',
          expected: 'selected branches: main',
        });
      } else {
        const b = await read(`${R}/environments/release/deployment-branch-policies?per_page=100`);
        const names = (b.branch_policies ?? []).map(
          (/** @type {any} */ x) => `${x.type ?? 'branch'} ${x.name}`,
        );
        if (!sameSet(names, ['branch main'])) {
          p.push({ what: 'deployment branches', found: list(names), expected: 'branch main only' });
        }
      }
      return p;
    },
    'actions-permissions': async () => {
      const a = await read(`${R}/actions/permissions`);
      /** @type {Problem[]} */
      const p = [];
      if (a.allowed_actions !== 'selected') {
        p.push({ what: 'allowed actions', found: String(a.allowed_actions), expected: 'selected' });
      }
      if (a.sha_pinning_required !== true) {
        p.push({ what: 'full-SHA pinning', found: 'not required', expected: 'required' });
      }
      if (a.allowed_actions === 'selected') {
        const s = await read(`${R}/actions/permissions/selected-actions`);
        if (s.github_owned_allowed !== true) {
          p.push({ what: 'actions created by GitHub', found: 'not allowed', expected: 'allowed' });
        }
        if (s.verified_allowed !== false) {
          p.push({
            what: 'actions by verified creators',
            found: 'allowed',
            expected: 'not allowed',
          });
        }
        const patterns = s.patterns_allowed ?? [];
        const pinned = /^ossf\/scorecard-action@[0-9a-f]{40}$/;
        if (patterns.length !== 1 || !pinned.test(patterns[0])) {
          p.push({
            what: 'allowed patterns',
            found: list(patterns),
            expected: 'ossf/scorecard-action@<full SHA> only',
          });
        }
      }
      return p;
    },
    'workflow-permissions': async () => {
      const w = await read(`${R}/actions/permissions/workflow`);
      /** @type {Problem[]} */
      const p = [];
      if (w.default_workflow_permissions !== 'read') {
        p.push({
          what: 'default workflow permissions',
          found: String(w.default_workflow_permissions),
          expected: 'read',
        });
      }
      if (w.can_approve_pull_request_reviews !== false) {
        p.push({
          what: 'Actions may create or approve pull requests',
          found: 'allowed',
          expected: 'off',
        });
      }
      return p;
    },
    secrets: async () => {
      const s = await read(`${R}/actions/secrets?per_page=100`);
      const names = (s.secrets ?? []).map((/** @type {any} */ x) => x.name);
      return s.total_count === 0 && names.length === 0
        ? []
        : [
            {
              what: 'repository secrets',
              found: list(names.length ? names : [`${s.total_count} secrets`]),
              expected: 'none',
            },
          ];
    },
    'deploy-keys': async () => {
      const k = await read(`${R}/keys?per_page=100`);
      const titles = (k ?? []).map(
        (/** @type {any} */ x) => `${x.title} (${x.read_only ? 'read' : 'write'})`,
      );
      return titles.length ? [{ what: 'deploy keys', found: list(titles), expected: 'none' }] : [];
    },
    collaborators: async () => {
      const c = await read(`${R}/collaborators?affiliation=direct&per_page=100`);
      const others = (c ?? [])
        .map((/** @type {any} */ x) => x.login)
        .filter((/** @type {string} */ l) => l !== owner);
      return others.length
        ? [{ what: 'collaborators', found: list(others), expected: 'none but the owner' }]
        : [];
    },
    installations: async () => {
      const i = await read('/user/installations?per_page=100');
      /** @type {string[]} */
      const here = [];
      /** @type {string[]} */
      const writers = [];
      for (const inst of i.installations ?? []) {
        let covers = inst.repository_selection === 'all';
        if (!covers) {
          const r = await read(`/user/installations/${inst.id}/repositories?per_page=100`);
          covers = (r.repositories ?? []).some((/** @type {any} */ x) => x.full_name === repo);
        }
        if (!covers) continue;
        here.push(inst.app_slug);
        const writes = Object.values(inst.permissions ?? {}).some(
          (v) => v === 'write' || v === 'admin',
        );
        if (writes) writers.push(inst.app_slug);
      }
      const ours = Object.values(slugs);
      /** @type {Problem[]} */
      const p = [];
      const missing = ours.filter((s) => !here.includes(s));
      if (missing.length) {
        p.push({
          what: 'Apps not installed here',
          found: list(here),
          expected: `${list(ours)} installed`,
        });
      }
      const stray = writers.filter((s) => !ours.includes(s) && !allowApps.includes(s));
      if (stray.length) {
        p.push({
          what: 'other Apps with write access',
          found: list(stray),
          expected: `none beyond ${list(ours)}, or reviewed and kept with --allow-app`,
        });
      }
      return p;
    },
  };

  /** @type {ForgeLine[]} */
  const lines = [];
  for (const { name, ui } of FORGE_CHECKS) {
    try {
      const problems = await checks[name]();
      if (!problems.length) {
        lines.push({ check: name, result: 'ok', line: `ok: ${name}` });
        continue;
      }
      const found = problems.map((p) => p.found).join('; ');
      const expected = problems.map((p) => p.expected).join('; ');
      const text = problems
        .map((p) => `${p.what} (found ${p.found}, expected ${p.expected})`)
        .join('; ');
      lines.push({
        check: name,
        result: 'wrong',
        found,
        expected,
        ui,
        line: `wrong: ${name}: ${text}; fix in ${ui}`,
      });
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      const permission = permissionFor(e.path);
      const answered =
        e.status === 0 ? 'could not reach the forge (status 0)' : `answered ${e.status}`;
      lines.push({
        check: name,
        result: 'cannot-read',
        status: e.status,
        path: e.path,
        permission,
        ui,
        line: `cannot-read: ${name}: GET ${e.path} ${answered}; needs ${permission}`,
      });
    }
  }
  return lines;
}

/**
 * The real forge: GitHub's REST API with the caller's read-only token, sent in one header only.
 * @param {string} token @param {{ base?: string }} [o] @returns {ForgeGet}
 */
export function httpForge(token, { base = 'https://api.github.com' } = {}) {
  return async (path) => {
    // Trust boundary: GitHub. The token goes in the Authorization header and nowhere else.
    const res = await fetch(base + path, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'hitld-check-forge',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    /** @type {any} */
    let body = null;
    try {
      body = await res.json();
    } catch {
      // Not JSON: the status says enough.
    }
    return { status: res.status, body };
  };
}
