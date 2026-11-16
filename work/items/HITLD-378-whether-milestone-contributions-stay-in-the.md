---
id: HITLD-378
title: Whether milestone contributions stay in the design, and what unit their value is in
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- The owner decides, in a walk-through, whether milestone contributions (optional items with a value and a confidence, ranked within the appetite) stay in the design, or whether everything under a milestone is a constraint and anything optional goes to a later milestone. If they stay, the value unit (open question Q18) is settled first, so values are not invented.
- Design 3.2 and 2.3, the milestone and item schemas, `work check`, the dashboard's scope view and the planner's value rule change to match the decision; no tracker entry holds a contribution with an invented value.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked on 2026-11-16 whether the idea of nice-to-have items was removed, and to check the design. The design removed priority labels, but contributions remain (design 3.2, around the Kano split): optional items with a value and a confidence, which the orchestrator may cut within the appetite. No milestone uses them yet, and the value unit (Q18) is open. The planning session (HITLD-343) placed no item as a contribution, because a contribution needs an invented value (decision HITLD-377).

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-80 (contribution value in the project's value units with a confidence, not a Fibonacci rank), HITLD-343.
