---
id: HITLD-510
title: Each item in the read API carries the token estimate hitld already uses, with its source and spread
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

`work query --json` carries no token estimate, so a consumer cannot use the numbers `hitld ready` orders by. A consumer's dashboard plays the planner's order forward through the executor slots, measured in tokens and never time, to show what gets built when and where each release falls. `hitld ready` orders 131 ready items and breaks ties with history-based estimates for 36 of them; the dashboard has none of them, so it counts items, and its order differs from `hitld ready` wherever an estimate breaks a tie.

Reported as GitHub issue #309 (kind idea), filed by the owner through `hitld feedback` from a consumer project on v0.1.0-rc.1. The issue stays open on GitHub until this item is done.

Evidence from the issue: the dashboard's order matched `hitld ready` on 2,036 of 2,043 item pairs inside each release band. The 7 that differed came from a `needs` difference on one item. The ties it could not break match exactly the items with history estimates.

## What it should do

Each item in the read API carries the estimate hitld itself uses, with where it came from: `estimate_tokens`; `estimate_source` (history, appetite share, or the item's own field); and the spread where there is one. A consumer can then sequence work, size releases and show uncertainty from the numbers hitld uses. It sits beside HITLD-268 (ready, blocked and open needs on each item) and HITLD-267 (state history): one more field the planner already computes.

## Done when

- The missing information is obtained first (an idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the gap (design part 14.7).
- The read API returns `estimate_tokens`, `estimate_source` and the spread for each item that has an estimate, from the same function `hitld ready` uses, and says so when an item has none. Adding the fields does not raise `api_version`.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Placed under HITLD-192 c1 beside HITLD-267 and HITLD-268 by the chief of staff (a proposal for the owner to move). Related: HITLD-298 and HITLD-381 (whether this repository enables `estimate_tokens`), HITLD-450 (estimates capped), HITLD-509 (target burn rate).
