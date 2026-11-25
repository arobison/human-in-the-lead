---
id: HITLD-1056
title: Env setup refuses a harness-made worktree that does not start from the configured main branch, or resets it
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `adoptWorktree` (`core/lib/env/worktree.mjs`) checks that the worktree's HEAD descends from `merge.main_branch`, and refuses it with the branch it started from, or resets it to that branch when it has no commits of its own; a test covers a worktree cut from another branch.
- The executor never starts without the item's plan and the tracker because of a wrong base; the report says why when it is refused.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 664: the project's merge branch was not the repository's default branch, the harness cut the executor's worktree from the default branch, and `adoptWorktree` took it over without checking which branch it started from, so the executor reported itself blocked. Confirmed on main: `adoptWorktree` records `base: ctx.settings.mainBranch` but never compares HEAD with it.

## Notes

rc.3. Ordinary code; the harness-made worktree path is also the cloud path, so test it with the cloud setup.
