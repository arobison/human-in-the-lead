---
id: HITLD-190
title: Two containers share one store
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: An orchestrator and the chief of staff each write the private store without their ledgers colliding.
done_when:
  - "c1: Both sessions push and pull the store, and the ledger holds both sets of events and dispatches."
  - "c2: The five-hour limit is gone from the design, defaults, code and evals, so a declared usage figure has one shape."
constraints: [HITLD-74 c1, HITLD-142 c1, HITLD-148 c1, HITLD-149 c1, HITLD-151 c2]
check: demo two containers pushing and pulling the store and one ledger holding both, run by the owner
---

## Notes

Step 2 of 4. Needs the planner of step 1 to offer HITLD-74. HITLD-142 is done.

On the owner's choice (2026-11-16), HITLD-151 moved here from step 3: HITLD-149 follows it, and both edit the quota code.
