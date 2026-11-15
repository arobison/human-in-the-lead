// Eval results (design part 17.5): one JSON document per run in the private store, the baseline
// the regression gate compares with, and the transcripts of what did not pass.
//
// Store keys, under the eval/ prefix:
//   eval/results/<run ID>.json
//   eval/baselines/<mode>-<settings hash>.json     a full run the owner accepted as the baseline
//   eval/transcripts/<run ID>/<scenario>@<profile>.json

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { canonicalJson } from '../policy/policy.mjs';

/**
 * @typedef {import('./runner.mjs').CaseResult} CaseResult
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} EvalResult
 */

// Version 2 added the optional grader detail (path, expected, actual) and the baseline's
// `accepted` record. Both are optional, so version 1 runs and baselines still load.
export const RESULT_SCHEMA_VERSION = 3;

/** Scenario suites renamed by HITLD-82 (the letter prefixes went). */
const LEGACY_SUITES = /** @type {Record<string, string>} */ ({
  'd-contract': 'contract',
  'f-quotas': 'quotas',
  'h-orchestrator': 'orchestrator',
});

/**
 * A stored result of schema version 2 or older in the names of version 3 (HITLD-82), read until
 * the next minor release: each scenario's `status` is `result`, `not_applicable` is
 * `not-applicable`, `piece` is `suite`, and a suite named with a letter prefix has lost it, so a
 * baseline from before still compares by scenario. The schema_version stays as written.
 * @param {any} doc
 */
export function fromLegacyResult(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.scenarios)) return doc;
  if (typeof doc.schema_version !== 'number' || doc.schema_version >= 3) return doc;
  const suite = (/** @type {string} */ s) => LEGACY_SUITES[s] ?? s;
  return {
    ...doc,
    scenarios: doc.scenarios.map((/** @type {any} */ c) => {
      const { status, piece, ...rest } = c;
      const [first, ...name] = String(rest.id).split('/');
      return {
        ...rest,
        id: [suite(first), ...name].join('/'),
        suite: suite(String(piece ?? rest.suite ?? first)),
        result: status === 'not_applicable' ? 'not-applicable' : (status ?? rest.result),
      };
    }),
  };
}

/**
 * The hash of what must match for two runs to be comparable.
 * @param {{ mode: string, seed: number, profiles: string[] }} settings @returns {string} twelve hex digits
 */
export function settingsHash({ mode, seed, profiles }) {
  const text = canonicalJson({ mode, seed, profiles: [...profiles].sort() });
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The commit of a checkout, or null when it is not a git checkout or git is absent.
 * @param {string} dir @returns {string | null}
 */
export function checkoutCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/** @param {Date} d "20261114T031500Z" */
const compact = (d) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/**
 * Summarize cases: counts, totals, and each category's mean score over its applicable cases
 * (not-applicable ones are left out, never counted as passes).
 * @param {CaseResult[]} cases
 */
export function summarize(cases) {
  const count = (/** @type {string} */ s) => cases.filter((c) => c.result === s).length;
  /** @type {Record<string, { sum: number, n: number }>} */
  const byCategory = {};
  for (const c of cases) {
    if (c.result === 'not-applicable') continue;
    const slot = (byCategory[c.category] ??= { sum: 0, n: 0 });
    slot.sum += c.score ?? 0;
    slot.n += 1;
  }
  return {
    total: cases.length,
    passed: count('pass'),
    failed: count('fail'),
    errors: count('error'),
    not_applicable: count('not-applicable'),
    tokens: cases.reduce((a, c) => a + (c.tokens ?? 0), 0),
    wall_ms: cases.reduce((a, c) => a + c.wall_ms, 0),
    categories: Object.fromEntries(
      Object.entries(byCategory)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, { score: v.sum / v.n, scenarios: v.n }]),
    ),
  };
}

/**
 * Build the result document for a run. Transcripts are not in it: it holds their store keys.
 * @param {{
 *   cases: CaseResult[], now: Date, version: string, name: string, commit: string | null,
 *   mode: 'offline' | 'live', seed: number, profiles: string[], filter: string | null,
 *   policyHash: string | null, policySource: 'file' | 'defaults', scenarioSetVersion: string,
 *   scenarioCount: number,
 * }} run
 * @returns {{ result: EvalResult, transcripts: Map<string, unknown> }} transcripts by store key
 */
