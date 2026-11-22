---
id: HITLD-564
title: An answer record carries a checkable proof, whatever channel it came through
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
constraint_of: [HITLD-407 c5]
---

## Why

Today an answer counts only if it came through the chief of staff's own session. The owner decided (HITLD-515, 517) that validity depends on a proof the system can check, not on the channel.

## What it should do

- One answer record with a proof field: the harness-attested turn today, the person's signature later (HITLD-333, 409), a tracker platform's authenticated identity for contributor input (HITLD-517). A write from a web page without a proof is data, not an answer.
- Which key signs is not decided (HITLD-516): settled when the HITLD-333 migration is designed.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-407, HITLD-409, HITLD-501. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
