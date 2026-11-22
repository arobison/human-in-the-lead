---
id: HITLD-763
title: The store export never commits executor worktrees and refuses any gitlink
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Found by the orchestrator in the first self-hosting run: the private store's snapshot export runs `git add -A` and its machine-local ignore list (MACHINE_LOCAL in core/lib/store/git.mjs) does not list `worktrees/`. `hitld dispatch start` makes each tier-3 executor's worktree under the store directory, so each start added a directory that was committed as a gitlink (mode 160000), and another machine's `hitld store pull` then refused the import as 'not a plain file'. The orchestrator worked around it on its own machine with a local exclude entry and an index-only removal; the code fix is not made.

## Done when

- `worktrees/` is machine-local: the store export never commits it, and a worktree directory under the store is never part of a snapshot.
- The export refuses any gitlink (mode 160000) in a snapshot it is about to write, naming the path.
- A test shows an executor worktree directory is never committed by the export and that a gitlink is refused.
- `npm run check`, the offline eval gate and `hitld work check` pass.
