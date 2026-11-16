---
id: HITLD-65
title: Settings hold
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-15
outcome: Two projects on one machine share the person's limits without stepping on each other, and every limit says which layer set it.
done_when:
  - "c1: Check 11 of design 21.1 passes on fixture projects."
  - "c2: The executor cap is a person setting, the plan names the layer and placement that decided it, and the owner raises it with one command."
  - "c3: The owner can move the recorded primary checkout."
constraints: [HITLD-37 c1, HITLD-38 c1, HITLD-39 c1, HITLD-40 c1, HITLD-204 c2, HITLD-145 c2, HITLD-50 c3]
check: integration-test check 11 of design 21.1 on fixture projects, with a cloud placement case
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "settings-hold" of HITLD-15. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-15:

- **settings-hold** (capability). Outcome: two projects on one machine share the person's limits without stepping on each other. Done when: check 11 of One signal end to end (part 21) passes on fixture projects. Check: that integration test. Constraints: HITLD-37 to HITLD-40.

Shaped by the planning pass HITLD-343 (2026-11-16). c1's constraints are done. Stage: v0.1.0-rc.4 (HITLD-401). Kept apart from load aware (HITLD-71), which is after v0.1.0.
