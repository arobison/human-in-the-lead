---
id: HITLD-1012
title: The claims check tells a claim held by a live executor started by hand from an abandoned one
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld work claims` and the claims health note do not list a claim as stray when a live executor holds it, including an executor the orchestrator started outside `dispatch start`; the orchestrator records such an executor as live (a ledger event or a heartbeat), and a test covers a by-hand executor with a claim, a stale claim with no executor, and a superseded claim (HITLD-980).
- The note names why each claim is listed (no dispatch, no live executor, superseded by main).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 605 (v0.1.0-rc.1): the claims health note listed five claims with no dispatch in flight. Four had a live executor that the orchestrator had started by hand because `dispatch start` was refused, so the ledger held no dispatch for them. The fifth was a partial merge already on main. Only one claim was really stale, but the note read as five problems.

## Notes

rc.3. Related: HITLD-980 (claims that main has superseded) covers the fifth case. HITLD-1006 and 1003 are reasons an orchestrator may start executors by hand in this repository.
