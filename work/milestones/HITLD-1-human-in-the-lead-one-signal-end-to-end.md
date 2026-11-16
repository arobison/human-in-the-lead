---
id: HITLD-1
title: "Human in the lead: one signal end to end"
kind: milestone
state: planned
created: 2026-11-14
owner: owner
outcome: One signal travels the whole path, from arrival to a merged and closed item, with the owner involved only for calls that are theirs, every step recorded, and an eval suite that catches the next change that breaks it.
done_when:
  - "c1: A reported issue reaches a merged, closed item on a fixture repository (checks 1 to 3 of design 21.1)."
  - "c2: Untrusted text is contained and leaks are blocked (checks 4 and 5)."
  - "c3: The eval suite gates changes (check 6)."
  - "c4: Settings hold, and heavy work waits on a busy machine (checks 8, 9 and 11)."
  - "c5: It installs from a release and runs a real consumer (checks 7 and 10)."
constraints: [HITLD-68 c1, HITLD-64 c2, HITLD-69 c2, HITLD-70 c3, HITLD-65 c4, HITLD-71 c4, HITLD-66 c5, HITLD-67 c5]
check: demo the eleven checks of design 21.1 run on fixture repositories by someone other than the authors, each result recorded
---

## Goal

The first slice of design 0001, One signal end to end (part 21): agents do the work, the owner sets direction and makes the calls, first in a consuming project and then in this repository itself.

## Notes

Made by `hitld work migrate` (tracker-structure) from the initiative HITLD-1: a long outcome is a milestone with no parent. Its constraints are the milestones of the projects that were under it, marked `c?`; shaping gives it an outcome, done-when clauses and a check, and links each constraint to a clause.

Shaped by the planning pass HITLD-343 (2026-11-16): the outcome, clauses and check follow design 21.1, and each milestone is linked to the clause it serves. On the owner's decision HITLD-362 it sits after v0.1.0 and keeps HITLD-67 (self-hosting) as a constraint; design 21.2 is amended later. The rc.3 and rc.4 milestones are not added to it.
