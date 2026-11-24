---
id: HITLD-979
title: A repeated dispatch start on an item whose branch an earlier worktree still holds reuses it or refuses before it records anything
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-404 c?]
---

## Done when

- First reproduce it: a test dispatches an item, leaves its worktree in place, dispatches the item again, and records what the ledger holds; the result is written in Notes.
- If it reproduces, `dispatch start` either reuses the earlier worktree or refuses with a message naming the worktree, and the ledger holds no dispatch that goes straight from dispatched to abandoned; a test checks both.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A second dispatch of an item whose earlier worktree still holds the branch leaves a dispatch in the ledger that never ran, with no message saying why. It serves the orchestrator, who reads the ledger as the record of what ran.

## Notes

GitHub issue 581. rc.3. The HITLD-934 work changed how worktrees are reused and discarded, so it may already be fixed in part: reproduce first, as for HITLD-879.
