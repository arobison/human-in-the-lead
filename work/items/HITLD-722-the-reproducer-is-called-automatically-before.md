---
id: HITLD-722
title: The reproducer is called automatically before an executor starts
kind: work
state: planned
created: 2026-11-22
project: HITLD-28
---

## Done when
- When a work item is a reported bug, the orchestrator runs the reproducer before it plans an executor for the item, and the executor's brief carries the failing test, or the item is held with the reason `not reproduced`.
- An item that is not a reported bug is not held or slowed by this step.
- An offline eval scenario shows a reported bug going through the automatic call to a brief with a failing test, and a not-reproducible report held without an invented test.
- `npm run check`, the offline eval gate and `hitld work check` pass.
