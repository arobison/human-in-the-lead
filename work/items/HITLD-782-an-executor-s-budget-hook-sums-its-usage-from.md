---
id: HITLD-782
title: An executor's budget hook sums its usage from its turn outputs and stops it near its cap
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

The owner asked whether executors can check their own budget from their turn outputs. The exploration found the model itself has no meter, but a hook running inside the executor can sum usage and tell it to stop: a PostToolUse hook sums usage since the dispatch started and injects 'budget reached: commit, push, report', and a PreToolUse rule refuses everything except the closing steps past the cap. How usage is read (transcript lines, stream events, status line) is not settled: the repository deliberately does not parse transcripts today.

## Done when

- A design, walked through with the owner, picks where an executor reads its own usage from and how it stops near its cap, and states what changes in the transcript policy if transcripts are read.
- A PostToolUse and PreToolUse pair enforces the dispatch's token cap, with a test that an executor past its cap can only run the closing steps.
- `npm run check`, the offline eval gate and `hitld work check` pass.
