---
id: HITLD-131
title: Faster checks, in CI and for executors
kind: work
state: done
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-11
release_note: "CI runs typecheck, format, tests, evals and tracker as parallel jobs behind an aggregate `check`, work-only pull requests skip the code checks, and `npm run check:fast` gives a quick local check."
---

## Why

Every executor runs `npm run check` several times per item, and CI runs it on every pull request. Locally the tests take over a minute and Prettier about half a minute, two thirds of which is spent checking the generated plugin copy, which a test already compares with its sources. In CI the longest check is CodeQL's analysis, which also runs on pull requests that change only tracker files or docs.

## Done when

- Prettier skips `plugins/human-in-the-lead/` (the build test already proves it is an exact copy of formatted sources), and the local format check uses Prettier's cache.
- The slowest test files are profiled; waits on the wall clock are replaced with an injected clock where possible, and the test run reports its slowest files.
- CI's `check` job is split into parallel jobs (typecheck, format, tests, offline evals), each failing on its own.
- CodeQL runs on every pull request that changes code or workflows and on every push to main, and is skipped for pull requests that change only `work/`, `docs/` or other text; the orchestrate skill's wait for checks expects that.
- A pull request that changes only `work/` runs `dco`, `public` and `hitld work check`, and its `check` jobs skip the typecheck, format check, tests and evals but still report success, so required checks never wait on a job that did not run (a path filter on the workflow would leave them waiting). The owner's decision from the main session.
- **Tests never read or write the real home directory:** every test and eval action runs with an isolated home and environment (a shared helper), so a person or machine file on the machine cannot change results, and a test fails if one reaches the real home.
- `npm run check:fast` (typecheck, the format check on changed files, and the tests of the areas a branch touches) is what executors run while they work; the full `npm run check` stays the gate before a report.
- The time of `npm run check` locally and of CI on a pull request is measured before and after and recorded in the item's notes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Measured in a 4-core cloud container with CI's settings (`CI=true`, `GITHUB_ACTIONS=true`, no global or system git config, no `HITLD_*` variables), on main before and on this branch after (D-11):

| | before | after |
| --- | --- | --- |
| `npm run typecheck` | 1.1 s | 1.1 s |
| `npm run format:check` | 9.4 s | 6.7 s without a cache, 1.2 s with one |
| `npm test` | 57.4 s | 52–55 s |
| `npm run check` | about 68 s | 54.6 s (cache cold) |
| `npm run check:fast`, one changed module in `core/lib/merge/` | (none) | 23.8 s, 13 test files |
| `hitld eval --offline --require-baseline` | 24.2 s | 21.7 s |

The slowest test files (top-level tests added up) were `eval.test.mjs` 25.7 s, `eval-baselines.test.mjs` 16.3 s, `store-devices.test.mjs` 12.8 s, `merge-owner.test.mjs` 11.5 s and `store-push-pull.test.mjs` 9.9 s. `eval-baselines.test.mjs` waited for the next second before each run, since a run's ID starts with its second; it now steps an injected clock (`hitld eval` passes the CLI's `now` on), 16.3 s to 1.4 s. The lock-expiry test in `env.test.mjs` slept 1.2 s; it mocks `Date` instead. What is left is work, not waiting: `eval.test.mjs` runs every shipped scenario (24 s, the same run as CI's eval job), and the store, merge and run tests spend their time in git and in combinatorial kill-and-resume loops. The suite is bound by its 3 test workers: `--test-concurrency=6` ran it in 40 s here, not adopted, since timing tests may flake on CI's runners.

CI before, from the pull requests of 2026-11-16 (#110 tracker only, #104 code): the `check` job took 110 s and 70 s (`npm run check` 78 s and evals 21 s of #110's), CodeQL's analysis 60–68 s beside it. After, estimated from the same steps until a pull request runs the new workflows: a code pull request waits on the `tests` job (setup and `npm ci` about 8 s, tests about 55 s), the other jobs running beside it; a `work/`-only one on jobs that only check out and classify the diff (about 10 s each) and on `dco`, `public` and the tracker check.
