---
id: HITLD-298
title: estimate_tokens is not enabled in tracker.json, so critical paths weigh every item as 1
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-189 c2]
---

## Why

Found by D-20 while building the milestone graph (HITLD-62). `estimate_tokens` is not in `.human-in-the-lead/tracker.json` `optional_keys`, so no item carries an estimate and the critical path weighs every item as 1. The planner and the milestone graph's "tokens left" axis therefore have nothing to weigh. It is a question for the owner whether that is intended. Related: HITLD-81 (agent-shaped estimates).

## Done when

- The owner decides whether this repository enables `estimate_tokens`.
- If yes, it is enabled and the milestone graph's critical path uses it; if no, the item is dropped with a reason.

## Decided

The owner decided on 2026-11-16 (decision HITLD-381): this repository enables `estimate_tokens` (add it to `optional_keys` in `.human-in-the-lead/tracker.json`), and the milestone graph's critical path and tokens-left axis use it.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (509,291): estimate_tokens enable; estimates/budget unit. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the pace decisions (HITLD-530, 549, 550). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Moved on 2026-11-20 (HITLD-592)

On the owner's approval of the nine roadmap moves (HITLD-592), this item moved from milestone HITLD-408 (c1) to milestone HITLD-189 (c2) in v0.1.0-rc.3 (HITLD-400): the planner offers only items that can start, and estimates must be on so critical paths weigh items.

## Done on 2026-11-25

The owner asked for it directly: `estimate_tokens` is now in `optional_keys` in `.human-in-the-lead/tracker.json`, so an item may carry a stored estimate and the critical path, the milestone graph and the decision urgency read it. No item carries one yet; HITLD-995 weighs every open item by sizing's derived estimate when it has no stored one. Made by the chief of staff on the owner's word, outside a dispatch, so the item has no claim commit.