export function buildResult(run) {
  const hash = settingsHash(run);
  const id = `EV-${compact(run.now)}-${hash.slice(0, 6)}`;
  /** @type {Map<string, unknown>} */
  const transcripts = new Map();
  const scenarios = run.cases.map((c) => {
    /** @type {string | null} */
    let transcript = null;
    if (c.result !== 'pass' && c.result !== 'not-applicable') {
      transcript = `eval/transcripts/${id}/${c.id.replace('/', '__')}@${c.profile}.json`;
      transcripts.set(transcript, {
        scenario: c.id,
        profile: c.profile,
        result: c.result,
        reason: c.reason ?? null,
        steps: c.transcript,
      });
    }
    return {
      id: c.id,
      suite: c.suite,
      category: c.category,
      profile: c.profile,
      result: c.result,
      score: c.score,
      ...(c.reason ? { reason: c.reason } : {}),
      graders: c.graders,
      wall_ms: c.wall_ms,
      tokens: c.tokens,
      transcript,
    };
  });
  /** @type {EvalResult} */
  const result = {
    schema_version: RESULT_SCHEMA_VERSION,
    id,
    at: run.now.toISOString(),
    mode: run.mode,
    plugin: { name: run.name, version: run.version, commit: run.commit },
    schema_versions: Object.fromEntries(
      schemas()
        .versionedIds()
        .sort()
        .map((s) => [s, /** @type {number} */ (schemas().currentVersion(s))]),
    ),
    harness: { adapter: 'fake', profiles: [...run.profiles].sort() },
    policy_hash: run.policyHash,
    policy_source: run.policySource,
    settings: {
      seed: run.seed,
      profiles: [...run.profiles].sort(),
      scenario_filter: run.filter,
      settings_hash: hash,
    },
    scenario_set: { version: run.scenarioSetVersion, count: run.scenarioCount },
    scenarios,
    summary: summarize(run.cases),
  };
  return { result, transcripts };
}

/**
 * Check a result against its schema, then write it and its transcripts.
 * @param {PrivateStore} store @param {EvalResult} result @param {Map<string, unknown>} transcripts
 * @returns {string} the store key of the result
 */
export function recordResult(store, result, transcripts) {
  const errors = schemas().validateEntity('eval-result', result);
  if (errors.length)
    throw new Error(`the eval result is not valid (a bug in the runner): ${formatErrors(errors)}`);
  for (const [key, doc] of transcripts) store.write(key, `${JSON.stringify(doc, null, 2)}\n`);
  const key = `eval/results/${result.id}.json`;
  store.write(key, `${JSON.stringify(result, null, 2)}\n`);
  return key;
}

/** @param {string} mode @param {string} hash */
export const baselineKey = (mode, hash) => `eval/baselines/${mode}-${hash}.json`;

/**
 * The baseline for a run's settings, or null.
 * @param {PrivateStore} store @param {EvalResult} result @returns {EvalResult | null}
 */
export function readBaseline(store, result) {
  const text = store.read(baselineKey(result.mode, result.settings.settings_hash));
  if (text === null) return null;
  const doc = fromLegacyResult(JSON.parse(text));
  const errors = schemas().validateEntity('eval-result', doc);
  if (errors.length) {
    throw new Error(`the stored baseline is not a valid eval result: ${formatErrors(errors)}`);
  }
  return doc;
}

/**
 * Why a stored run cannot be accepted as the baseline, or null when it can. The one rule behind
 * `hitld eval accept` and the accept text on the results page.
 * @param {EvalResult} run @param {EvalResult | null} baseline the baseline now stored for the run's settings
 * @returns {string | null}
 */
export function acceptRefusal(run, baseline) {
  if (run.mode !== 'offline') return `${run.mode} runs have no accept command yet`;
  if (run.settings.scenario_filter != null)
    return 'this run covered only some scenarios; a baseline comes from a full run';
  if (run.summary.failed + run.summary.errors > 0)
    return 'this run has failing scenarios; a failing run cannot be a baseline';
  if (!run.gate) return 'no gate verdict was recorded for this run';
  if (!run.gate.ok) return 'this run failed the regression gate';
  if (baseline?.id === run.id) return 'this run is already the baseline';
  // The gate must have judged this run against the baseline stored now: a run judged against an
  // older baseline (or none) could otherwise roll the baseline back.
  if ((run.gate.baseline ?? null) !== (baseline?.id ?? null)) {
    return 'this run was judged against a different baseline than the current one; run the suite again';
  }
  if (baseline && run.at < baseline.at) return 'this run is older than the current baseline';
  return null;
}

/**
 * Make a run the baseline for its settings, and record who accepted it and when.
 * @param {PrivateStore} store @param {EvalResult} result @param {Date} [now]
 * @returns {string} the store key
 */
export function writeBaseline(store, result, now = new Date()) {
  const key = baselineKey(result.mode, result.settings.settings_hash);
  const doc = { ...result, accepted: { by: 'owner', at: now.toISOString(), run: result.id } };
  store.write(key, `${JSON.stringify(doc, null, 2)}\n`);
  return key;
}
