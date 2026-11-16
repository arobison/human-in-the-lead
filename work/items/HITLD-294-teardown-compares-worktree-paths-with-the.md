---
id: HITLD-294
title: teardown compares worktree paths with the default realpath, so Windows short and long names of one worktree compare unequal
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found by D-21 while merging main into the Windows branch (not verified on Windows). `core/lib/env/teardown.mjs` (new from HITLD-130) compares paths with its own `real` built on the default `realpathSync`, not the platform real path. On Windows a short-name path (`AUSTIN~1.ROB`) and a long-name path to one worktree then compare unequal.

Where: lines 13 and 25-31; uses at 65, 72, 80 and 165-171. Reproduce the search with `grep -rn realpathSync core/lib | grep -v platform/fs.mjs`.

## Done when

- teardown uses the platform real path helper from `core/lib/platform/fs.mjs`, and no other `realpathSync` use remains outside it.
- A test covers a short-name and a long-name path to one worktree (skipped off Windows, with a probe), and the owner's Windows run passes it.
- `npm run check` and `hitld work check` pass.
