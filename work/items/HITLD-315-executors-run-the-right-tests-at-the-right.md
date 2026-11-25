---
id: HITLD-315
title: "Executors run the right tests at the right times: a test cadence that stops wasting wall clock, and a learning loop that tunes which tests and how often"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-189 c1]
---

## Why

Raised by the owner in the chief of staff session: make sure the part of the design that manages how often executors run tests, and which tests they run, is built, so wall clock time is not wasted. They expect a learning loop here too.

What exists today: CI runs its checks as parallel jobs behind one aggregate check, and `npm run check:fast` gives a quick local check (HITLD-131, done). The design's merge queue (part 5) fast-checks each branch and runs the full suite once per batch. As the chief of staff reads the design, nothing names an executor's own test cadence: how often it runs tests while working, which tests it runs for a given diff, and when it must run the full suite. That reading is not verified against every part of the design; the first step of this item is to check.

The cost is real. In this run the full CI-like check takes minutes, and executors run it several times per change. The Windows pull request's tests took hundreds of seconds per file.

## Done when

- The design says, in the part on execution or verification, who decides how often an executor runs tests and which ones: a policy (for example `execution.test_cadence`) with a default an owner can tune, covering: the fast check while working, tests selected by what the diff touches, and the full suite only before the report and once per merge batch.
- The brief tells the executor the cadence for its item, and the executor reports which tests it ran and how long they took (wall clock), so the evidence is the executor's own measure and not a guess.
- A learning loop (design part 18, the self-improvement loop, and part 11, metrics): the system records, per area and per executor tier, the wall clock spent on tests, how often a full-suite run caught something a fast check missed, and flaky or slow tests, and proposes cadence changes through the normal rule-change path; it never changes the cadence itself.
- Evals cover: a diff in one area runs only that area's fast checks; a cadence rule that is exceeded is reported; a proposal appears after enough runs show the full suite never catches what the fast check missed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner's motivating example, in their words: "making these UX tweaks should be fast". In this run, small changes to the dashboard page (the milestone board, PR #196) each went through the full CI-like `npm run check` (over 1,300 tests) before every push, though they touch only the dashboard rendering and its tests. The cadence should run that area's tests and the fast check while working, and the full suite once before the report, with the wall clock spent shown in the report.

Related: HITLD-131 (faster checks, done), HITLD-20 (flaky tests: defaults, quarantine), HITLD-284 (a failed fast check's output is dropped), HITLD-136 (briefs name overlapping work), HITLD-81 (calibrated estimates). Design choices are the owner's: the first step is a walk-through, one question at a time.

GitHub issue 681 (2026-11-25) asks that integration tests at the merge gate be chosen by what the batch changes. Narrowing the merge gate is a guard change and the owner's to approve; the learning loop here is the way to earn it: record how often a full integration run caught something outside the touched areas, and propose narrowing only when it never does. Nothing narrows before that.
