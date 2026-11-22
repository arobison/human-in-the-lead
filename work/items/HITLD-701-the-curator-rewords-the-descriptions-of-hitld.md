---
id: HITLD-701
title: The curator rewords the descriptions of HITLD-15, HITLD-28 and HITLD-64 to the description guide
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
needs: [HITLD-75]
claimed_by: D-01M80C9CAE417SB8
---

## Why

The description check built in HITLD-75 (the writing guide, the deterministic check and the eval) warns on the descriptions of the planning items HITLD-15, HITLD-28 and HITLD-64. The owner chose to reword them (decision HITLD-702) and asked that it be done as the curator's pass, as wording only.

## Done when

- The curator's pass (the curate skill) rewrites the descriptions of HITLD-15, HITLD-28 and HITLD-64 to the description guide, within each item's facts: wording only, no change to scope, plan, placement or release. Anything that would change those is listed as a question in its report.
- `hitld work check` no longer warns on those three descriptions, and the change is a tracker pull request the chief of staff checks against the decision records before merging.
- `hitld work check`, `npm run check` and the offline eval gate pass.

## Notes

Not started yet: the owner's hold on new executor starts (HITLD-663) stands until the review queue is clear; the orchestrator dispatches this as a tier-1 curator job when starts open.
