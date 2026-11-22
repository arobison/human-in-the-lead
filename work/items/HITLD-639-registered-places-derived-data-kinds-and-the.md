---
id: HITLD-639
title: Registered places, derived-data kinds and the signed decision that loosens a label (HITLD-620)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620]
constraint_of: [HITLD-567 c2]
---

## Done when

- The owner registers concrete places (this machine, the synced store, a named bucket) under a place class, and the registration is a recorded decision; dyno's bucket is registered once.
- Kinds of derived data (a verdict, a headline, a bare result ID) take the strictest label of their inputs, and the owner may lower a named kind by a signed decision; nothing is lowered by default; a test shows a derived record cannot carry a lower label without such a decision.
- Loosening any label is refused unless a signed owner decision with a reason exists; tightening needs none and is recorded.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Decided in the classification taxonomy walk-through of 2026-11-20 (HITLD-625 to 635, item HITLD-620). The places and the derived-data and loosening rules.

## Notes

The measurement-tool design (HITLD-609) is the first user: results start local-model-only and this-machine-only until dyno's bucket is registered. Code, schema and policy changes need the owner's own yes to merge. Needs HITLD-620 (the design parts are updated to the decisions first, as part of done). Placed under HITLD-567 clause c2 (rc.5) as a proposal for the owner to move.
