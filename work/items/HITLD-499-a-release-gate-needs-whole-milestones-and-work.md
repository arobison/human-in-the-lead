---
id: HITLD-499
title: A release gate needs whole milestones, and work check flags an item that crosses a release
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- A release gate needs milestones only: either the gate is itself a milestone (its outcome is that the version reaches users, its tag is the version, its constraints are the milestones it contains), or a release item's `needs` accepts only milestones. Either way an item reaches a release only through a milestone. The owner chooses the shape in a walk-through.
- `hitld work check` has a closure check: for each open release gate, every open item that a gated milestone needs, directly or through other items, belongs to a milestone the same gate needs, or to no milestone. A violation names the release, the item, the milestone it belongs to and the path of `needs`. The fix is always in the tracker, by moving the item or splitting the milestone.
- The release flag on the dashboard and views lists exactly the milestones the gate needs, with violations shown as problems.
- Tests cover a gate whose milestone needs an item in a later release's milestone. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #298. A consumer planned four release items; the first release's gate waited on single items inside milestones planned for later releases, which made the plan look far more tangled than it was. Each case was a modeling slip (an item filed away from the work that needed it, a milestone that mixed two outcomes, an enabling item under an unrelated milestone), and the tracker accepted all three without comment. A milestone is a checkable future state for users and a release is the boundary where promises are made (principles 4, 5 and 7), so a milestone half in one release and half in the next is not one future state.

## Notes

Triaged 2026-11-18: proposed; design-heavy, walked through with the owner. This repository has the same shape: HITLD-137 (rc.2) needs the milestone HITLD-67 and also the item HITLD-140 directly. Related: HITLD-129, HITLD-400 and HITLD-401 (the later release items), HITLD-343 (the planning pass). Code and design: the owner's own yes to merge.
