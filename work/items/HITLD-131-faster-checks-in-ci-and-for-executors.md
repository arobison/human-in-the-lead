---
id: HITLD-131
title: Faster checks, in CI and for executors
kind: work
state: in-progress
created: 2026-11-15
project: HITLD-15
claimed_by: D-11
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
