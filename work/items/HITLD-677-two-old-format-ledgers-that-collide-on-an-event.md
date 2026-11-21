---
id: HITLD-677
title: Two old-format ledgers that collide on an event ID can be reconciled
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-74]
---

## Why

Two machines that each started an old-format ledger independently both hold an event E-1 with different content. A store pull between them stops with a conflict on the ledger file and merges nothing. Pull request 393 (unique IDs, one ledger file per writer) does not change that: its reader only applies after both files are in the store, and its own notes say old ledgers are not reconciled with the new files. An experiment on the first run's clash (2026-11-21) confirmed this on both the main branch and the 393 code. It also found that moving one side's events into a per-writer file merges cleanly, but only if each event gets a new unique ID; keeping the old IDs drops the clashing event from the union.

## Done when

- A command, or the store pull itself, reconciles two old-format ledgers that collide on an event ID: it keeps one side's file, moves the other side's events into that writer's file under new unique IDs, records the old-to-new mapping, and leaves nothing lost.
- References to a renumbered event (corrections, run state, trailers that cite it) are rewritten or resolved through the mapping, with a test for each.
- The pull reports a clear error naming this command instead of only "conflict".
- Tests cover the clash found in the first run (same event ID, different content, both sides pushed once). `npm run check`, the offline eval gate and `hitld work check` pass.
