---
id: HITLD-5
title: "Ledger and orchestrator continuity: run state, lease, resume (piece b)"
kind: work
state: done
created: 2026-11-14
project: HITLD-2
---

## Why

Kill-and-resume eval passes.

## Done when

- The ledger is append-only, lives in the private store, and carries every field of design 5.4. `hitld ledger inflight` and `summary` run.
- The run-state file is checkpointed at clean points, with the ledger written first. One orchestrator holds the lease at a time.
- `hitld run resume` and `rebuild` restart a run from files, on either machine.
- The kill-and-resume eval passes at every seeded kill point, with no lost and no duplicated dispatch.
