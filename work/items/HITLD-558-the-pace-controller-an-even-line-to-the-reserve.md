---
id: HITLD-558
title: "The pace controller: an even line to the reserve on the account total, with AIMD concurrency"
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
needs: [HITLD-165]
constraint_of: [HITLD-567 c1]
---

## Why

The owner decided (HITLD-509, 530, 549, 550) that the quota gate follows an even pace line to the reserve at the reset, ahead of which it slows work early and behind which it may use spare capacity only on work a commitment allows, with projects blind to each other.

## What it should do

- Each project follows the line on the account's total utilization, read from the quota probe (HITLD-165) or the declared figure (HITLD-149), and reads nothing about other projects.
- An AIMD controller sets how much the project starts: additive increase while the total is below the line, multiplicative decrease above it, conservative gains for the feedback delay, the same rule adapting executor concurrency (HITLD-550). A first window starts from a small rate.
- The reserve stays untouched, and the owner's own use counts as a draw on the line. A reading too stale or unrecognized counts as no reading and falls back to today's bands.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the probe (HITLD-165) and the declared-figure path (HITLD-149). Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
