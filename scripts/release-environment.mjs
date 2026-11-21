#!/usr/bin/env node
// The release workflow's check that the `release` environment makes a release wait for the
// owner's approval (HITLD-140, HITLD-229; design 16.5, Release mechanics). The `record` job runs it
// before the `release` job starts:
//   node scripts/release-environment.mjs [--repo <owner/name>] [--environment <name>]
// It reads the environment and its deployment branch rules through the GitHub REST API (GET
// /repos/{owner}/{repo}/environments/{name} and .../{name}/deployment-branch-policies) with the
// token in GH_TOKEN, at $GITHUB_API_URL (default https://api.github.com); --repo defaults to
// $GITHUB_REPOSITORY and --environment to `release`.
// Exit 0: the environment has a required reviewer, administrators cannot bypass its rules, and it
// takes deployments from the `main` branch only. Exit 1: refused, fail closed: the environment is
// missing (GitHub would create it with no rules on first use), lacks any of the three, or could
// not be read (any API or network error). Exit 2: usage.
//
// Not shipped in the plugin: it checks this repository's release settings, not part of the core.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const HOW_TO_ADD =
  'Add one: Settings → Environments → {env} → Deployment protection rules → check Required reviewers → add the owner → Save protection rules (CONTRIBUTING.md, Releases).';
const HOW_TO_STOP_BYPASS =
  'Turn it off: Settings → Environments → {env} → Deployment protection rules → uncheck Allow administrators to bypass configured protection rules → Save protection rules (CONTRIBUTING.md, Releases).';
const HOW_TO_LIMIT =
  'Limit it: Settings → Environments → {env} → Deployment branches and tags → Selected branches and tags → Add deployment branch or tag rule → Ref type Branch, name pattern main → Add rule, and remove every other rule (CONTRIBUTING.md, Releases).';
const HOW_TO_CREATE =
  'Create it: Settings → Environments → New environment → Name {env} → Configure environment, then check Required reviewers, add the owner, uncheck Allow administrators to bypass configured protection rules, Save protection rules, and limit Deployment branches and tags to the branch main (CONTRIBUTING.md, Releases).';

/**
 * @typedef {{ status: number, body: string }} ApiResponse
 * @typedef {{ ok: true, environment: string, reviewers: number }
 *   | { ok: false, environment: string, problem: string }} EnvironmentCheck
 */

/**
 * Why an API answer could not be read, or its parsed JSON.
 * @param {ApiResponse | Error | undefined} answer
 * @returns {{ error: string } | { json: unknown }}
 */
function parseAnswer(answer) {
  if (answer === undefined) return { error: 'it was not read' };
  if (answer instanceof Error) return { error: answer.message };
  if (answer.status !== 200) {
    const hint =
      answer.status === 401 || answer.status === 403
        ? ' (the record job needs the `actions: read` permission to read it)'
        : '';
    return { error: `the GitHub API answered ${answer.status}${hint}` };
  }
  try {
    return { json: JSON.parse(answer.body) };
  } catch {
    return { error: 'the GitHub API answered with no JSON' };
  }
}

/**
 * Why the environment does not take deployments from the `main` branch only, or null when it
 * does: a custom deployment branch policy whose every rule is the branch `main`, all of them read.
 * @param {string} environment
 * @param {unknown} branchPolicy the environment's `deployment_branch_policy`
 * @param {ApiResponse | Error | undefined} policies the answer to .../deployment-branch-policies
 * @returns {string | null}
 */
function notMainOnly(environment, branchPolicy, policies) {
  const p = /** @type {{ protected_branches?: unknown, custom_branch_policies?: unknown }} */ (
    branchPolicy ?? {}
  );
  if (branchPolicy == null)
    return `the ${environment} environment takes deployments from any branch`;
  if (p.protected_branches === true) {
    return `the ${environment} environment takes deployments from any protected branch, not only main`;
  }
  if (p.custom_branch_policies !== true) {
    return `the ${environment} environment is not limited to selected branches`;
  }
  const read = parseAnswer(policies);
  if ('error' in read) {
    return `could not read the ${environment} environment's deployment branch rules: ${read.error}`;
  }
  const body = /** @type {{ total_count?: unknown, branch_policies?: unknown }} */ (
    read.json ?? {}
  );
  const rules = Array.isArray(body.branch_policies) ? body.branch_policies : null;
  if (!rules || body.total_count !== rules.length) {
    return `could not read the ${environment} environment's deployment branch rules: the GitHub API answered with no complete list`;
  }
  const isMain = (/** @type {any} */ r) => r?.type === 'branch' && r?.name === 'main';
  if (rules.length > 0 && rules.every(isMain)) return null;
  const seen = rules.map((/** @type {any} */ r) => `${r?.type ?? 'unknown'} ${r?.name ?? '?'}`);
  return `the ${environment} environment takes deployments from ${seen.length ? seen.join(', ') : 'no rule'}, not the branch main only`;
}

