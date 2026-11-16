---
id: HITLD-346
title: "A branch awaiting merge can be released: a dispatch drop command, and a closed unmerged pull request releases the item"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- `hitld dispatch drop <ID>` releases a dispatch whose work is finished but whose branch will not merge, so the item is planned again, and records why. It is allowed on a dispatch that has reported, where the ledger forbids `abandoned`.
- A pull request closed without merging releases its item on its own, with no command, the next time the run reads the forge; the ledger shows the release and the pull request it came from.
- A report that is partial or blocked does not hold its item as awaiting merge (the orchestrator's call in HITLD-153, kept): a test covers it.
- The orchestrate skill and the design say which path to use. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-153 (D-25) makes an item whose work awaits merge not planned again. The only way to release one that will not merge is a `verified` fail correction appended by hand with `ledger append`, because the ledger refuses `abandoned` after a report. The orchestrator on D-25 asked for both a command and an automatic release and recommended filing them, low priority.

## Notes

Needs HITLD-153 merged (it is waiting on PR #232 (HITLD-153)). Code and skill: needs the owner's own yes. Related: HITLD-194 (redispatching an abandoned item fails on its branch name).
