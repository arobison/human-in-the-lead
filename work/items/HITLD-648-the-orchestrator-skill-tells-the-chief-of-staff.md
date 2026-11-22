---
id: HITLD-648
title: The orchestrator skill tells the chief of staff to record the corrections it recognizes as friction events (HITLD-595 follow-up)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-595]
constraint_of: [HITLD-403 c5]
---

## Done when

- The orchestrator skill tells the chief of staff to record the corrections and other friction it recognizes in its own conversation as `friction` events through `hitld ledger append` (self-recognized), without the owner asking.
- A skill change comes with its eval scenario, and the offline eval gate passes.
- `hitld work check` passes.

## Why

The friction signals (HITLD-595) added `hitld ledger append` taking a `friction` event from the chief of staff, which marks it self-recognized and fills in the decision count. The skill does not yet tell the chief of staff to use it. That is a skill change, so it is its own item, with the eval gate.

## Notes

Raised by the HITLD-595 executor's report. Skill changes need the owner's own yes to merge. Related: HITLD-596 (the friction controller), HITLD-598 (no messages about no-op events). Placed under HITLD-403 clause c5 (rc.4), beside the friction signals, as a proposal for the owner to move. Needs HITLD-595 to be merged.
