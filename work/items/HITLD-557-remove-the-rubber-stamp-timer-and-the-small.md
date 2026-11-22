---
id: HITLD-557
title: Remove the rubber-stamp timer and the small-sample thresholds as trust inputs
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
constraint_of: [HITLD-566 c2]
---

## Why

The owner decided (HITLD-535) that the speed of the owner's yes and small counts no longer feed any trust or review decision: trust rests on evidence (HITLD-473).

## What it should do

- Remove `trust.rubber_stamp_seconds`, `precedent.review_min_applications` and `review.first_after_outcomes` as inputs to any decision, and their settings, with a migration note.
- If a measure of review keep-up is wanted it is a metric (HITLD-408), not a rule.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-493. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
