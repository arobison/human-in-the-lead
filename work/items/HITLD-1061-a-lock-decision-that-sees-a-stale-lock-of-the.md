---
id: HITLD-1061
title: A lock decision that sees a stale lock of the other kind removes it, and a renewal checks staleness, so callers with different capacities never hold one resource twice
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1051]
constraint_of: [HITLD-405 c?]
---

## Done when

- `attemptWeighted` removes a stale single lock and `attemptSerial` removes stale weighted records (`core/lib/env/lockcore.mjs`), instead of ignoring them; `renew` refuses a record whose TTL has lapsed and another holder has been granted since; tests cover both.
- The model checker explores a resource asked with two capacities (a profile that changes capacity while a lock is held, or copies run with different profiles), and the half-written lock file on a weighted resource, so the case it found (a half-written file on a weighted resource, a clock that jumps forward and back, live weights 3 of 2) fails before and passes after.
- The model's step list stops leaving out half-written files and release by name on the weighted path.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The independent review of HITLD-1051 found that A takes `gpu` with capacity 1 and lapses (its TTL passes, its process lives), B asks with capacity 2 and weight 2 and is granted over the stale single lock, then A's renew timer renews it: both hold. The model cannot reach it because capacity is fixed per resource, and the model checker later showed a second path through a half-written lock file and a backward clock jump.

## Notes

rc.3. Owner-held (merge-path lock). Follows HITLD-1051; reviewed with HITLD-1052 in mind (ghost tickets and release by token are 1052's).
