// The regression gate (design part 17.5): compares a run with the baseline, scenario by scenario.
//
// A run fails the gate when
//   - a scenario that passed in the baseline does not pass now, or is gone (removing a scenario
//     is the owner's decision, part 17.9, so a missing one is a failure, never a quiet drop);
//   - a category's score falls below the baseline's by more than eval.score_tolerance;
//   - a category is below its floor in eval.category_floors, whatever the baseline says;
//   - a scenario's tokens rise beyond eval.tokens_tolerance of the baseline's.
// Scenarios the baseline has not seen are noted, not failed: they are new coverage.
// Wall time is recorded but never gated: it varies with the machine.

/**
 * @typedef {Record<string, any>} EvalResult
 * @typedef {{ category_floors: Record<string, number>, score_tolerance: number, tokens_tolerance: number }} Thresholds
 * @typedef {{ kind: string, subject: string, message: string }} GateFailure
 * @typedef {{ ok: boolean, baseline: string | null, failures: GateFailure[], notes: string[] }} GateVerdict
 */

/** @param {{ id: string, profile: string }} s */
const keyOf = (s) => `${s.id}@${s.profile}`;

/**
 * @param {EvalResult} current
 * @param {EvalResult | null} baseline
 * @param {Thresholds} thresholds
 * @param {{ inScope?: (scenarioId: string) => boolean }} [options]
 *   inScope: which baseline scenarios this run was meant to cover, for a partial run
 * @returns {GateVerdict}
 */
export function compareToBaseline(current, baseline, thresholds, options = {}) {
  const inScope = options.inScope ?? (() => true);
  /** @type {GateFailure[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  // Floors hold with or without a baseline.
  for (const [category, floor] of Object.entries(thresholds.category_floors)) {
    const got = current.summary.categories[category];
    if (!got) continue;
    if (got.score < floor) {
      failures.push({
        kind: 'below-floor',
        subject: category,
        message: `${category} scored ${fmt(got.score)}, below its floor ${fmt(floor)}`,
      });
    }
  }

  if (!baseline) {
    notes.push(
      'no baseline for these settings: nothing to compare with; floors and scenario results still apply. A baseline is recorded with --accept-baseline, by the owner.',
    );
    return { ok: failures.length === 0, baseline: null, failures, notes };
  }

  if (baseline.plugin.version !== current.plugin.version) {
    notes.push(`plugin version ${baseline.plugin.version} -> ${current.plugin.version}`);
  }
  if (baseline.policy_hash !== current.policy_hash)
    notes.push('the policy hash differs from the baseline');
  if (baseline.scenario_set.version !== current.scenario_set.version) {
    notes.push(
      `the scenario set changed (${baseline.scenario_set.version} -> ${current.scenario_set.version})`,
    );
  }
  for (const [id, v] of Object.entries(current.schema_versions)) {
    if (baseline.schema_versions[id] !== v) {
      notes.push(`schema ${id}: version ${baseline.schema_versions[id] ?? '(none)'} -> ${v}`);
    }
  }

  const now = new Map(current.scenarios.map((/** @type {any} */ s) => [keyOf(s), s]));
  const before = new Map(baseline.scenarios.map((/** @type {any} */ s) => [keyOf(s), s]));

  for (const [key, was] of before) {
    if (!inScope(was.id)) continue;
    const is = now.get(key);
    if (was.status !== 'pass') continue;
    if (!is) {
      failures.push({
        kind: 'scenario-missing',
        subject: key,
        message: `${key} passed in the baseline and was not run`,
      });
    } else if (is.status === 'not_applicable') {
      failures.push({
        kind: 'scenario-not-run',
        subject: key,
        message: `${key} passed in the baseline and is now not applicable: ${is.reason ?? ''}`,
      });
    } else if (is.status !== 'pass') {
      const failed = (is.graders ?? [])
        .filter((/** @type {any} */ g) => !g.passed)
        .map((/** @type {any} */ g) => g.message);
      failures.push({
        kind: 'scenario-regressed',
        subject: key,
        message: `${key} passed in the baseline and now ${is.status === 'error' ? 'errors' : 'fails'}${is.reason ? `: ${is.reason}` : failed.length ? `: ${failed.join('; ')}` : ''}`,
      });
    } else if (
      was.tokens &&
      is.tokens !== null &&
      is.tokens > was.tokens * (1 + thresholds.tokens_tolerance)
    ) {
      failures.push({
        kind: 'tokens-rose',
        subject: key,
        message: `${key} used ${is.tokens} tokens, up from ${was.tokens} (tolerance ${fmt(thresholds.tokens_tolerance)})`,
      });
    }
  }
  for (const [key, is] of now) {
    if (!before.has(key) && is.status !== 'not_applicable')
      notes.push(`new scenario: ${key} (${is.status})`);
  }

  for (const [category, was] of Object.entries(baseline.summary.categories)) {
    const is = current.summary.categories[category];
    if (!is) continue;
    // Compare only when this run covered the baseline's scenarios in the category; otherwise a
    // partial run would look like a drop.
    if (is.scenarios !== was.scenarios) continue;
    if (was.score - is.score > thresholds.score_tolerance + 1e-12) {
      failures.push({
        kind: 'category-dropped',
        subject: category,
        message: `${category} scored ${fmt(is.score)}, down from ${fmt(was.score)} (tolerance ${fmt(thresholds.score_tolerance)})`,
      });
    }
  }

  return { ok: failures.length === 0, baseline: baseline.id, failures, notes };
}

/** @param {number} n */
const fmt = (n) => String(Math.round(n * 1000) / 1000);
