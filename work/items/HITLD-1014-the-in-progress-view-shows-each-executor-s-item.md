---
id: HITLD-1014
title: The in-progress view shows each executor's item, stage, context use and cost, and the orchestrator's
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The in-progress view names each running executor's item and stage (implementing, review, fix round, merge gates, merge-ready, or waiting and on what), its context use against its window and its compactions, and a running token total with a cost estimate at dated list prices; a row for the orchestrator shows its context, its cost, the executor cap, filled slots and any pause.
- It covers executors `dispatch start` made and ones started by hand, and it reads from the ledger and the harness records without walking the store (HITLD-600); a test covers a by-hand executor and an executor waiting on the owner.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 607 (v0.1.0-rc.1): the person watching a run wanted to know which executor works on which item, how far along it is, how full its context is and what it has cost so far, and the same for the orchestrator. The in-progress view lists claimed items only, and does not know executors started by hand.

## Notes

rc.3. A design question sits inside it (what a stage is, whether prices are dated list prices), so shape it with the owner first. Related: HITLD-794 and 796 (the chief of staff measures an orchestrator's context), HITLD-797 (derived progress), HITLD-237.
