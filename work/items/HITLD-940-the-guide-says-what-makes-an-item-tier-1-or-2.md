---
id: HITLD-940
title: The guide says what makes an item tier 1 or 2, and new items made as the guide says raise no missing-why or milestone warnings
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

Every new item made as the guide says sizes as tier 3 with a large model and 400k to 500k tokens, and `ready` says 'design-heavy work for its own session' for a one-line item; the guide never says what makes an item tier 1 or 2. Current main also warns 'under no milestone', 'missing-why' and 'missing-summary' on items made exactly as the guide says.

## Done when

- The guide has a paragraph on what makes an item tier 1 or 2 (a Plan section, `touches`).
- Items made as the guide says raise no missing-why or milestone warnings, or the guide says how to avoid them.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C6); decision HITLD-932. rc.3 by the owner's decision. HITLD-287 (sizing reads a Plan section and touches, but nothing tells a project) is the same problem.
