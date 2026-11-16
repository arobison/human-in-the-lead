---
id: HITLD-185
title: CI installs the age program so its interoperability tests run, and the job reports which tests it skipped
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-131]
---

## Why

GitHub's `check` job printed `# skipped 3` while the tests ran with none skipped in an executor's container. The tests skip when the `age` encryption program is not installed: two interoperability tests in `core/test/age.test.mjs` and one in `core/test/store-sync.test.mjs` ("a file this code writes opens with the age program", and its mirror). The CI workflow installs Node and nothing else (`.github/workflows/ci.yml` uses only `setup-node`), so CI never checks that the store's encrypted files interoperate with the real program, and nothing in the job says so. A failed encryption interoperability would reach main unseen. The skip count was noticed by the orchestrator, not by CI.

## Done when

- The CI `check` job installs the `age` program (from the runner's package manager or a pinned release), so the interoperability tests run there.
- The job summary lists the tests that were skipped and why, and the job fails when a test skips that is not on a short allowlist in the repository (for example a Windows-only test), so a skip that was not expected is noticed.
- The test files say which skips are expected on which platform.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found in the first self-hosted run and raised under the owner's instruction that problems the chief of staff meets are checked against the tracker and filed (HITLD-181). The three skipped tests are inferred from the test files' skip conditions, not read from a CI log: the first step is to confirm them. It changes a workflow, a sensitive path, so the report says which checks a pull request now runs. Related: HITLD-131 (faster checks), which changes the same workflow.

