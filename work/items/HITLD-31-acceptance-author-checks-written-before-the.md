---
id: HITLD-31
title: "Acceptance author: checks written before the executor starts"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-28
milestone: end-to-end
---

## Why

Design part 21, One signal end to end.

## Done when

- The acceptance author writes checks from the item's spec and never sees the implementation.
- An item is dispatched only when its "Done when" is an executable check that already exists.
- An offline scenario shows a check written before the executor starts and failing on the base commit.
