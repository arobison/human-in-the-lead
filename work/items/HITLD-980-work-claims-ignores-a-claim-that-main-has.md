---
id: HITLD-980
title: `work claims` ignores a claim that main has superseded and lists it as stale, and a partial merge is a supported path
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-403 c?]
---

## Done when

- `hitld work claims` omits a claim when the item is done on main or the branch tip is already in main's history, and lists those under a separate `stale` key; a test covers a helper branch cut after the claim and a merged replay branch.
- `hitld merge --partial` merges the work without the claim or the close, leaves the item planned on main and records the partial merge in the ledger; a test covers it.
- `env cleanup --result merged` offers to delete the item's other local branches whose tips main contains; a test covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A board built on `work claims` shows items as in progress that nobody is working on, because helper, replay and partially merged branches keep their claims. It serves consumers who build boards and the owner who reads them.

## Notes

GitHub issue 585. rc.3. A consumer's board listed four items in progress while two were worked, from helper and replay branches and one partial merge. Related: GitHub issue 342 (run status is slow with many worktrees).
