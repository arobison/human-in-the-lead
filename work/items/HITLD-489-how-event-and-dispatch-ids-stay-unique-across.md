---
id: HITLD-489
title: How event and dispatch IDs stay unique across all containers (replaces HITLD-485)
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. Unique by construction: Time-ordered random IDs, one append-only file per writer, the global ledger as the union read through the local index, display numbers at ingest; no coordination."
answered_at: 2026-11-18T05:40:31.261Z
answered_via: question-tool
answered_by: owner
---

## Question

How should event and dispatch IDs stay unique across all containers?

The owner said per-machine blocks will fail, and orchestrator-numbered IDs (HITLD-485) depend on a disposable chief of staff session. The ledger is meant to be global for learning.

## Options and recommendation

- A. Unique by construction: Time-ordered random IDs, one append-only file per writer, the global ledger as the union read through the local index, display numbers at ingest; no coordination.
- B. A central counter in the store: Friendly sequential numbers from one compare-and-swap counter; needs the store reachable at every dispatch.
- C. Keep orchestrator-numbered IDs: Depends on the chief of staff numbering each orchestrator.
- D. Tell me more first: Trade-offs first.

Recommended: Unique by construction. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
