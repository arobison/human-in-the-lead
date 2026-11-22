---
id: HITLD-378
title: Whether milestone contributions stay in the design, and what unit their value is in
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-192 c1]
---

## Done when

- **Decided by the owner (HITLD-431): contributions are dropped.** Everything under a milestone is a constraint; optional work goes to a later milestone, and a milestone's scope is its constraints against its appetite.
- Design 3.2 (the Kano split paragraph, the `contributions` field, the scope knapsack and who cuts contributions) and 2.3 (value and confidence for contributions), the milestone and item schemas, `hitld work check` (the rule that every contribution has a value and a confidence), the tracker's stored format (`contributions` lines), the dashboard's scope view and the planner's value rule lose the contribution concept; a migration step reads an old `contributions` list with a warning for one minor version and moves each entry to a constraint of its milestone. The open question Q18 (what unit value is measured in) is closed or marked not needed for milestones; a project's own value for the bet stays.
- No tracker entry holds a contribution; HITLD-80 (contribution value in the project's value units) is marked as superseded.
- Tests cover the migration of an old milestone with contributions, and the check refusing none. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked on 2026-11-16 whether the idea of nice-to-have items was removed, and to check the design. The design removed priority labels, but contributions remain (design 3.2, around the Kano split): optional items with a value and a confidence, which the orchestrator may cut within the appetite. No milestone uses them yet, and the value unit (Q18) is open. The planning session (HITLD-343) placed no item as a contribution, because a contribution needs an invented value (decision HITLD-377).

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-80 (contribution value in the project's value units with a confidence, not a Fibonacci rank), HITLD-343.
