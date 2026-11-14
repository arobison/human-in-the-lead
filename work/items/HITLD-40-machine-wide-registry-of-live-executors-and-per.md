---
id: HITLD-40
title: Machine-wide registry of live executors and per-account usage, with the merge queue lock per repository
kind: work
status: In progress
created: 2026-11-14
project: HITLD-15
milestone: settings-hold
needs: [HITLD-37]
claimed: D-40
---

## Why

Per design 13.4: two repositories on one machine must together stay within the person's and the machine's caps and see the same account usage. Today the cap and usage snapshots are per project, and the `merge-queue` lock is machine-wide, so two repositories serialize each other's merges.

## Done when

- Live executors from every project are recorded in the machine registry; dispatch counts them against the person's and the machine's caps.
- Usage snapshots are stored per account in the machine registry and read by every project's quota gate.
- Shares between projects from the person file decide headroom near the reserve.
- The merge queue lock is scoped to the repository; two fixture repositories merge without waiting on each other.
