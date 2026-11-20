---
id: HITLD-637
title: Channel clearances in the person-level settings, and the check that compares a label with a clearance (HITLD-620)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620]
---

## Done when

- The person-level settings file lists each channel and its clearance: models (the owner's own account, a local model, other providers), tools, the synced store and each registered bucket. The owner's own account is cleared down to approved-models, a local model down to local-model-only, and any other provider has none until the owner decides.
- A project's committed policy may add a narrower limit and never a wider one; the strictest layer wins, and a test shows a project cannot widen.
- A single check function takes a label and a channel and answers allow or deny on both dimensions, with default deny and an explicit deny winning; tests cover every pair of reader and place values.
- A session's effective clearance is the narrower of its model's and its role's; a role never exceeds its model's.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Decided in the classification taxonomy walk-through of 2026-11-20 (HITLD-625 to 635, item HITLD-620). The channel clearances and the rule that decides every flow in one place.

## Notes

The role clearances come from the existing least-privilege role definitions (design 10). Code, schema and policy changes need the owner's own yes to merge. Needs HITLD-620 (the design parts are updated to the decisions first, as part of done). Placed under HITLD-567 clause c2 (rc.5) as a proposal for the owner to move.
