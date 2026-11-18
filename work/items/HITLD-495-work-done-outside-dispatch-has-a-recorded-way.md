---
id: HITLD-495
title: Work done outside dispatch has a recorded way into the merge queue, so one owner yes records one merge
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- There is a recorded way into the merge queue for work done outside dispatch: for example `hitld merge add --branch <b> --item <ID> --report <file>`, run by the orchestrator as its own logged call, where the queue checks the report's shape and runs every check from the start, as for any branch. Or an adoptable dispatch: `dispatch start --adopt <worktree>` recording a dispatch for a session the chief of staff starts, so `dispatch complete` takes its report. The owner chooses between them in a walk-through.
- Either way, the owner's one yes is recorded against a presentation hitld made, and the merge leaves the same evidence as any other: `verified` and `merged` events and the trust evidence for the approval.
- A test merges a branch that has no dispatch through the new path with one owner answer. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #295. Twice in one project an approved item could not be dispatched (the planner gave the slot to another item, #148; `dispatch start --by-hand` was refused as `not-planned`, #159), so the orchestrator ran it outside dispatch. Only `dispatch complete` queues a branch, and it refuses a dispatch hitld does not have in flight, so `hitld merge` found nothing to present and `merge approve` had nothing to record. The second time the owner answered two decisions for one merge, and the merge left no `verified` or `merged` event and no trust evidence.

## Notes

Triaged 2026-11-18: proposed. Related: HITLD-346 (no `dispatch drop`), HITLD-314 (follow-up for interactive dispatches), HITLD-494, HITLD-496, HITLD-497. Design choice between the two ways in is the owner's. Code and design: the owner's own yes to merge.
