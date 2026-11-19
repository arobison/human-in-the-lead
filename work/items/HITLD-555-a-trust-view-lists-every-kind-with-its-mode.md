---
id: HITLD-555
title: A Trust view lists every kind with its mode, evidence and distance to unlock
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
needs: [HITLD-552]
---

## Why

The owner decided (HITLD-547) that one Trust view shows every kind with its current mode, the evidence behind it and how near it is to its unlock bar, and that an unlock proposal arrives as a normal decision in the owner's queue.

## What it should do

- A view in the dashboard (HITLD-448, 152) listing each kind: mode, evidence (aged clean decisions, misses, reverts), distance to the bar.
- Unlock proposals appear in the owner's queue as decisions with the evidence and a sample (HITLD-519); nothing unlocks until the owner answers.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the trust engine core. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
