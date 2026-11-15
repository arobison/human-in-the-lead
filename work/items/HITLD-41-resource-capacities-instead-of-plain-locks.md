---
id: HITLD-41
title: Resource capacities instead of plain locks
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
needs: [HITLD-40]
---

## Why

Per design 13.4: a GPU may take one heavy or several light holders. A plain lock either wastes it or overloads it.

## Done when

- The machine profile sets a capacity per resource; holders take a weight; a plain serial resource has capacity 1.
- Holders queue in arrival order, and a waiting heavy holder is not overtaken by later light ones.
- Existing lock behaviour (stale holders, expiry, waits recorded) is unchanged for capacity 1.
