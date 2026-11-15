// `hitld eval --offline` (design part 17.5): discover scenarios, run them against the fake
// adapter and fixtures, record the result in the private store, and compare it with the stored
// baseline as the regression gate.

import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPolicy, policyHash, resolvePolicy, findRepoRoot } from '../policy/policy.mjs';
import { ownerCheckoutOf } from '../env/primary.mjs';
import { schemas } from '../schema/registry.mjs';
import { openStore, privateStorePath } from '../store/store.mjs';
import { NAME, VERSION } from '../version.mjs';
import { compareToBaseline } from './gate.mjs';
import { PROFILES } from './profiles.mjs';
import {
  acceptBaseline,
  buildResult,
  checkoutCommit,
  findBaseline,
  recordResult,
} from './results.mjs';
import { runCases } from './runner.mjs';
import { discoverScenarios, loadActions, matchesFilter, scenarioSetVersion } from './scenario.mjs';

/** The plugin's own evals directory, and the checkout it is in. */
export const PLUGIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PLUGIN_EVALS = join(PLUGIN_ROOT, 'evals');

/** The seed of a run that does not name one. */
export const DEFAULT_SEED = 1;

/** The project ID used when no policy.json is found (the plugin's own repository has none). */
const STAND_IN_PROJECT = { id: 'hitld-evals', key: 'EV' };

/**
 * @param {string} dir
 * @returns {string}
 */
const real = (dir) => {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
};

/**
 * The evals directories to run: the plugin's, and the consuming project's own when it has one
 * (design part 17.6). `override` replaces both.
 * @param {string} cwd @param {string | undefined} override
 */
export function evalsDirs(cwd, override) {
  if (override) return [real(resolve(cwd, override))];
  /** @type {string[]} */
  const dirs = [real(PLUGIN_EVALS)];
  const root = findRepoRoot(cwd);
  const project = root && join(root, 'evals');
  if (project && existsSync(project) && !dirs.includes(real(project))) dirs.push(real(project));
  return dirs;
}

/**
 * @typedef {object} OfflineOptions
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env
 * @property {string} [scenarios] filter: comma-separated IDs or ID prefixes
 * @property {number} [seed]
 * @property {boolean} [acceptBaseline] record this run as the baseline (the owner's act): in the private store, and in evals/baselines/ of the primary checkout
 * @property {boolean} [requireBaseline] fail unless a baseline committed in this checkout matches the run's settings; the private store's does not count (CI and the release)
 * @property {string} [evalsDir] use only this evals directory (relative to cwd, or absolute)
 * @property {Date} [now]
 */

/**
 * Run the offline suite.
 * @param {OfflineOptions} options
 * @returns {Promise<import('../cli/table.mjs').CommandResult>}
 */
