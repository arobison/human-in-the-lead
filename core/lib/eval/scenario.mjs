// Finding and loading scenarios (design part 17.5): evals/scenarios/<piece>/<name>.scenario.json
// in each evals directory. A scenario file that does not load is reported, never skipped, so a
// broken scenario cannot quietly stop gating.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { schemas } from '../schema/registry.mjs';
import { checkSchema, formatErrors, validate } from '../schema/validate.mjs';
import { canonicalJson } from '../policy/policy.mjs';
import { GENERATORS } from './fixtures.mjs';
import { GRADERS } from './graders.mjs';
import { PROFILES, checkRequires } from './profiles.mjs';

/**
 * @typedef {import('./actions/builtin.mjs').Action} Action
 *
 * @typedef {object} LoadedScenario
 * @property {string} id <piece>/<name>, from the file's path
 * @property {string} piece
 * @property {string} file the path of the file
 * @property {string} evalsDir the evals directory it came from
 * @property {Record<string, any> | null} scenario the parsed scenario, when it is valid
 * @property {string[]} problems what is wrong with it; empty when it is valid
 */

export const SCENARIO_SUFFIX = '.scenario.json';

const ACTIONS_DIR = new URL('./actions/', import.meta.url);

/** @type {Promise<Record<string, Action>> | undefined} */
let actionsPromise;

/**
 * Every action: the files in core/lib/eval/actions/ each export `actions`. A name may be defined
 * once.
 * @returns {Promise<Record<string, Action>>}
 */
export function loadActions() {
  actionsPromise ??= (async () => {
    /** @type {Record<string, Action>} */
    const all = {};
    const dir = ACTIONS_DIR.pathname;
    for (const f of readdirSync(dir)
      .filter((n) => n.endsWith('.mjs'))
      .sort()) {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      for (const [name, action] of Object.entries(
        /** @type {Record<string, Action>} */ (mod.actions ?? {}),
      )) {
        if (all[name]) throw new Error(`eval action "${name}" is defined twice (second in ${f})`);
        const problems = checkSchema(action.input, `action ${name} input`);
        if (problems.length) throw new Error(problems.join('\n'));
        all[name] = action;
      }
    }
    return all;
  })();
  return actionsPromise;
}

/**
 * Check a `with` against the input schema of its action or grader.
 * @param {Record<string, any>} inputSchema @param {unknown} data @param {string} where
 * @returns {string[]}
 */
function checkWith(inputSchema, data, where) {
  const errors = validate(inputSchema, data ?? {});
  return errors.length ? [`${where}: ${formatErrors(errors)}`] : [];
}

/**
 * Everything wrong with a parsed scenario beyond its schema: the id against its path, actions and
 * graders that exist, their `with`, the harness profiles and capabilities, the fixture generator.
 * @param {Record<string, any>} scenario @param {string} id @param {string} piece
 * @param {Record<string, Action>} actions
 * @returns {string[]}
 */
export function checkScenario(scenario, id, piece, actions) {
  /** @type {string[]} */
  const problems = [];
  const errors = schemas().validateEntity('eval-scenario', scenario);
  if (errors.length) return [formatErrors(errors)];
  if (scenario.id !== id) problems.push(`id is "${scenario.id}", but the file's path says "${id}"`);
  if (scenario.piece !== piece)
    problems.push(`piece is "${scenario.piece}", but the directory is "${piece}"`);
  const stepIds = new Set();
  for (const step of scenario.steps) {
    if (stepIds.has(step.id)) problems.push(`step id "${step.id}" is used twice`);
    stepIds.add(step.id);
    const action = actions[step.action];
    if (!action) {
      problems.push(
        `step ${step.id}: unknown action "${step.action}" (known: ${Object.keys(actions).join(', ')})`,
      );
    } else {
      problems.push(...checkWith(action.input, step.with, `step ${step.id}`));
    }
  }
  scenario.graders.forEach((/** @type {Record<string, any>} */ g, /** @type {number} */ i) => {
    const grader = GRADERS[g.grader];
    if (!grader) {
      problems.push(
        `grader ${i + 1}: unknown grader "${g.grader}" (known: ${Object.keys(GRADERS).join(', ')})`,
      );
    } else {
      problems.push(...checkWith(grader.input, g.with, `grader ${g.id ?? i + 1} (${g.grader})`));
    }
  });
  if (scenario.harness) {
    for (const p of scenario.harness.profiles) {
      if (p !== '*' && !PROFILES[p]) {
        problems.push(
          `harness.profiles: unknown profile "${p}" (known: ${Object.keys(PROFILES).join(', ')}, or "*")`,
        );
      }
    }
    problems.push(...checkRequires(scenario.harness.requires ?? {}));
  }
  if (scenario.fixture && !Object.hasOwn(GENERATORS, scenario.fixture.generator)) {
    problems.push(
      `fixture.generator: unknown generator "${scenario.fixture.generator}" (known: ${Object.keys(GENERATORS).join(', ')})`,
    );
  }
  const usesAdapter = scenario.steps.some((/** @type {{ action: string }} */ s) =>
    s.action.startsWith('adapter.'),
  );
  if (usesAdapter && !scenario.harness) {
    problems.push(
      'steps use the adapter, so the scenario must declare a `harness` with its profiles',
    );
  }
  return problems;
}

/**
 * Find and load every scenario under an evals directory.
 * @param {string} evalsDir
 * @param {Record<string, Action>} actions
 * @returns {LoadedScenario[]}
 */
export function discoverScenarios(evalsDir, actions) {
  const root = join(evalsDir, 'scenarios');
  if (!existsSync(root)) return [];
  /** @type {LoadedScenario[]} */
  const found = [];
  for (const piece of readdirSync(root).sort()) {
    const dir = join(root, piece);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(SCENARIO_SUFFIX)) continue;
      const file = join(dir, f);
      const id = `${piece}/${basename(f, SCENARIO_SUFFIX)}`;
      /** @type {Record<string, any> | null} */
      let scenario = null;
      /** @type {string[]} */
      let problems = [];
      try {
        scenario = JSON.parse(readFileSync(file, 'utf8'));
        problems = checkScenario(/** @type {Record<string, any>} */ (scenario), id, piece, actions);
        if (problems.length) scenario = null;
      } catch (e) {
        problems = [`cannot be read: ${e instanceof Error ? e.message : String(e)}`];
      }
      found.push({ id, piece, file, evalsDir, scenario, problems });
    }
  }
  return found;
}

/**
 * A version for a set of scenarios: a hash of their content, so it changes when a scenario, a
 * grader setting or a label does.
 * @param {LoadedScenario[]} loaded @returns {string} twelve hex digits
 */
export function scenarioSetVersion(loaded) {
  const h = createHash('sha256');
  for (const l of [...loaded].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    h.update(
      `${l.id}\n${l.scenario ? canonicalJson(l.scenario) : `invalid:${l.problems.join('|')}`}\n`,
    );
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * Whether a scenario matches a filter: comma-separated terms, each an ID or the start of one (a piece, "piece/", "piece/na").
 * @param {string} id @param {string | null | undefined} filter
 */
export function matchesFilter(id, filter) {
  if (!filter) return true;
  return filter
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .some((t) => id.startsWith(t));
}
