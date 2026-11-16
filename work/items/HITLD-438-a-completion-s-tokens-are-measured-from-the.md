---
id: HITLD-438
title: A completion's tokens are measured from the harness's own record, and an executor's own figure is kept apart as a guess
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
needs: [HITLD-436]
claimed_by: D-35
---

## Done when




- For an interactive dispatch, `dispatch complete` reads the dispatch's tokens and cost from the record the harness keeps of the executor's session (input, output and cache tokens kept apart, and the cost the harness reports), not from a figure the orchestrator types. For a headless dispatch it reads the result file, with cache reads counted apart. The ledger records the figure's source (measured from the harness record, or typed by hand) beside the tokens.
- What the executor says its own cost was ("about 270k tokens") is stored in the report as a self-reported guess, never as the recorded cost, and the digest and the estimator never use it as one.
- A figure typed by hand is still allowed when the harness record is unavailable, and the ledger says so; the planner and the estimator weigh a measured figure over a typed one.
- Tests cover an interactive completion, a headless completion with large cache reads, a typed figure, and an executor's self-reported guess that disagrees with the measurement. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-16 the orchestrator recorded the wrong cost for a blocked headless run because it typed the run's input and cache-read total by hand (HITLD-436), and the executors' reports state costs such as "about 270k tokens" that are their own estimates. The owner asked whether the system records actual tokens against the estimate so it can learn; it records a figure per completion, but what it records is whatever the orchestrator passes, so the learning would rest on unmeasured numbers. The owner asked for follow-up tickets that come before the rest of the work once HITLD-436 is fixed (decision HITLD-440).

## Notes

Needs HITLD-436 (the correction command, the `--tokens` rule and the per-completion estimate). Related: HITLD-81 (agent-shaped estimates), HITLD-139 (token accounting), HITLD-298 (`estimate_tokens` on). Placed under HITLD-408 c1. Code: needs the owner's own yes to merge.
