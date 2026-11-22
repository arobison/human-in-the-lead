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
  - "c2: A successor orchestrator in a fresh container rebuilds from the store's per-writer ledger files and the tracker, with no hand-over note."
  - "c3: Lease, ledger and push status are read current from the store."
check: demo two containers pushing and pulling the store and one ledger holding both, then a successor orchestrator in a fresh container rebuilding from the store's ledger files and the tracker, run by the owner
---

## Notes

Step 2 of 4. Needs the planner of step 1 to offer HITLD-74. HITLD-142 is done.

On the owner's choice (2026-11-16), HITLD-151 moved here from step 3: HITLD-149 follows it, and both edit the quota code.

Re-scoped as a v0.1.0-rc.3 milestone (HITLD-400) by the planning pass HITLD-343, on the owner's decision HITLD-359. HITLD-151 and its clause c2 ("The five-hour limit is gone from the design, defaults, code and evals, so a declared usage figure has one shape") were removed: HITLD-151 stays under HITLD-67 for rc.2, and HITLD-149 already needs it. c1 stays, with HITLD-74, 148 and 149 also under HITLD-67. The outcome, c2, c3 and the check are new.

## Changed on 2026-11-20 (HITLD-603)

HITLD-470, a decided design item, left this milestone on the owner's decision HITLD-603; it closes when the design-docs update (HITLD-572) merges.

On 2026-11-22, filed from the first self-hosting run's follow-ups: HITLD-706 (skills name a dispatch by its ID, not the numbered placeholder) and HITLD-708 (a recorded hash that catches a settings copy edited outside the CLI at store push) join clause c1, with the ledger IDs of HITLD-74 and the settings that travel in the store (HITLD-148).
