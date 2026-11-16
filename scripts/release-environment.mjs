#!/usr/bin/env node
// The release workflow's check that the `release` environment makes a release wait for the
// owner's approval (HITLD-140; design 16.5, Release mechanics). The `record` job runs it before
// the `release` job starts:
//   node scripts/release-environment.mjs [--repo <owner/name>] [--environment <name>]
// It reads the environment through the GitHub REST API (GET /repos/{owner}/{repo}/environments/
// {name}) with the token in GH_TOKEN, at $GITHUB_API_URL (default https://api.github.com); --repo
// defaults to $GITHUB_REPOSITORY and --environment to `release`.
// Exit 0: the environment has a required reviewer. Exit 1: refused, fail closed: the environment
// is missing (GitHub would create it with no rules on first use), has no required reviewer, or
// could not be read (any API or network error). Exit 2: usage.
//
// Not shipped in the plugin: it checks this repository's release settings, not part of the core.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const HOW_TO_ADD =
  'Add one: Settings → Environments → {env} → Deployment protection rules → check Required reviewers → add the owner → Save protection rules (CONTRIBUTING.md, Releases).';
const HOW_TO_CREATE =
  'Create it: Settings → Environments → New environment → Name {env} → Configure environment, then check Required reviewers, add the owner and Save protection rules (CONTRIBUTING.md, Releases).';

/**
 * @typedef {{ status: number, body: string }} ApiResponse
 * @typedef {{ ok: true, environment: string, reviewers: number }
 *   | { ok: false, environment: string, problem: string }} EnvironmentCheck
 */

/**
 * Decide from the API's answer whether the environment makes a release wait for a reviewer.
 * Anything but a readable environment with a required-reviewers rule naming at least one reviewer
 * is refused.
 * @param {string} environment
 * @param {ApiResponse | Error} answer the response, or the error that stopped the request
 * @returns {EnvironmentCheck}
 */
export function judgeEnvironment(environment, answer) {
  const refuse = (/** @type {string} */ problem) => ({
    ok: /** @type {const} */ (false),
    environment,
    problem,
  });
  const add = HOW_TO_ADD.replaceAll('{env}', environment);
  if (answer instanceof Error) {
    return refuse(`could not read the ${environment} environment: ${answer.message}`);
  }
  if (answer.status === 404) {
    return refuse(
      `the repository has no ${environment} environment, and GitHub would create it with no required reviewer when the release job first uses it. ${HOW_TO_CREATE.replaceAll('{env}', environment)}`,
    );
  }
  if (answer.status !== 200) {
    const hint =
      answer.status === 401 || answer.status === 403
        ? ' (the record job needs the `actions: read` permission to read it)'
        : '';
    return refuse(
      `could not read the ${environment} environment: the GitHub API answered ${answer.status}${hint}`,
    );
  }
  /** @type {unknown} */
  let env;
  try {
    env = JSON.parse(answer.body);
  } catch {
    return refuse(
      `could not read the ${environment} environment: the GitHub API answered with no JSON`,
    );
  }
  const rules = /** @type {{ protection_rules?: unknown }} */ (env ?? {}).protection_rules;
  const reviewers = (Array.isArray(rules) ? rules : [])
    .filter((r) => r?.type === 'required_reviewers')
    .flatMap((r) => (Array.isArray(r.reviewers) ? r.reviewers : []));
  if (reviewers.length === 0) {
    return refuse(
      `the ${environment} environment has no required reviewer, so a release would tag, build and draft without the owner's approval. ${add}`,
    );
  }
  return { ok: true, environment, reviewers: reviewers.length };
}

/**
 * Read the environment through the GitHub API.
 * @param {{ api: string, repo: string, environment: string, token: string }} o
 * @returns {Promise<ApiResponse | Error>}
 */
export async function readEnvironment({ api, repo, environment, token }) {
  const url = `${api.replace(/\/+$/, '')}/repos/${repo}/environments/${encodeURIComponent(environment)}`;
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
  const r = judgeEnvironment(environment, await readEnvironment({ api, repo, environment, token }));
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) {
    if (process.env.GITHUB_ACTIONS === 'true')
      console.log(`::error title=Release refused::${r.problem}`);
    console.error(`refused: ${r.problem}`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
