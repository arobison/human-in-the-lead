---
id: HITLD-1066
title: The run scope's touch check runs when a scope is set, not at every start, and touches containing spaces work
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `run scope set` compares the owner paths a scope's items touch with the question's, and later starts do not repeat the full check (they read the result), so a start costs the budget and end-time checks only; a test counts the reads.
- A touch path with a space is accepted and matched exactly; today it is refused. A test covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reviews of HITLD-877: the touch comparison runs at every start although it can only change when the scope is set, and a path containing a space is refused.

## Notes

rc.3. Follows HITLD-877. Ordinary code in `core/lib/run/scope.mjs` and the command; the run-scope guard itself stays owner-held.
