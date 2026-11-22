---
id: HITLD-879
title: precedent match skips a folder that vanishes mid-walk and does not walk other worktrees' node_modules
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Reported by the owner as GitHub issue 549 (https://github.com/arobison/human-in-the-lead/issues/549): `precedent match` failed three times in one day with ENOENT while walking another worktree's `node_modules`, which an installer was changing. The command the executor contract requires before listing a question should not walk other worktrees' trees at all, and `run status` may share the cause (5.5 GB of worktrees, 2 to 14 s per call).

## Done when

- A failing test that reproduces the problem is written first (design part 14.7): a folder that vanishes during the walk.
- `precedent match` and the other walks of the tree skip dependency and output folders (`node_modules`, `target`, `.venv`, `build`, `.gradle`) and other worktrees' trees, and a file or folder that vanishes mid-walk is skipped, not fatal. Precedents live in the store's records, so the walk may not need the trees at all.
- `run status` is measured before and after on a store with several worktrees; the result is recorded.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Part of the walk rule in the build-system design (HITLD-883): the fix here is the narrow one, and the ecosystem data (which folders to skip per ecosystem) comes from that design. Joins Consumer live (HITLD-67) clause c2 on the owner's word of 2026-11-22 (decision HITLD-878).
