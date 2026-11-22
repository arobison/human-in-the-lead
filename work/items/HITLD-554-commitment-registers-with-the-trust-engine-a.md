---
id: HITLD-554
title: "Commitment registers with the trust engine: a goal under a signed budget, rungs, a veto window, stop and confer"
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
needs: [HITLD-552, HITLD-498]
constraint_of: [HITLD-566 c2]
---

## Why

The owner decided that committing to work is a trust system (HITLD-291, 503 to 506, 522 to 524): the unit is a goal under a budget, with rungs the system earns.

## What it should do

- A goal is an existing milestone or release item; the budget (tokens, time, attention) and the rung per kind of commitment live in a commitment decision the owner signs (HITLD-522). Only `planned` items can be committed to; held items stay held at every rung.
- Rungs: ask first; tell the owner then proceed unless they object within a window; proceed and report (HITLD-505). The window counts the owner's awake time, set per kind, default 4 hours (HITLD-523).
- A commitment ends when the goal is met, the budget is spent or the quota gate says stop; initially the system stops and the chief of staff confers, and choosing the next goal and later proposing new goals are further kinds that earn rungs (HITLD-524).
- Evidence: finished within budget, an estimate close to the measured cost, work later dropped as the wrong work, and the owner's report (HITLD-506). The quota gate's reserve always wins (HITLD-422).

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the trust engine core. Replaces the first form of HITLD-291. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
