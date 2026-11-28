---
id: HITLD-1047
title: The queue holds back a ready item whose files overlap an open decision's files, so work is not started on a design that a decision will change
kind: work
state: in-progress
created: 2026-11-25
project: HITLD-15
needs: [HITLD-995]
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8G8PE3E2GN35T
---

## Done when

- A ready item whose derived touches overlap the derived touches of an open decision in the same tier is held for a later plan, with the reason named in the plan; a test covers an overlapping and a non-overlapping pair.
- The hold is soft: when nothing else is ready the item is offered with a note, so it never stalls a run; a test covers it.
- The precision of the touches match is measured on the last 50 merged items and the result is written in the notes, with the share it would have held wrongly.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

An item built before a decision it depends on is settled often changes after the answer, which wastes the tokens spent. The graph carries a `needs` edge only when someone wrote one.

## Notes

rc.2, the owner's word (2026-11-25). Follows HITLD-995. The advisor tagged the precision of a touches-based hold [Guessing], hence the measurement in the done-when.