export async function evalOffline(options) {
  const registry = schemas();
  const loadedPolicy = loadPolicy({ cwd: options.cwd });
  /** @type {'file' | 'defaults'} */
  let policySource = 'file';
  let policy = loadedPolicy.policy;
  if (!policy && loadedPolicy.path === null) {
    // No policy.json: the defaults, with a stand-in project ID for the private store.
    policySource = 'defaults';
    policy = resolvePolicy(
      { schema_version: registry.currentVersion('policy'), project: STAND_IN_PROJECT },
      registry,
    ).policy;
  }
  if (!policy) {
    return {
      ok: false,
      error: 'policy',
      message: 'policy.json is not valid; run hitld check policy',
      errors: loadedPolicy.errors,
    };
  }

  const actions = await loadActions();
  const dirs = evalsDirs(options.cwd, options.evalsDir);
  const seen = new Set();
  /** @type {import('./scenario.mjs').LoadedScenario[]} */
  const loaded = [];
  for (const dir of dirs) {
    for (const l of discoverScenarios(dir, actions)) {
      if (seen.has(l.id)) {
        loaded.push({
          ...l,
          scenario: null,
          problems: [`id ${l.id} is also used by a scenario in another evals directory`],
        });
      } else {
        loaded.push(l);
      }
      seen.add(l.id);
    }
  }
  const filter = options.scenarios ?? null;
  const chosen = loaded.filter((l) => matchesFilter(l.id, filter));
  if (chosen.length === 0) {
    return {
      ok: false,
      error: 'no_scenarios',
      message: filter
        ? `no scenario matches "${filter}" (${loaded.length} found; IDs are <suite>/<name>)`
        : `no scenarios found under ${dirs.map((d) => join(d, 'scenarios')).join(', ')}`,
    };
  }

  const seed = options.seed ?? DEFAULT_SEED;
  const profiles = Object.keys(PROFILES).sort();
  const cases = await runCases(chosen, { seed, actions, profiles });
  const { result, transcripts } = buildResult({
    cases,
    now: options.now ?? new Date(),
    version: VERSION,
    name: NAME,
    commit: checkoutCommit(PLUGIN_ROOT),
    mode: 'offline',
    seed,
    profiles,
    filter,
    policyHash: policyHash(policy),
    policySource,
    scenarioSetVersion: scenarioSetVersion(chosen),
    scenarioCount: chosen.length,
  });

  const store = openStore(
    privateStorePath(policy.project.id, { env: options.env, repoRoot: options.cwd }),
  );
  // The baseline committed in this checkout first, then the private store's.
  const root = findRepoRoot(options.cwd) ?? resolve(options.cwd);
  const found = findBaseline(
    { store, root, committedOnly: options.requireBaseline === true },
    result,
  );
  const evalPolicy = policy.eval ?? {};
  const verdict = compareToBaseline(
    result,
    found.baseline,
    {
      category_floors: evalPolicy.category_floors ?? {},
      score_tolerance: evalPolicy.score_tolerance ?? 0,
      tokens_tolerance: evalPolicy.tokens_tolerance ?? 0.1,
    },
    { inScope: (id) => matchesFilter(id, filter), origin: found },
  );
  // The gate judges regressions; a required baseline that is missing fails the command, not the
  // verdict, so the run stays one the owner can accept.
  const baselineMissing =
    options.requireBaseline === true && found.source !== 'committed'
      ? `no baseline is committed for these settings (mode offline, seed ${seed}): ${found.path} is missing. The owner runs hitld eval --offline, then hitld eval accept --result <run>, and commits the file it writes`
      : null;
  result.gate = verdict;

  const s = result.summary;
  const failing = result.scenarios.filter(
    (/** @type {any} */ c) => c.result === 'fail' || c.result === 'error',
  );
  /** @type {{ key: string, file: string } | null} */
  let accepted = null;
  /** @type {string | null} */
  let acceptRefused = null;
  if (options.acceptBaseline) {
    if (filter) acceptRefused = 'a baseline comes from a full run: drop --scenarios';
    else if (failing.length)
      acceptRefused = 'a run with failing scenarios cannot become the baseline';
  }
  const key = recordResult(store, result, transcripts);
  if (options.acceptBaseline && !acceptRefused) {
    // The committed copy goes to the primary checkout, never to a linked worktree.
    const primary = ownerCheckoutOf(options.cwd) ?? root;
    try {
      accepted = acceptBaseline({ store, root: primary, result, now: options.now });
    } catch (e) {
      acceptRefused = e instanceof Error ? e.message : String(e);
    }
  }

  const clean = failing.length === 0;
  return {
    ok: clean && (accepted !== null || (verdict.ok && baselineMissing === null)) && !acceptRefused,
    mode: 'offline',
    run: result.id,
    stored: join(store.root, key),
    scenario_set: result.scenario_set,
    summary: {
      total: s.total,
      passed: s.passed,
      failed: s.failed,
      errors: s.errors,
      not_applicable: s.not_applicable,
    },
    categories: s.categories,
    gate: verdict,
    ...(baselineMissing && !accepted
      ? { error: 'no_committed_baseline', message: baselineMissing }
      : {}),
    ...(accepted
      ? {
          baseline_accepted: join(store.root, accepted.key),
          baseline_committed: accepted.file,
          baseline_commit_note: `commit ${accepted.file} to make this the baseline CI and every machine gates on`,
        }
      : {}),
    ...(acceptRefused ? { baseline_refused: acceptRefused } : {}),
    problems: failing.map((/** @type {any} */ c) => ({
      scenario: c.id,
      profile: c.profile,
      result: c.result,
      ...(c.reason ? { reason: c.reason } : {}),
      failed_graders: c.graders
        .filter((/** @type {any} */ g) => !g.passed)
        .map((/** @type {any} */ g) => `${g.id}: ${g.message}`),
      transcript: c.transcript,
    })),
  };
}
