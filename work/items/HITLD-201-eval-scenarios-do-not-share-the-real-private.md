---
id: HITLD-201
title: Eval scenarios do not share the real private store, and an earlier run cannot make a scenario flaky
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-54
---

## Why

The `cli` eval action calls main with an empty environment (`core/lib/eval/actions/builtin.mjs` line 96), so a scenario's private store is `~/.local/share/human-in-the-lead/<fixture project id>`, shared across scenarios and across runs. Scenarios on the default `fixture-repo` ID interfere with each other. The executor of HITLD-135 saw `rights/relayed-answer-is-not-recorded` fail with `answer-question-changed` after an earlier run left a "shown" record for FX-2 with another check code; it then passed on later runs, so the eval gate is flaky. Reproduce: run a scenario under `fixture-repo` that records or shows FX-2 with other text, then `node core/bin/hitld.mjs eval --offline --scenarios rights/relayed` with `HITLD_*` unset.

The merged HITLD-131 added an isolated home for each eval case, which may already fix this. That is unverified.

## Done when

- A test or eval run shows, with the isolated home of HITLD-131, whether the case above still fails; the result is recorded in this item.
- If it still fails, each eval case gets its own store directory, removed at the end of the run, and a scenario cannot read what an earlier run wrote.
- A test runs the offline eval gate twice in a row and checks that the second run reads nothing from the first.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the executor of HITLD-135 (dispatch D-12) and relayed by orch-1; filed under HITLD-181.

## Sighting on 2026-11-20 (pull request for the design-docs update, HITLD-572)

CI's tests job failed once on a docs-only pull request: the eval test "the shipped scenarios all load and every one passes" reported the scenario `store/unreleased-lease-refused` failing its grader `released-lease-taken-without-force` with "steps.cloud_resume_after.result.took_over.reason was not produced by any step". The same test passed four times in a row locally and passed on the one allowed re-run in CI, so the failure is intermittent and the diff (docs only) cannot have caused it. The cause is not verified. It may be this item's cause (a store shared by scenarios or by tests running in parallel, so one run's lease state reaches another), which this item's first done-when line checks; if the isolated eval home of HITLD-131 does not explain it, file a separate item with the scenario's transcript.

## Result (2026-11-20, dispatch D-54)

The isolated home of HITLD-131 fixes this; no change to the runner was needed. Each eval case already runs with a home of its own (`core/lib/eval/runner.mjs`, made with `mkdtemp` and removed when the case ends), and the `cli` action's empty environment leaves the private store under that home, so a scenario's store is the case's own and is gone when the case ends.

`core/test/eval-isolation.test.mjs` shows it:

- **The case above.** The test runs `rights/relayed-answer-is-not-recorded` with another run of the same fixture slipped in after its ask. That run files a different question under FX-2 and shows it. When the other run's store is the case's own (a shared store), the scenario fails as the executor of HITLD-135 saw: `relayed-words` gets `answer-question-changed`. When the other run keeps its store in the account's home, as a run without a home of its own does, the scenario passes. The account's home then holds the other run's FX-2, and the case's home is gone afterward.
- **Two runs in a row.** The test runs the offline eval gate twice over a fixed set of four scenarios, the owner's choice on pull request #406 in place of the whole gate. The set is the three `rights/*` scenarios, which reach the private store through the `cli` action under the fixture's project ID, each with decision FX-2, plus `store/unreleased-lease-refused` from the HITLD-572 sighting. The temporary directory points at a directory of the test's own. After each run, nothing is left in it (no sandbox, no case home) and nothing is written to the home. The second run gives every case the same verdict, against the same baseline. The test takes about 2.6 seconds; over the whole gate it took about 39.
- **The test catches the bug.** With the per-case home turned off in the runner, both tests fail. The first fails with `answer-question-changed`, the second with "run 1 wrote to the home".

The steps in "Why", run in that order, do not fail on the current code even with a shared store: an ask records the question as shown, so the later ask's check code is the last one shown. The failure needs the other run's ask to come between the scenario's ask and its answer. Two test files running the shipped scenarios in parallel, both on the account's home before HITLD-131, can produce that order, which fits a failure that came and went.

So the second done-when line (a store directory for each case) does not apply: each case already has one, and it is removed when the case ends.

**The lease sighting (HITLD-572) is not explained by this item's cause.** [Likely] `store/unreleased-lease-refused` uses only `store.*` actions. They give each device its own `HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME` inside the case's sandbox, so no store is shared with other scenarios or runs, before or after HITLD-131. It needs a separate item with the scenario's transcript from the failed CI run, which this dispatch does not have.
