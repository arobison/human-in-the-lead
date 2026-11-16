---
id: HITLD-68
title: End to end
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-28
outcome: A reported issue reaches a merged, closed item, with the owner asked only for calls that are theirs.
done_when:
  - "c1: Intake and triage turn issues and the owner's notes into classified signals."
  - "c2: A reported bug becomes a failing test before the executor starts."
  - "c3: Every dispatched item has an executable check written before it starts."
  - "c4: One area has an adversarial pass on every change."
  - "c5: The end-to-end eval runner drives a reported bug to a merge on a fixture repository, so the check can run."
constraints: [HITLD-29 c1, HITLD-30 c2, HITLD-31 c3, HITLD-32 c4, HITLD-57 c5]
check: demo the end-to-end eval (check 1 of design 21.1) on a fixture repository, run in the end-to-end eval runner
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "end-to-end" of HITLD-28. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-28:

- **end-to-end** (capability). Outcome: a reported issue reaches a merged, closed item with the owner asked only for calls that are theirs. Done when: check 1 passes on a fixture repository. Check: the end-to-end eval. Constraints: HITLD-29 to HITLD-32.

Shaped by the planning pass HITLD-343 (2026-11-16). Stage: after v0.1.0.

The check runs in the end-to-end eval runner (HITLD-57), so the planning pass HITLD-343 added it as a constraint, with c5 for it: a milestone constraint must name a clause, and none of c1 to c4 covers the runner.
