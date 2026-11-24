---
id: HITLD-978
title: The planner and the ready count skip items closed on their branch and waiting to merge, and a fix for a stuck merge can take an executor slot at the cap
kind: work
state: done
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M85PQM97TJFWF1
release_note: "`hitld dispatch plan`, `hitld ready` and `hitld dispatch start` no longer offer an item whose queued branch already closes it once a dispatch on it is abandoned or unclaimed: it stays under `awaiting_merge` until the branch merges or is reverted, or its pass is corrected. `hitld dispatch start <ID> --fixes-merge <item or branch>` starts the fix for a stuck merge with every slot taken, one past the cap, so a run the economize cap holds to one slot cannot deadlock behind its own waiting branches."
---

## Done when

- `hitld dispatch plan` and the ready count do not list an item whose branch carries its `work close` commit and is waiting to merge; a test builds that state and checks the item is absent from the plan and the count.
- With the economize cap reached, `dispatch start` for an item that fixes a stuck merge is accepted; a test shows it starts at the cap and a plain item is still refused.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A run held to one executor slot by the economize cap can deadlock: items already closed and waiting to merge keep taking the slot, and the fix a stuck merge needs cannot start. It serves the orchestrator and the owner running this repository in economize mode.

## Notes

GitHub issue 580 (feedback from a consumer run). With economize mode holding executors to one slot, items already closed and waiting to merge kept taking the slot, and the fix the stuck merge needed could not start until the owner started it by hand. Related: HITLD-745 (the planner offers an item again). Joins rc.2: it can deadlock a single-slot run, which is how this repository now runs.
