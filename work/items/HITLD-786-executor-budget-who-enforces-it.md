---
id: HITLD-786
title: "Executor budget: who enforces it"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A hook inside the executor, with the reconcile pass as backstop: PostToolUse sums usage and at the cap injects 'budget reached: commit, push, report'; PreToolUse refuses everything except the closing steps; the reconcile pass hard-stops an overrun the hook missed."
answered_at: 2026-11-22T03:55:35.352Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-782 question 1: who enforces an executor's token budget?

The model has no meter of its own; a hook inside the executor can read usage and the reconcile pass can read the harness record.

## Options and recommendation

- A. A hook inside the executor, with the reconcile pass as backstop: PostToolUse sums usage and at the cap injects 'budget reached: commit, push, report'; PreToolUse refuses everything except the closing steps; the reconcile pass hard-stops an overrun the hook missed.
- B. Only the reconcile pass enforces it: Coarser; no soft stop.
- C. Only the hook enforces it: Unbounded where hooks do not run.

Recommended: A hook inside the executor, with the reconcile pass as backstop. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
