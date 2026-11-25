---
id: HITLD-1044
title: Three small findings from the review of the budget claim cap (pull request 641) are fixed
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The Limitations section of HITLD-841 says a follow-up with no close commit before it is charged from the first claim against the first cap, which is stricter than the executor needs, so it may be refused earlier.
- The brief clamps or omits a report-at figure above 999999999999, so the claim command it prints cannot fail with `usage`.
- `work claim` writes no `Budget-Tokens` trailer when the ledger holds the dispatch but has no estimate, since the hook never reads it then, or the item says why it is written.
- A cloud executor the watchdog continues after a stall is charged from its own continuation, not the first claim, or the item records the owner's decision to keep the stricter count.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The second independent review of pull request 641 (HITLD-841) approved it with these findings, all very low except the last, which the pull request names as a limitation [Likely]. The owner chose to merge and file them.

## Notes

rc.3. Budget-hook code: the owner's own yes at merge. Follows HITLD-841. The last done-when needs a design call from the owner before it is built.
