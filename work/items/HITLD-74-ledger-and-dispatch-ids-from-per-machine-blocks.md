---
id: HITLD-74
title: Ledger and dispatch IDs from per-machine blocks, so store sync does not conflict
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
---

## Why

Ledger event IDs (E-n) and dispatch IDs (D-n) are allocated as the next number on each machine. When two machines both append between store syncs (HITLD-60), import stops on a conflict nearly every time. Tracker IDs already avoid this with per-machine reserved blocks (Q2). Changing how these IDs are allocated changes the ledger format, so it is after v0.1.0-rc.1 by the owner's decision.

## Done when

- Ledger event and dispatch IDs come from a block reserved per machine, the way tracker IDs do (Q2), and two machines appending between syncs merge without a conflict.
- Existing ledgers keep their IDs; the format change is versioned and `hitld data migrate` (or the store import) handles older files.
- A test syncs two stores that both appended events and dispatches, and the import succeeds with no conflict.

