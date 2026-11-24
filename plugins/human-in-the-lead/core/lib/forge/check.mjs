// The live forge settings, read back (HITLD-953). The owner applies the forge settings by hand
// (HITLD-952): squash-only merging, the rulesets, the release environment, the Actions settings,
// and no secrets, deploy keys or collaborators. Nothing checked them afterwards. This reads each
// through the GitHub REST API with a read-only token the caller supplies, and reports each as ok,
// wrong (found, expected, where in the UI to fix it) or cannot-read (the HTTP status, and the
// token permission it needs).
//
// It fails closed: an answer without the expected shape reads cannot-read, never ok. The token goes
// into one request header and nowhere else, and is redacted from every answer before it is read, so
// no line can quote it. Every string the forge sends is capped and stripped of control characters
// before a line shows it.

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
 * @property {string} [permission] cannot-read for a refusal: what the token needs to read it
 * @property {string} [reason] cannot-read for an answer of the wrong shape: what was wrong with it
 */

/** GitHub Actions' App ID: the required checks come from it. */
export const GITHUB_ACTIONS_APP_ID = 15368;

/** The token permissions, by role: the guidance and permissionFor both read them from here. */
const PERMISSION = Object.freeze({
  administration: 'Administration: read',
  actions: 'Actions: read',
  secrets: 'Secrets: read',
  metadata: 'Metadata: read',
});

/** Every permission the checks need, and nothing more: the token the owner creates has these. */
export const TOKEN_PERMISSIONS = Object.freeze(Object.values(PERMISSION));

/** What to create, for the message when no token is given and for HITLD-952 step 1. */
export const TOKEN_GUIDANCE = `a read-only fine-grained token for this repository only, with ${TOKEN_PERMISSIONS.join(', ')}`;

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
]);

/**
 * What the item asks for and this cannot check: listed in the output so it never reads as ok.
 * GitHub lists installed Apps only to an App's own user access token (GET /user/installations), so
 * a personal read-only token cannot find a stray App.
 */
export const NOT_CHECKED = Object.freeze([
  {
    check: 'installations',
    reason:
      'a personal token cannot list the Apps installed on a repository; review each App with write access by hand',
    ui: UI.apps,
  },
]);

/** The fine-grained token permission that reads a path. @param {string} path */
export function permissionFor(path) {
  if (path.startsWith('/apps/')) return 'nothing: an App is public, so check the App slug';
  if (/\/environments\b/.test(path)) return PERMISSION.actions;
  if (/\/actions\/secrets\b/.test(path)) return PERMISSION.secrets;
  if (/\/collaborators\b/.test(path)) return PERMISSION.metadata;
  if (/\/(rulesets|branches|actions\/permissions|keys)\b/.test(path)) {
    return PERMISSION.administration;
  }
  return PERMISSION.metadata;
}

const MAX_TEXT = 80;
const MAX_ITEMS = 20;

/**
 * A string from the forge, fit to show: control and direction-changing characters stripped, and
 * capped at a fixed length.
 * @param {unknown} s @returns {string}
 */
