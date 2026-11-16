---
id: HITLD-343
title: Every open work item sits under a milestone, and the empty milestones are filled in
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- Every open work item (proposed or planned) is under a milestone, or a new milestone is proposed for it; the owner commits each new milestone.
  - **Placement:** each item's relationship is recorded the way the tracker stores it (a `needs` from the milestone or a contribution), with the item's own Done-when unchanged. Items that belong together get one new milestone, named by its outcome, never numbered.
  - **New milestones:** each is a proposed milestone with an outcome, done-when clauses and a check, put to the owner in a walk-through, one at a time; none is committed without the owner.
- The eight planned milestones that have no outcome, clauses or check (HITLD-1, 64, 65, 66, 68, 69, 70, 71) are filled in: an outcome, done-when clauses, and a check each, with constraints linked to a clause. Where a milestone should be merged, dropped or split, it is put to the owner rather than decided.
- Dependencies are reviewed item by item for the open work: a `needs` that is missing or wrong is fixed, and one that only records finished history is left alone.
- `work check` warns on an open work item under no milestone (an error from the release after the pass), so the rule holds from then on.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked for a pass over the work items and milestones, to make sure they are all filled out correctly with correct dependencies (2026-11-16). A scan found 110 of 130 open work items under no milestone, so they cannot show on the milestone board, and 8 of the 10 planned milestones have no outcome, clauses or check (shells left by the structure migration). The owner chose the rule: all items are either placed in a milestone or a new milestone is created for them (decision HITLD-345).

## Notes

Design-heavy: stays proposed and is walked through one question at a time. A first step is a proposal table (item, suggested milestone or new milestone, suggested `needs`) for the owner to answer in groups, not 130 questions. The work is the tracker, so the pass changes only files under `work/` and the one check, and the milestone commitments are the owner's. Related and done: HITLD-132 (the stale item sweep), HITLD-90 (tracker structure).
