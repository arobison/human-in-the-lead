---
id: HITLD-565
title: Reconcile the open items with the decided designs
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

The audit of 2026-11-19 found 92 open items an open design could change and 15 it could not judge. The designs are now decided, so each needs to be kept, rewritten or dropped, and several contradictions were noted: HITLD-188 and 236 (hand-over note and lease, removed by HITLD-470), HITLD-217 and 281 (dispatch IDs and the repeated-ID crash, removed by HITLD-74), HITLD-204 (a run layer in the cap), HITLD-126, 254, 240, 180 and 186 (answers only in the chief of staff's session), HITLD-143 and 218 (today's rights rule), and HITLD-155 (trust per model type).

## What it should do

- Walk the audit's list (92 affected, 15 unsure) against the decisions of 2026-11-19 and for each item keep, rewrite or drop it, with the owner deciding any drop.
- Fix the contradictions between milestones and decided designs (HITLD-190 c2 against HITLD-188 and 236; HITLD-407's outcome against HITLD-515).

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

A shaping pass; the owner decides the drops. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
