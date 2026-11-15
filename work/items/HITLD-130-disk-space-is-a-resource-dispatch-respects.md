---
id: HITLD-130
title: "Disk space is a resource dispatch respects, and merged worktrees are removed"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

A long orchestrating session filled its disk with worktrees of branches that had already merged, and every command then failed until they were removed. Memory and load are already limits dispatch respects; free disk is not, and nothing removes a worktree whose branch has merged. A self-hosted session will run long enough to hit this.

## Done when

- The machine file has a free-disk floor (a size, with a conservative default), and `hitld dispatch plan` and `dispatch start` refuse new work below it by name, the way the quota gate refuses below its reserve. Free space is read from the session's real allowance where the harness exposes one, and otherwise from the filesystem and what HITLd itself uses (worktrees, the private store, eval results).
- After a merge (and in `hitld dispatch watch`), worktrees whose branches have merged or whose dispatch has ended are removed through the environment manager's teardown, which keeps the primary checkout and any worktree a live dispatch holds.
- `hitld run status`, the watchdog and the digest report free space when it nears the floor, before it is reached.
- The orchestrate skill creates worktrees only through `hitld env`, so every one is tracked and torn down.
- **The test suite cleans up after itself:** every test removes the temporary directories it makes (they had built up to about 170,000 and filled the disk), and a test run fails if it leaves any behind.
- Tests cover the floor refusal, the removal of a merged worktree, and the kept primary and live worktrees.
- `npm run check`, the offline eval gate and `hitld work check` pass.
