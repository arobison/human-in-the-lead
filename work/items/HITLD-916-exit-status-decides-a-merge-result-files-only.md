---
id: HITLD-916
title: Exit status decides a merge; result files only name failing tests
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Exit status decides; result files only name failing tests: Read only after a failing run."
answered_at: 2026-11-22T20:53:47.302Z
answered_via: question-tool
answered_by: owner
---

## Question

May a test-result file decide whether a merge is green (HITLD-883 decision 8 of 12)?

A result file is written by the branch under test and could be forged; SARIF files are read the same way today.

## Options and recommendation

- A. Exit status decides; result files only name failing tests: Read only after a failing run.
- B. A result file may decide pass or fail: Needs a trusted producer first.
- C. Ignore result files: No change.

Recommended: Exit status decides; result files only name failing tests. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
