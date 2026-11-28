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
release_note: "The dispatch plan holds a ready item whose touches overlap an open decision in its release tier (held reason decision), and offers it with a note when nothing else is ready."
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

Measured (2026-11-28) on the last 50 single-item merges on main (2708148 to 915df7b): each item's touches derived from its text against the tree before its merge, the decisions open then (less those the item feeds) derived the same way, and a hold counted right when the decision's touches also overlap the files the merge changed outside `work/`. On main's own trees the hold fires on none of the 50: decisions land on main already answered, so a tree holds one open decision (HITLD-44), and it names no file. As a stand-in, the decisions filed on main while each item was planned and unmerged were counted as open: the hold then fires on 1 item of 50 (HITLD-298, against HITLD-684 on `.human-in-the-lead/tracker.json`), and that one is right. Pair precision 1 of 1; the share it would have held wrongly is 0 of 50 (0%). It missed 1 item (HITLD-387, three decisions naming files it changed but its own text did not). 23 of the 50 items derive no touches, and most decisions name a pull request rather than a file, so the match is rare rather than imprecise; the sample is too small to call its precision settled. The tier filter was not applied in the measurement, which can only lower the count. The same result at an overlap share of 0.5.
