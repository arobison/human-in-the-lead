---
id: HITLD-712
title: The adversary counts a known break per defect, not per smallest counterexample
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-68 c4]
---

## Why

A break is "known" when an open regression test marked todo holds the same counterexample, matched by a digest of the smallest case (`core/lib/adversary/attack.mjs`). One defect can have several smallest cases (shrinking stops at a local minimum), so each is counted as a new break: the pass on the core area recorded three todo tests for one front-matter defect and two for one `safePath` defect, each wanting its own fix item. The orchestrator must file or name an item for each, and every later pass can find yet another local minimum of the same defect.

## Done when

- The design says when two counterexamples are the same defect, chosen in a design walk-through. For example: the open test's fix item is named in the new break's record, or the pass groups breaks by the first line of the failure and asks the orchestrator to confirm.
- A pass over an area with an open test for a defect does not record a new test for another smallest case of that defect; it reports it as known, naming the open test and the fix item.
- A test covers two local minima of one defect (one fix item, no second test) and two different defects of one invariant (two tests).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the pass on the core area (HITLD-32, PR 397). Proposed because how to tell one defect from two is a design choice; the pass must never hide a real second defect behind a known one. Design and code: the owner's own yes to merge. Related: HITLD-711.