export function clean(s) {
  const t = String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 3)}...` : t;
}

/** @param {unknown[]} xs @returns {string} */
const list = (xs) => {
  if (!xs.length) return 'none';
  const shown = xs.slice(0, MAX_ITEMS).map(clean);
  return xs.length > MAX_ITEMS
    ? `${shown.join(', ')} and ${xs.length - MAX_ITEMS} more`
    : shown.join(', ');
};
/** @param {string[]} a @param {string[]} b */
const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

class Unreadable extends Error {
  /** @param {string} path @param {number} status @param {string} [reason] */
  constructor(path, status, reason) {
    super(`GET ${path} answered ${status}`);
    this.path = path;
    this.status = status;
    this.reason = reason;
  }
}

/** @param {unknown} v */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
 *   apps?: { queue?: string, release?: string } }} o
 *   repo: owner/name; contexts: the required checks, from policy.json; apps: the App slugs
 * @returns {Promise<ForgeLine[]>}
 */
export async function checkForge({ get, repo, contexts, apps = {} }) {
  const slugs = {
    queue: apps.queue ?? 'hitld-queue',
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
        get(path).then(
          (r) => (isObject(r) && typeof r.status === 'number' ? r : { status: 0, body: null }),
          () => ({ status: 0, body: null }),
        ),
      );
    }
    return /** @type {Promise<ForgeResponse>} */ (cache.get(path));
  };
  /** The object a 200 answers, else Unreadable. @param {string} path @returns {Promise<any>} */
  const obj = async (path) => {
    const r = await raw(path);
    if (r.status !== 200) throw new Unreadable(path, r.status);
    if (!isObject(r.body)) throw new Unreadable(path, 200, 'the answer is not a JSON object');
    return r.body;
  };
  /** The array a 200 answers, else Unreadable. @param {string} path @returns {Promise<any[]>} */
  const arr = async (path) => {
    const r = await raw(path);
    if (r.status !== 200) throw new Unreadable(path, r.status);
    if (!Array.isArray(r.body)) throw new Unreadable(path, 200, 'the answer is not a JSON list');
    return r.body;
  };
  /**
   * A list field of an answer, else Unreadable: a missing list never reads as an empty one.
   * @param {any} body @param {string} key @param {string} path @returns {any[]}
   */
  const field = (body, key, path) => {
    if (!Array.isArray(body?.[key])) {
      throw new Unreadable(path, 200, `the answer has no ${key} list`);
    }
    return body[key];
  };

  const repoBody = () => obj(R);
  const mainRef = async () => {
    const r = await raw(R);
    const name = r.status === 200 && isObject(r.body) ? r.body.default_branch : null;
    return `refs/heads/${typeof name === 'string' && name ? name : 'main'}`;
  };

  /** @param {string} slug */
  const appId = async (slug) => {
    const path = `/apps/${slug}`;
    const id = (await obj(path)).id;
    if (!Number.isInteger(id)) throw new Unreadable(path, 200, 'the answer has no App ID');
    return id;
  };

  /** The rulesets in full, the default branch spelled out. */
  const rulesets = async () => {
    const main = await mainRef();
    const listPath = `${R}/rulesets?per_page=100`;
    const summaries = await arr(listPath);
    /** @param {unknown} refs */
    const norm = (refs) =>
      (Array.isArray(refs) ? refs : []).map((x) => (x === '~DEFAULT_BRANCH' ? main : String(x)));
    const full = [];
    for (const s of summaries) {
      if (!Number.isInteger(s?.id)) throw new Unreadable(listPath, 200, 'a ruleset has no ID');
      const path = `${R}/rulesets/${s.id}`;
      const r = await obj(path);
      const rules = field(r, 'rules', path);
      full.push({
        ...r,
        rules,
        bypass_actors: field(r, 'bypass_actors', path),
        include: norm(r.conditions?.ref_name?.include),
        exclude: norm(r.conditions?.ref_name?.exclude),
        types: rules.map((/** @type {any} */ x) => String(x?.type)),
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

  /** @param {string} name @returns {Promise<Problem[]>} */
  const rulesetProblems = async (name) => {
    const { main, full } = await rulesets();
    const s = /** @type {Spec} */ (rulesetSpecs(main).find((x) => x.name === name));
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
      problems.push({ what: 'enforcement', found: clean(r.enforcement), expected: 'active' });
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
    const actors = r.bypass_actors.map((/** @type {any} */ a) =>
      `${a?.actor_type} ${a?.actor_id ?? ''}`.trim(),
    );
    const wanted = bypassId === null ? [] : [`Integration ${bypassId}`];
    if (!sameSet(actors, wanted)) {
      problems.push({
        what: 'bypass actors',
        found: list(actors),
        expected: s.bypass ? `Integration ${bypassId} (${clean(slugs[s.bypass])}) only` : 'none',
      });
    }
    /** @param {string} type @returns {any} */
    const param = (type) => {
      const p = r.rules.find((/** @type {any} */ x) => x?.type === type)?.parameters;
      return isObject(p) ? p : {};
    };
    /** @param {unknown} v @returns {any[]} */
    const asList = (v) => (Array.isArray(v) ? v : []);
    if (r.types.includes('pull_request')) {
      const p = param('pull_request');
      const methods = asList(p.allowed_merge_methods);
      if (!sameSet(methods, ['squash'])) {
        problems.push({ what: 'allowed merge methods', found: list(methods), expected: 'squash' });
      }
      if (p.require_code_owner_review !== false) {
        problems.push({
          what: 'code-owner review',
          found: p.require_code_owner_review === true ? 'required' : 'not stated',
          expected: 'not required (HITLD-946)',
        });
      }
    }
    if (r.types.includes('required_status_checks')) {
      const p = param('required_status_checks');
      const checks = asList(p.required_status_checks);
      const names = checks.map((/** @type {any} */ c) => String(c?.context));
      if (!sameSet(names, contexts)) {
        problems.push({
          what: 'required contexts',
          found: list(names),
          expected: `${list(contexts)} (policy.json)`,
        });
      }
      const notActions = checks
        .filter((/** @type {any} */ c) => c?.integration_id !== GITHUB_ACTIONS_APP_ID)
        .map((/** @type {any} */ c) => String(c?.context));
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
      rulesetSpecs('refs/heads/main').map((s) => [s.name, () => rulesetProblems(s.name)]),
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
          what: `a classic branch protection rule on ${clean(main)}`,
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
      const e = await obj(path);
      /** @type {Problem[]} */
      const p = [];
      const reviewers = field(e, 'protection_rules', path)
        .filter((/** @type {any} */ x) => x?.type === 'required_reviewers')
        .flatMap((/** @type {any} */ x) => (Array.isArray(x.reviewers) ? x.reviewers : []))
        .map(
          (/** @type {any} */ x) =>
            `${x?.type} ${x?.reviewer?.login ?? x?.reviewer?.slug ?? x?.reviewer?.id}`,
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
        !isObject(policy) ||
        policy.custom_branch_policies !== true ||
        policy.protected_branches !== false
      ) {
        p.push({
          what: 'deployment branches',
          found: isObject(policy) ? 'not selected branches' : 'any branch',
          expected: 'selected branches: main',
        });
      } else {
        const bPath = `${R}/environments/release/deployment-branch-policies?per_page=100`;
        const names = field(await obj(bPath), 'branch_policies', bPath).map(
          (/** @type {any} */ x) => `${x?.type ?? 'branch'} ${x?.name}`,
        );
        if (!sameSet(names, ['branch main'])) {
          p.push({ what: 'deployment branches', found: list(names), expected: 'branch main only' });
        }
      }
      return p;
    },
    'actions-permissions': async () => {
      const a = await obj(`${R}/actions/permissions`);
      /** @type {Problem[]} */
      const p = [];
      if (a.allowed_actions !== 'selected') {
        p.push({ what: 'allowed actions', found: clean(a.allowed_actions), expected: 'selected' });
      }
      if (a.sha_pinning_required !== true) {
        p.push({ what: 'full-SHA pinning', found: 'not required', expected: 'required' });
      }
      if (a.allowed_actions === 'selected') {
        const sPath = `${R}/actions/permissions/selected-actions`;
        const s = await obj(sPath);
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
        const patterns = field(s, 'patterns_allowed', sPath);
        const pinned = /^ossf\/scorecard-action@[0-9a-f]{40}$/;
        if (patterns.length !== 1 || !pinned.test(String(patterns[0]))) {
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
      const w = await obj(`${R}/actions/permissions/workflow`);
      /** @type {Problem[]} */
      const p = [];
      if (w.default_workflow_permissions !== 'read') {
        p.push({
          what: 'default workflow permissions',
          found: clean(w.default_workflow_permissions),
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
      const path = `${R}/actions/secrets?per_page=100`;
      const s = await obj(path);
      const names = field(s, 'secrets', path).map((/** @type {any} */ x) => x?.name);
      if (!Number.isInteger(s.total_count)) {
        throw new Unreadable(path, 200, 'the answer has no total_count');
      }
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
      const titles = (await arr(`${R}/keys?per_page=100`)).map(
        (/** @type {any} */ x) => `${clean(x?.title)} (${x?.read_only ? 'read' : 'write'})`,
      );
      return titles.length ? [{ what: 'deploy keys', found: list(titles), expected: 'none' }] : [];
    },
    collaborators: async () => {
      const others = (await arr(`${R}/collaborators?affiliation=direct&per_page=100`))
        .map((/** @type {any} */ x) => x?.login)
        .filter((l) => l !== owner);
      return others.length
        ? [{ what: 'collaborators', found: list(others), expected: 'none but the owner' }]
        : [];
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
      lines.push(cannotRead(name, ui, e));
    }
  }
  return lines;
}

/**
 * The line for a check that could not read what it judges. Anything other than a refusal or an
 * answer of the wrong shape (a bug, an answer this did not foresee) also reads cannot-read, so one
 * check never stops the others.
 * @param {string} name @param {string} ui @param {unknown} e @returns {ForgeLine}
 */
function cannotRead(name, ui, e) {
  if (!(e instanceof Unreadable)) {
    const reason = 'the answer did not have the expected shape';
    return {
      check: name,
      result: 'cannot-read',
      ui,
      reason,
      line: `cannot-read: ${name}: ${reason}`,
    };
  }
  if (e.reason) {
    return {
      check: name,
      result: 'cannot-read',
      status: e.status,
      path: e.path,
      reason: e.reason,
      ui,
      line: `cannot-read: ${name}: GET ${e.path} answered ${e.status}, but ${e.reason}`,
    };
  }
  const permission = permissionFor(e.path);
  const answered = e.status === 0 ? 'could not reach the forge (status 0)' : `answered ${e.status}`;
  return {
    check: name,
    result: 'cannot-read',
    status: e.status,
    path: e.path,
    permission,
    ui,
    line: `cannot-read: ${name}: GET ${e.path} ${answered}; needs ${permission}`,
  };
}

/**
 * Every occurrence of the token, wherever the forge put it, replaced before anything reads the
 * answer: a forge that echoes the token cannot get it into a line.
 * @param {ForgeGet} get @param {string} token @returns {ForgeGet}
 */
export function redacting(get, token) {
  return async (path) => {
    const r = await get(path);
    if (!token || !isObject(r)) return r;
    const text = JSON.stringify(r.body);
    if (typeof text !== 'string' || !text.includes(token)) return r;
    return { ...r, body: JSON.parse(text.split(token).join('[redacted]')) };
  };
}

/**
 * The real forge: GitHub's REST API with the caller's read-only token, sent in one header only and
 * redacted from the answer's text before it is parsed.
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
      const text = await res.text();
      body = JSON.parse(token ? text.split(token).join('[redacted]') : text);
    } catch {
      // Not JSON: the shape checks read it as cannot-read.
    }
    return { status: res.status, body };
  };
}
