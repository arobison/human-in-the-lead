---
id: HITLD-599
title: "A page offered for review is rendered and checked first: two widths, every link and drawer, and layout against the tracker"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

The first retrospective (HITLD-589, finding F10) counted 5 rendering defects the owner found in pages the chief of staff offered for review (the dashboard and an Artifact): the owner acted as visual QA, and layout errors against the tracker (release order, missing stage milestones) went unnoticed.

## What it should do

- Before a dashboard or Artifact is offered, a deterministic check renders it at two widths, clicks every item link and drawer, and checks layout against the tracker (release order, that each stage's milestones are present). The result goes with the offer.
- Measure: defects the owner finds per page offered (5 in this run).

## Done when

- The missing information is obtained first (the proposal is from the retrospective, HITLD-589; shape it with the owner), then a failing test or eval that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test, and the design parts it affects are updated in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Code and a check; the owner's own yes to merge. Placed under HITLD-192 c2 (every link in the page opens) by the chief of staff, a proposal for the owner to move. Related: HITLD-152, 448, 585.
