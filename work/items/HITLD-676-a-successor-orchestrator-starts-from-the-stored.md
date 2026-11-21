---
id: HITLD-676
title: A successor orchestrator starts from the stored ledger and backfills the first run's starts and merges
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-74]
---

## Why

The first self-hosted run's ledger exists only in the handed-over orchestrator's container. A pull of the store stops on a conflict: that ledger and the store's ledger both hold an event E-1 with different content. The owner chose to keep the store's ledger and backfill (decision HITLD-675), not to hand-edit either file.

## Done when

- A successor orchestrator is started in a session that has both the project repository and the private store repository attached (the owner approves the attach in that session, HITLD-674), and its store check passes before it does any work.
- It records, as new events, every start and merge of the first run: the dispatches D-39 to D-59 and their merges, taken from the previous orchestrator's handover note and the Dispatch trailers on main. Each is marked as backfilled from those sources, not from the original ledger.
- A check shows every merged dispatch on main since the run began has a merge event in the stored ledger, and `hitld work check` and the ledger consistency check pass.
- The previous orchestrator's container ledger is kept as a record until the owner says it can go, and nothing is pushed from it.
