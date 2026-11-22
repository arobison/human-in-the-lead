---
id: HITLD-903
title: A durable executor's liveness records the process start time, and a silent one past its deadline gets its own verdict
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

A durable executor's liveness is `kill(pid, 0)` on a bare process id (`core/lib/run/reality.mjs` `processSignal`), so a reused id or a hung `claude -p` that makes no tool calls gets the verdict `progressing` indefinitely and its item stays claimed; the item said silence is 'reported with evidence'.

## Done when

- The process start time is stored beside the process id, and a reused id is not taken as the same process.
- A silent process past its deadline gets a distinct verdict (`quiet`) that the watchdog reports with evidence.
- A test for a reused id and a hung process.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R9; decision HITLD-897. rc.3 by the owner's decision.
