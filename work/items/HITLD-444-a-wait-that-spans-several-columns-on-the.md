---
id: HITLD-444
title: A wait that spans several columns on the Roadmap is routed around the boxes in between
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-408 c2]
---

## Done when




- On the Roadmap board, an edge that crosses several columns is routed around the milestone boxes between its two ends, or drawn so it cannot be read as a chain through them, at the sizes the tracker has now (about 25 milestones, four releases). The owner's example: HITLD-67 to HITLD-1 passes behind HITLD-189 and HITLD-65.
- The fewest-crossings layout keeps working with the new routing; the page stays one file with no network request and no new script.
- A fixture tracker with a wait that spans two intermediate boxes tests that no edge passes through a box. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-33 (HITLD-421), reported as not blocking, and visible on the merged board: a wait that spans several columns still passes behind the boxes in between, which can read as a chain. HITLD-421 put the milestones in release-stage columns, which made long waits more common.

## Notes

Dashboard and code: needs the owner's own yes to merge. Related: HITLD-421 (the stage columns), HITLD-152 (the views). Proposed placement: HITLD-192 c1 (every open item shows on the board).

## Moved on 2026-11-20 (HITLD-605)

On the owner's decision HITLD-605, this item moved from milestone HITLD-192 (c1) to milestone HITLD-408 (c2). It ships after v0.1.0 and is under no release.
