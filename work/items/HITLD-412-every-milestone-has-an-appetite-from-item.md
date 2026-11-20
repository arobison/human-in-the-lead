---
id: HITLD-412
title: Every milestone has an appetite from item estimates, and the ones that do not fit are flagged
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-298, HITLD-343]
---

## Done when




- Every planned and proposed milestone has `appetite_tokens`, set from the sum of its constraints' estimates (HITLD-298 turns estimates on) with the project's appetite split between milestones, and `hitld work check` verifies the shares fit the project's appetite.
- Each milestone whose constraints do not fit its appetite is listed with the open constraints that make it too big, and the owner is asked one at a time whether to split it, raise its appetite or cut a constraint. The sizes the planning pass flagged first are HITLD-189, 191, 403 and 402 (and HITLD-405, which holds the end-to-end eval runner through HITLD-146).
- The decisions are recorded; changing a milestone's outcome, clauses, constraints or appetite is a decision (design 3.2), so nothing is split or cut without the owner.
- `hitld work check` and `npm run check` pass.

## Why

The planning pass (HITLD-343, merged as PR #249 (HITLD-343) once approved) placed every open item under a milestone, but no milestone sets an appetite, so nothing shows whether a milestone is too big. The executor flagged HITLD-189 (14 open constraints, two of them large design items), HITLD-191 (13, and it waits on the open decision HITLD-27 through HITLD-76), HITLD-403 (12), HITLD-402 (10) and HITLD-405 as the ones that grew most. The owner decided to set appetites in a later pass, once `estimate_tokens` is on (decision HITLD-411).

## Notes

Needs HITLD-298 (estimates on) and HITLD-343 (the placements). Related: HITLD-81 (agent-shaped estimates). Mostly tracker work plus walk-throughs.

## Terms decided on 2026-11-20 (HITLD-577)

Appetite is how big a milestone is estimated to be, from its item estimates (HITLD-412). Budget is what the owner allows a signed commitment to spend (HITLD-522). Pace is the rate the plan allows per hour, the even line (HITLD-530). Where this item uses one of these words for another meaning, the meaning above applies.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (509,291): milestone appetite from estimates. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the pace decisions (HITLD-530, 549, 550). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
