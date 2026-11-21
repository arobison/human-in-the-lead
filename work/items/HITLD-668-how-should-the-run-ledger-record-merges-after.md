---
id: HITLD-668
title: How should the run ledger record merges after the orchestrator handed over?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: A
answered_at: 2026-11-21T05:23:11.202Z
answered_via: question-tool
answered_by: owner
---

## Question

The orchestrator for this run handed over at the 20-completion limit, and its ledger refuses further writes (the lease is released). The ledger exists only in its container, because the store push failed (device not enrolled). Merges since then are on main but not in the ledger. How should merges be recorded until the run's ledger can be stored?

## Options and recommendation

- A. Wait for a successor: Leave merges unrecorded for now. Each squash commit on main carries its Dispatch trailer, so a successor started from the stored ledger can backfill every merge from the commit history. This needs you to approve this machine's store key first.
- B. Let the orchestrator take the lease back: It runs `run resume` and appends the merges itself. This works today, but it overrides the hand-over, which exists because that session reached its limits, and it keeps the ledger in the one container that is not stored.

Recommended: Wait for a successor. The merge history is recoverable from the trailers, so nothing is lost; the risk is that the ledger lags until the store key is approved. [Likely]

## Answer

Open.
