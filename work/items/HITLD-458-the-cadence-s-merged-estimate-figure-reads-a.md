---
id: HITLD-458
title: The cadence's merged-estimate figure reads a dispatched estimate under the cap
kind: work
state: planned
created: 2026-11-17
project: HITLD-15
needs: [HITLD-450]
constraint_of: [HITLD-408 c1]
---

## Done when

- `countChanges` in `core/lib/cadence/due.mjs` reads a dispatched event's start estimate the way the refusal and the ratio now do (capped at `dispatch.estimate_max_multiple` times the tier default, and a correction read in place of the original), so `merged_estimate_tokens` cannot be raised by one poisoned figure. A test uses a `dispatched` event carrying 1,882,231 and a corrected one.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-37 (HITLD-450) and reported on 2026-11-17: `countChanges` reads `estimate_tokens` on dispatched events raw for `merged_estimate_tokens`. A correction is picked up there, because the later event wins, but the cap is not applied, so an uncorrected poisoned figure would still count in full toward the cadence's due check.

## Notes

Needs HITLD-450 (the cap and the correction). Code: needs the owner's own yes to merge.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (493,509): cadence merged_estimate cap. The decisions since then are the pace decisions (HITLD-530, 549, 550); the audit of defaults (HITLD-532 to 538). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
