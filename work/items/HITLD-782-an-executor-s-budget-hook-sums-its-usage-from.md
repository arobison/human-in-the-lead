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

## Decided on 2026-11-22 (owner)

Budget enforcement is a hook inside the executor with the reconcile pass (HITLD-780) as the hard backstop. The hook may read token counts from the executor's transcript file, counts only and never content: a narrow written exception to the rule that transcripts are never parsed.

## Done when

- A PostToolUse hook sums the executor's usage since its dispatch started from the transcript's per-message usage and, at the dispatch's cap, injects 'budget reached: commit, push, report'; a PreToolUse rule then refuses every tool call except the closing steps (commit, push, `hitld work close`, the report).
- The hook reads only the usage numbers: a test shows a marker string in the transcript never appears in the hook's output, the ledger or any log.
- The reconcile pass (HITLD-780) reads the harness's usage record and runs `hitld dispatch stop` on an overrun the hook missed.
- The design text records the transcript exception. A hook or guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
