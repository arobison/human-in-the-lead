---
id: HITLD-74
title: Ledger and dispatch IDs from per-machine blocks, so store sync does not conflict
kind: work
state: planned
created: 2026-11-14
project: HITLD-15
---

## Why

Ledger event IDs (E-n) and dispatch IDs (D-n) are allocated as the next number on each machine. When two machines both append between store syncs (HITLD-60), import stops on a conflict nearly every time. Tracker IDs already avoid this with per-machine reserved blocks (Q2). Changing how these IDs are allocated changes the ledger format, so it was after v0.1.0-rc.1 by the owner's decision, and is now pulled forward (below).

## Done when

- Ledger event and dispatch IDs come from a block reserved per machine, the way tracker IDs do (Q2), and two machines appending between syncs merge without a conflict.
- Existing ledgers keep their IDs; the format change is versioned and `hitld data migrate` (or the store import) handles older files.
- A test syncs two stores that both appended events and dispatches, and the import succeeds with no conflict.
- The two ledgers of the first self-hosted run (the chief of staff's, already pushed to the store, and the orchestrator's, still local) are reconciled with no reuse of dispatch IDs, so a `Dispatch: D-n` trailer already on main keeps meaning one dispatch, and the orchestrator's records reach the store.

## Pulled forward

On 2026-11-16, in the chief of staff session, the owner decided to build this first and reconcile after (HITLD-178). The orchestrator's store pull stopped on a conflict because both containers started a ledger at event E-1 with different content, and adopting the shared store would reuse dispatch numbers D-1 to D-9, which already appear as `Dispatch:` trailers on main. The orchestrator keeps its local store folder backed up as files in its container until this lands.
