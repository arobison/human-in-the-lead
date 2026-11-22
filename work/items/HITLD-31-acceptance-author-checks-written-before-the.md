---
id: HITLD-31
title: "Acceptance author: checks written before the executor starts"
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-68 c3]
---

## Why

Design part 21, One signal end to end.

## Done when

- The acceptance author writes checks from the item's spec and never sees the implementation.
- An item is dispatched only when its "Done when" is an executable check that already exists.
- An offline scenario shows a check written before the executor starts and failing on the base commit.

## Note on 2026-11-20 (reconciliation)

The mechanical verifiability gate for self-merging (HITLD-518, build HITLD-553) asks for a test that fails on the base and passes on the change; the acceptance author produces such checks, so the two are complementary.
