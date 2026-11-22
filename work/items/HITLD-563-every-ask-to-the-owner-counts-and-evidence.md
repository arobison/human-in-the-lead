---
id: HITLD-563
title: Every ask to the owner counts, and evidence lowers the count over time
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
constraint_of: [HITLD-405 c2]
---

## Why

The design caps interruptions (`attention.interrupts_per_day_max`, `decisions_per_digest_max`) but did not count the chief of staff's own questions. The owner decided (HITLD-538) that every ask counts.

## What it should do

- Count every question to the owner, including the chief of staff's; track asks per decision settled and per hour; the trust engine's unlocks reduce them over time. Walk-throughs the owner starts do not count. A budget the owner sets stays as a ceiling for system-initiated asks.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-405, HITLD-493. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
