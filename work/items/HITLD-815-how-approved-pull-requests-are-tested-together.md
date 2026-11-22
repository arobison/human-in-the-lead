---
id: HITLD-815
title: How approved pull requests are tested together in a batch (HITLD-814)
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. hitld builds a batch branch: hitld merges the approved branches into one batch branch, runs the named checks once and lands the branches from it."
answered_at: 2026-11-22T06:22:43.799Z
answered_via: question-tool
answered_by: owner
---

## Question

How should approved pull requests be tested together so one merge does not restart every other branch's checks?

Pull-request mode checks and updates one branch at a time; the local queue already batches (merge.batch_max).

## Options and recommendation

- A. hitld builds a batch branch: hitld merges the approved branches into one batch branch, runs the named checks once and lands the branches from it.
- B. Use GitHub's own merge queue: Enable the GitHub queue and merge groups; GitHub writes the squash commit.
- C. Skip the rerun when main moved elsewhere: No recheck when main moved only in files the branch does not touch.
- D. No batching, keep it serial: As today.

Recommended: hitld builds a batch branch. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
