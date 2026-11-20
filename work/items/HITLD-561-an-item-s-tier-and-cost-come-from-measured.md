---
id: HITLD-561
title: An item's tier and cost come from measured history, with its plan as the prior
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

Dispatch routes by a file count (`dispatch.tier1_max_touches` 3) and familiar yield, and issues 158 and 201 showed sizing ignored the plan and required reading, so every item sized as tier 3. The owner decided (HITLD-533) that measured history decides, with the plan as the prior.

## What it should do

- Tier and estimate come from the measured tokens of similar finished items (HITLD-438, 450), the item's plan and required reading the starting guess until there are enough completions. File count stays only as one weak input.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Shape with HITLD-285, 286 and 287 (sizing and touches defaults). Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.

## Folded items (HITLD-575)

HITLD-287 and HITLD-500 are folded into this item and close when it lands. HITLD-285 and HITLD-286 stay as independent small fixes.
