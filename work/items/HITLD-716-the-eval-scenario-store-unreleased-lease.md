---
id: HITLD-716
title: The eval scenario store/unreleased-lease-refused is diagnosed from a failed CI run's transcript
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

CI's `tests` job failed once, on a docs-only pull request, in the eval test "the shipped scenarios all load and every one passes": the scenario `store/unreleased-lease-refused` failed its grader `released-lease-taken-without-force` with "steps.cloud_resume_after.result.took_over.reason was not produced by any step". It passed on the one allowed re-run in CI and on four runs in a row locally, so it is intermittent and the diff could not have caused it. HITLD-201 showed it is not the shared-store cause that item fixed: the scenario uses only `store.*` actions, which give each device its own home inside the case's sandbox. The cause is not known and cannot be found without the failed run's transcript.

## Done when

- The scenario's transcript from a failed CI run (the eval step's output, step by step, from the CI log or the eval result file) is quoted in this item. If the failure does not recur, this item stays open and the next failure's transcript is added.
- The cause is found and written here, and a test reproduces it first (design 14.7).
- The fix makes that test pass without weakening a grader, and `store/unreleased-lease-refused` runs 20 times in a row in CI-like conditions without a failure.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Proposed until a transcript exists. Not a reason to skip or quarantine the scenario. Related: HITLD-201 (done, PR 406), HITLD-572 (the pull request where it was seen), HITLD-290 (a flake fix proves itself).
