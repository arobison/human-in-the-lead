// The offline runner (design part 17.5): runs scenarios in sandboxes against the fake adapter and
// grades them. It builds the list of cases (a scenario under each harness profile it names),
// runs them in a seeded order, and returns each one's verdict with its transcript. Recording the
// results and the regression gate are in results.mjs and gate.mjs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAdapter } from '../../harness/fake/fake.mjs';
import { GRADERS, boundVerdict } from './graders.mjs';
import { buildFixture } from './fixtures.mjs';
import { NO_PROFILE, PROFILES, missingCapabilities } from './profiles.mjs';
import { hashSeed, seededShuffle } from './util.mjs';

/**
 * @typedef {import('./scenario.mjs').LoadedScenario} LoadedScenario
 * @typedef {import('./actions/builtin.mjs').Action} Action
 *
 * @typedef {object} CaseResult one scenario under one profile
 * @property {string} id
 * @property {string} piece
 * @property {string} category
 * @property {string} profile
 * @property {'pass' | 'fail' | 'error' | 'not_applicable'} status
 * @property {number | null} score
 * @property {string} [reason]
 * @property {(import('./graders.mjs').Verdict & { id: string, grader: string, expected_truncated?: true, actual_truncated?: true })[]} graders
 * @property {number} wall_ms
 * @property {number | null} tokens
 * @property {unknown[]} transcript what each step did; kept by the caller for scenarios that did not pass
 */

/**
 * The cases a loaded scenario runs as: one per profile it names, or one with no profile.
 * @param {Record<string, any>} scenario @returns {string[]}
 */
export function profilesFor(scenario) {
  if (!scenario.harness) return [NO_PROFILE];
  const names = scenario.harness.profiles.includes('*')
    ? Object.keys(PROFILES)
    : scenario.harness.profiles;
  return [...names].sort();
}

/**
 * Run one scenario under one profile.
 * @param {LoadedScenario} loaded @param {string} profile
 * @param {{ seed: number, actions: Record<string, Action>, keepSandbox?: boolean }} options
 * @returns {Promise<CaseResult>}
 */
