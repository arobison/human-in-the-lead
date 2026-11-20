// Eval scenarios do not share a private store, and an earlier run cannot make a scenario flaky
// (HITLD-201). The `cli` action calls main with an empty environment, so a scenario's private store
// is the default one under the home: $HOME/.local/share/human-in-the-lead/<fixture project id>.
// Before each case had a home of its own (HITLD-131), that was the account's home, shared by every
// scenario on the fixture's project ID and by every run, and a run in another process could file a
// question under the same ID between a scenario's ask and its answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture } from '../lib/eval/fixtures.mjs';
import { PLUGIN_EVALS, evalOffline } from '../lib/eval/offline.mjs';
import { runCase } from '../lib/eval/runner.mjs';
import { discoverScenarios, loadActions } from '../lib/eval/scenario.mjs';
import { NO_PROFILE } from '../lib/eval/profiles.mjs';
import { tempDir } from './helpers/tmp.mjs';

const RELAYED = 'rights/relayed-answer-is-not-recorded';

/**
 * The scenario the executor of HITLD-135 saw fail, with another run of the same fixture woven into
 * it after its ask, as a run in another process could be: the other run files a different question
 * under the same ID, FX-2, and shows it. The other run keeps its store in the account's home, as a
 * run without a home of its own does (`home: "account"`), or in the case's own home, as a store
 * shared with it would be (`home: "case"`).
 * @param {'account' | 'case'} home
 */
async function interleaved(home) {
  const actions = await loadActions();
  const loaded = discoverScenarios(PLUGIN_EVALS, actions).find((l) => l.id === RELAYED);
  assert.ok(loaded?.scenario, `${RELAYED} loads`);
  const scenario = structuredClone(loaded.scenario);
  const at = scenario.steps.findIndex((/** @type {any} */ s) => s.id === 'ask');
  const otherAsk = structuredClone(scenario.steps[at]);
  const q = otherAsk.with.argv.indexOf('--question') + 1;
  otherAsk.with.argv[q] = otherAsk.with.argv[q]
    .replace('Add left-pad as a dependency?', 'Vendor left-pad?')
    .replace('May we add left-pad', 'Shall we vendor left-pad');
  const steps = [
    scenario.steps[0],
    otherAsk,
    { action: 'cli', with: { argv: ['rights', 'show', 'FX-2'] } },
  ];
  scenario.steps.splice(at + 1, 0, { id: 'other-run', action: 'test.other-run', with: {} });

  const account = /** @type {string} */ (process.env.HOME);
  /** @type {string[]} */
  const caseHomes = [];
  const other = {
    description: 'Another run of the same fixture, in a sandbox of its own.',
    input: { type: 'object' },
    run: async (/** @type {unknown} */ _with, /** @type {any} */ ctx) => {
      caseHomes.push(/** @type {string} */ (process.env.HOME));
      const sandbox = tempDir('hitld-eval-other-run-');
      buildFixture(sandbox, scenario.fixture, { seed: ctx.seed, evalsDir: loaded.evalsDir });
      const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      if (home === 'account') process.env.HOME = process.env.USERPROFILE = account;
      try {
        /** @type {any[]} */
        const out = [];
        for (const s of steps) out.push(await actions[s.action].run(s.with, { ...ctx, sandbox }));
        return { asked: out[1].result.decision, shown: out[2].exit };
      } finally {
        process.env.HOME = saved.HOME;
        process.env.USERPROFILE = saved.USERPROFILE;
      }
    },
  };
  const result = await runCase({ ...loaded, scenario }, NO_PROFILE, {
    seed: 1,
    actions: { ...actions, 'test.other-run': /** @type {any} */ (other) },
  });
  const entry = /** @type {any[]} */ (result.transcript).find((e) => e.step === 'other-run');
  return { result, other: entry?.result, caseHome: caseHomes[0], account };
}

test('a question another run files under the same ID reaches a scenario only through a shared home', async () => {
  // Shared: the failure the executor of HITLD-135 saw. The answer is refused because the question
  // last shown under FX-2 is the other run's.
  const shared = await interleaved('case');
  assert.deepEqual(shared.other, { asked: 'FX-2', shown: 0 });
  assert.equal(shared.result.result, 'fail');
  const refused = shared.result.graders.find((g) => g.id === 'relayed-words-refused');
  assert.match(String(refused?.message), /answer-question-changed/);

  // The other run in the account's home, as a run without a home of its own (or one in another
  // process) keeps its store: the case's own home holds the scenario's store, so it passes.
  const apart = await interleaved('account');
  assert.deepEqual(apart.other, { asked: 'FX-2', shown: 0 });
  assert.equal(apart.result.result, 'pass', JSON.stringify(apart.result.graders));
  assert.notEqual(apart.caseHome, apart.account);
  // The other run's question is in the account's home, where the case did not look.
  const accountStore = join(apart.account, '.local', 'share', 'human-in-the-lead', 'fixture-repo');
  assert.ok(existsSync(join(accountStore, 'rights', 'asked', 'FX-2.json')));
  rmSync(accountStore, { recursive: true, force: true });
  // The case's home, and the store in it, are gone when the case ends.
  assert.equal(existsSync(apart.caseHome), false);
});

/**
 * Every path under a directory, for comparing what is there before and after.
 * @param {string} dir @returns {string[]}
 */
const listing = (dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : [];

test('the offline eval gate run twice in a row: the second run reads nothing the first left', async () => {
  const cwd = tempDir('hitld-eval-twice-');
  const env = { XDG_DATA_HOME: tempDir('hitld-eval-twice-data-') };
  // Every sandbox and case home goes in a temporary directory of this test's own, so what a run
  // leaves there can be seen.
  const tmp = tempDir('hitld-eval-twice-tmp-');
  const home = /** @type {string} */ (process.env.HOME);
  const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  const homeBefore = listing(home);
  /** @type {any[]} */
  const runs = [];
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = tmp;
  try {
    for (let i = 0; i < 2; i++) {
      const run = /** @type {any} */ (await evalOffline({ cwd, env }));
      // Nothing of the run is left where a later run's scenarios look: no sandbox, no case home
      // (with its private store) in the temporary directory, and nothing in the home.
      assert.deepEqual(readdirSync(tmp), [], `run ${i + 1} left files in the temporary directory`);
      assert.deepEqual(listing(home), homeBefore, `run ${i + 1} wrote to the home`);
      runs.push(run);
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  for (const run of runs) {
    assert.deepEqual(run.problems, []);
    assert.equal(run.summary.failed + run.summary.errors, 0);
  }
  // The same verdict for every case, and the same baseline: the results the first run recorded
  // are not one the second compares against.
  /** @param {any} run */
  const verdicts = (run) =>
    JSON.parse(readFileSync(run.stored, 'utf8')).scenarios.map((/** @type {any} */ c) => ({
      id: c.id,
      profile: c.profile,
      result: c.result,
      graders: c.graders.map((/** @type {any} */ g) => [g.id, g.passed]),
    }));
  assert.deepEqual(verdicts(runs[1]), verdicts(runs[0]));
  assert.equal(runs[1].gate.baseline_source, runs[0].gate.baseline_source);
  assert.notEqual(runs[1].run, runs[0].run);
});
