---
id: HITLD-130
title: Disk space is a resource dispatch respects, and merged worktrees are removed
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-10
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

## Notes

Built by D-10:

- The floor is the machine file's `disk_floor_mb` (default 5120). Below it the plan holds every item with reason `disk`, inline work included, and `dispatch start` refuses with `disk-floor`; below one and a half times it, `run status`, `dispatch watch`, the plan and the digest carry a `disk` warning with what hitld itself uses (`du` of the worktrees, the private store and its eval results). Free disk is the harness's allowance where one is exposed as a number (none today: Claude Code's cloud sessions enforce theirs in the file system's available space), else the least available space at the checkout, the private store and the worktrees (`core/lib/machine/disk.mjs`).
- Teardown (`core/lib/env/teardown.mjs`) runs after each merge and on each `dispatch watch`, with or without `--act`: a leased worktree goes through the manager's release once its branch has merged (by the ledger or by git) or its dispatch was abandoned; an adopted one only once merged. Kept: the primary checkout (also refused by `removeFromDisk`), any worktree a live dispatch holds by holder, branch or path, and failed ones kept for inspection. Worktrees git lists that the manager never leased are reported as `untracked`, not removed.
- `npm test` is `core/test/run.mjs`: the suite runs with its own temporary directory and fails, naming the prefixes, when anything is left in it. Tests make temporary directories with `core/test/helpers/tmp.mjs`, which removes them at exit.
