---
id: HITLD-413
title: "Small fixes found by the planning pass: a British spelling in HITLD-323, and design 3.4 does not list the new work check warning"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-343]
constraint_of: [HITLD-403 c3]
---

## Done when




- The one British spelling (the double-l form of "traveled") in `work/items/HITLD-323-a-successor-orchestrator-in-a-fresh-cloud.md` becomes American, and `npm run spelling` reports no finding on main.
- Design 3.4, "Validation" (`docs/design/0001-human-in-the-lead/03-data-model.md`), lists the warning for an open work item under no milestone that HITLD-343 added to `hitld work check`.
- `npm run check` and `hitld work check` pass.

## Why

Found by the executor of D-29 (HITLD-343), reported as not blocking: `npm run spelling` flags 1 finding in 1023 files, on main too, and the design's validation section does not list the new warning (a docs change outside HITLD-343's touches).

## Notes

Small; any executor can take it after HITLD-343 merges. Needs HITLD-343.