/**
 * Decide from the API's answers whether the environment makes a release wait for the owner.
 * Anything but a readable environment with a required-reviewers rule naming at least one
 * reviewer, `can_admins_bypass` false, and deployments from the branch `main` only is refused;
 * every problem found is named.
 * @param {string} environment
 * @param {ApiResponse | Error} answer the environment's response, or the error that stopped it
 * @param {ApiResponse | Error} [policies] the deployment branch rules' response, or its error
 * @returns {EnvironmentCheck}
 */
export function judgeEnvironment(environment, answer, policies) {
  const refuse = (/** @type {string} */ problem) => ({
    ok: /** @type {const} */ (false),
    environment,
    problem,
  });
  const how = (/** @type {string} */ text) => text.replaceAll('{env}', environment);
  if (answer instanceof Error) {
    return refuse(`could not read the ${environment} environment: ${answer.message}`);
  }
  if (answer.status === 404) {
    return refuse(
      `the repository has no ${environment} environment, and GitHub would create it with no required reviewer when the release job first uses it. ${how(HOW_TO_CREATE)}`,
    );
  }
  const read = parseAnswer(answer);
  if ('error' in read)
    return refuse(`could not read the ${environment} environment: ${read.error}`);
  const env = /** @type {{ protection_rules?: unknown, can_admins_bypass?: unknown,
    deployment_branch_policy?: unknown }} */ (read.json ?? {});
  /** @type {string[]} */
  const problems = [];
  const rules = env.protection_rules;
  const reviewers = (Array.isArray(rules) ? rules : [])
    .filter((r) => r?.type === 'required_reviewers')
    .flatMap((r) => (Array.isArray(r.reviewers) ? r.reviewers : []));
  if (reviewers.length === 0) {
    problems.push(
      `the ${environment} environment has no required reviewer, so a release would tag, build and draft without the owner's approval. ${how(HOW_TO_ADD)}`,
    );
  }
  if (env.can_admins_bypass !== false) {
    problems.push(
      `${env.can_admins_bypass === true ? 'administrators can bypass' : 'could not tell whether administrators can bypass'} the ${environment} environment's protection rules, so an administrator could release without the owner's approval. ${how(HOW_TO_STOP_BYPASS)}`,
    );
  }
  const branches = notMainOnly(environment, env.deployment_branch_policy, policies);
  if (branches) {
    problems.push(
      `${branches}, so a run from another branch could deploy to it. ${how(HOW_TO_LIMIT)}`,
    );
  }
  if (problems.length) return refuse(problems.join(' Also: '));
  return { ok: true, environment, reviewers: reviewers.length };
}

/**
 * Read one GitHub API path.
 * @param {{ api: string, path: string, token: string }} o
 * @returns {Promise<ApiResponse | Error>}
 */
export async function readApi({ api, path, token }) {
  const url = `${api.replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'release-environment-check',
      },
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    const err = /** @type {Error & { cause?: Error }} */ (e);
    return new Error(err.cause?.message ?? err.message);
  }
}

/**
 * Read the environment and its deployment branch rules (at most 100; more fails closed).
 * @param {{ api: string, repo: string, environment: string, token: string }} o
 * @returns {Promise<[ApiResponse | Error, ApiResponse | Error]>}
 */
export async function readEnvironment({ api, repo, environment, token }) {
  const base = `/repos/${repo}/environments/${encodeURIComponent(environment)}`;
  return Promise.all([
    readApi({ api, path: base, token }),
    readApi({ api, path: `${base}/deployment-branch-policies?per_page=100`, token }),
  ]);
}

async function main() {
  /** @type {ReturnType<typeof parseArgs>['values']} */
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
        environment: { type: 'string', default: 'release' },
      },
    }));
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message));
    process.exit(2);
  }
  const repo = String(values.repo);
  const environment = String(values.environment);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error('--repo takes owner/name (default: $GITHUB_REPOSITORY)');
    process.exit(2);
  }
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN is not set');
    process.exit(2);
  }
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const [answer, policies] = await readEnvironment({ api, repo, environment, token });
  const r = judgeEnvironment(environment, answer, policies);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) {
    if (process.env.GITHUB_ACTIONS === 'true')
      console.log(`::error title=Release refused::${r.problem}`);
    console.error(`refused: ${r.problem}`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
