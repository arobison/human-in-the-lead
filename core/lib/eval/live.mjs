// SEAM: live eval runs (design part 17.5). Not built yet.
//
// `hitld eval --live` will run the scenarios that need a model, against a named harness, model and
// effort, `k` times each (default 3), and report pass@k, pass^k and the standard deviation. Its
// results use the same result format as the offline runner (schemas/eval-result.schema.json,
// mode "live"), so the regression gate (gate.mjs) compares them the same way, with
// eval.score_tolerance set from the measured run-to-run variance.
//
// Two runners are planned, per design part 17.5 and part 22 (Q8):
//   - Skill-level scenarios on Claude Code are compiled to `claude plugin eval` cases and run by
//     it: compileToPluginEval below. Its runs are all live; it does not replay model responses.
//   - End-to-end, adversarial, controller and portability scenarios run in this runner against a
//     real harness adapter instead of the fake one: runLive below. The scenario format is
//     harness-neutral, so the same files serve both; `mode: "live"` marks a scenario that needs it,
//     and the `model_judge` grader is implemented here.
//
// What the offline runner already provides for these to reuse: scenario loading and checking
// (scenario.mjs), sandboxes and fixtures (runner.mjs, fixtures.mjs), the grader set (graders.mjs),
// result recording and the baseline (results.mjs) and the gate (gate.mjs).

/**
 * @typedef {object} LiveRequest
 * @property {string} harness the adapter ID, for example "claude-code"
 * @property {Record<string, { model: string, effort?: string }>} models per role
 * @property {number} k repeats per scenario
 * @property {number} [budgetTokens] eval.live_budget_tokens: stop and report partial results past it
 */

export class LiveNotBuilt extends Error {
  constructor() {
    super(
      'hitld eval --live is not built yet: it comes after "Usable in a consuming project" (see core/lib/eval/live.mjs for the plan). Use --offline.',
    );
  }
}

/**
 * @param {import('./scenario.mjs').LoadedScenario[]} _scenarios
 * @param {LiveRequest} _request
 * @returns {Promise<import('./runner.mjs').CaseResult[]>}
 */
export async function runLive(_scenarios, _request) {
  throw new LiveNotBuilt();
}

/**
 * Compile a harness-neutral scenario to a `claude plugin eval` case.
 * @param {Record<string, unknown>} _scenario
 * @returns {Record<string, unknown>}
 */
export function compileToPluginEval(_scenario) {
  throw new LiveNotBuilt();
}