export async function runCase(loaded, profile, options) {
  const started = performance.now();
  const sc = loaded.scenario;
  /** @type {CaseResult} */
  const base = {
    id: loaded.id,
    piece: loaded.piece,
    category: sc?.category ?? 'invalid',
    profile,
    status: 'error',
    score: null,
    graders: [],
    wall_ms: 0,
    tokens: null,
    transcript: [],
  };
  /** @param {Partial<CaseResult>} change @returns {CaseResult} */
  const done = (change) => ({
    ...base,
    ...change,
    wall_ms: Math.max(0, Math.round(performance.now() - started)),
  });

  if (!sc)
    return done({
      status: 'error',
      score: 0,
      reason: `scenario does not load: ${loaded.problems.join('; ')}`,
    });
  if (sc.mode === 'live') {
    return done({
      status: 'not_applicable',
      reason: 'a live scenario: `hitld eval --live` runs it, and it is not built yet',
    });
  }
  const judged = sc.graders.find(
    (/** @type {{ grader: string }} */ g) => GRADERS[g.grader]?.needsModel,
  );
  if (judged) {
    return done({
      status: 'not_applicable',
      reason: `uses the ${judged.grader} grader, which needs a model (live mode)`,
    });
  }
  const profileDef = PROFILES[profile];
  if (sc.harness) {
    const missing = missingCapabilities(profileDef.capabilities, sc.harness.requires ?? {});
    if (missing.length) {
      return done({
        status: 'not_applicable',
        reason: `${profile} lacks what it needs: ${missing.join('; ')}`,
      });
    }
  }

  const sandbox = mkdtempSync(join(tmpdir(), 'hitld-eval-'));
  /** @type {unknown[]} */
  const transcript = [];
  let tokens = 0;
  let usedTokens = false;
  /** @type {import('../../harness/fake/fake.mjs').FakeAdapter | undefined} */
  let adapter;
  try {
    const seed = sc.seed ?? hashSeed(loaded.id, options.seed);
    if (sc.fixture) {
      const fixture = buildFixture(sandbox, sc.fixture, { seed, evalsDir: loaded.evalsDir });
      transcript.push({
        fixture: sc.fixture.generator,
        files: fixture.files,
        commit: fixture.commit,
      });
    }
    /** @type {Record<string, unknown>} */
    const steps = {};
    const ctx = {
      sandbox,
      seed,
      profile,
      adapter: () =>
        (adapter ??= createFakeAdapter({
          id: 'fake',
          capabilities: { ...profileDef.capabilities },
        })),
      recordTokens: (/** @type {number} */ n) => {
        tokens += n;
        usedTokens = true;
      },
    };
    for (const step of sc.steps) {
      const t = performance.now();
      /** @type {Record<string, unknown>} */
      const entry = { step: step.id, action: step.action, with: step.with ?? {} };
      transcript.push(entry);
      try {
        steps[step.id] = await options.actions[step.action].run(step.with ?? {}, ctx);
        entry.result = steps[step.id];
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        return done({
          status: 'error',
          score: 0,
          reason: `step ${step.id} (${step.action}) failed to run: ${entry.error}`,
          transcript,
          tokens: usedTokens ? tokens : null,
        });
      } finally {
        entry.wall_ms = Math.round(performance.now() - t);
      }
    }
    const state = { steps, sandbox, adapterCalls: adapter ? adapter.calls : [] };
    /** @type {CaseResult['graders']} */
    const graders = [];
    sc.graders.forEach((/** @type {Record<string, any>} */ g, /** @type {number} */ i) => {
      const id = g.id ?? `${g.grader}-${i + 1}`;
      try {
        const verdict = GRADERS[g.grader].run(g.with ?? {}, state);
        graders.push({ id, grader: g.grader, ...boundVerdict(verdict) });
      } catch (e) {
        graders.push({
          id,
          grader: g.grader,
          passed: false,
          message: `grader failed to run: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    });
    transcript.push({ graders });
    const passed = graders.filter((g) => g.passed).length;
    return done({
      status: passed === graders.length ? 'pass' : 'fail',
      score: passed / graders.length,
      graders,
      transcript,
      tokens: usedTokens ? tokens : null,
    });
  } catch (e) {
    return done({
      status: 'error',
      score: 0,
      reason: `the runner failed: ${e instanceof Error ? e.message : String(e)}`,
      transcript,
    });
  } finally {
    if (!options.keepSandbox) rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Run every case of the given scenarios, one at a time, in an order fixed by the seed. Results
 * come back sorted by scenario and profile.
 * @param {LoadedScenario[]} loaded
 * @param {{ seed: number, actions: Record<string, Action>, profiles?: string[] }} options
 *   profiles: restrict to these profiles (a scenario's own list is intersected with it)
 * @returns {Promise<CaseResult[]>}
 */
export async function runCases(loaded, options) {
  /** @type {{ loaded: LoadedScenario, profile: string }[]} */
  const cases = [];
  for (const l of loaded) {
    if (!l.scenario) {
      cases.push({ loaded: l, profile: NO_PROFILE });
      continue;
    }
    for (const profile of profilesFor(l.scenario)) {
      if (profile === NO_PROFILE || !options.profiles || options.profiles.includes(profile)) {
        cases.push({ loaded: l, profile });
      }
    }
  }
  cases.sort((a, b) => (a.loaded.id + a.profile < b.loaded.id + b.profile ? -1 : 1));
  const results = [];
  for (const c of seededShuffle(cases, options.seed)) {
    results.push(await runCase(c.loaded, c.profile, options));
  }
  return results.sort((a, b) => (a.id + a.profile < b.id + b.profile ? -1 : 1));
}
