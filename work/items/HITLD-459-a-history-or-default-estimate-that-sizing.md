---
id: HITLD-459
title: A history or default estimate that sizing scales for breadth stays under the cap
kind: work
state: planned
created: 2026-11-17
project: HITLD-15
needs: [HITLD-450]
constraint_of: [HITLD-408 c1]
---

## Done when

- A start estimate that sizing builds from history or from the tier default and then scales for the item's breadth never ends up above the cap (`dispatch.estimate_max_multiple` times the tier default), or the brief says so where it does. A test uses an item whose breadth scale would put the estimate above the cap.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-37 (HITLD-450) and reported on 2026-11-17: sizing's breadth scale can put a history or default estimate above the cap. The brief then states a larger budget than the refusal and the ratio read from. The direction is conservative (the refusal is tighter than the brief says), so it is not urgent, but the figures disagree.

## Notes

Needs HITLD-450. Related: HITLD-439 (the estimate source and settings). Code: needs the owner's own yes to merge.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (493,509): estimate cap. The decisions since then are the pace decisions (HITLD-530, 549, 550); the audit of defaults (HITLD-532 to 538). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
