---
id: HITLD-190
title: Two containers share one store
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: An orchestrator and the chief of staff share one store, and a successor resumes from it in a fresh container.
done_when:
  - "c1: Both sessions push and pull the store, and the ledger holds both sets of events and dispatches."
  - "c2: A successor in a fresh container resumes from the store with the hand-over note."
  - "c3: Lease, ledger and push status are read current from the store."
constraints: [HITLD-74 c1, HITLD-142 c1, HITLD-148 c1, HITLD-149 c1, HITLD-323 c2, HITLD-188 c2, HITLD-236 c3, HITLD-237 c3, HITLD-183 c3, HITLD-470 c2]
check: demo two containers pushing and pulling the store and one ledger holding both, then a successor resuming in a fresh container from the hand-over note, run by the owner
---

## Notes

Step 2 of 4. Needs the planner of step 1 to offer HITLD-74. HITLD-142 is done.

On the owner's choice (2026-11-16), HITLD-151 moved here from step 3: HITLD-149 follows it, and both edit the quota code.

Re-scoped as a v0.1.0-rc.3 milestone (HITLD-400) by the planning pass HITLD-343, on the owner's decision HITLD-359. HITLD-151 and its clause c2 ("The five-hour limit is gone from the design, defaults, code and evals, so a declared usage figure has one shape") were removed: HITLD-151 stays under HITLD-67 for rc.2, and HITLD-149 already needs it. c1 stays, with HITLD-74, 148 and 149 also under HITLD-67. The outcome, c2, c3 and the check are new.
