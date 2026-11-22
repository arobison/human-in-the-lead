---
id: HITLD-939
title: A failed store device init adds no term to the private list
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

A failed `store device init` (no remote) still adds the device name to the private term list, so a later commit that mentions the name is refused for a device that never existed.

## Done when

- The term is added only after the request succeeds; a failed init adds nothing.
- A test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C5); decision HITLD-932. rc.3 by the owner's decision.
