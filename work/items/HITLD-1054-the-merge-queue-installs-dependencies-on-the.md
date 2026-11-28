---
id: HITLD-1054
title: The merge queue installs dependencies on the branch under test, not on main, and says when a branch changes them
kind: work
state: in-progress
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8G82CSMK9GV0F
release_note: "The merge queue runs `env.worktree_setup` on the commit it checks, not only on main's tip: a branch that adds a package or changes a lockfile is checked with its own dependencies installed. Setup runs again only where a dependency manifest or lockfile changed, each run is recorded as the base's or the batch's, and a branch whose dependencies cannot be installed is sent back with reason `setup`, saying it changes them. With pull requests, setup runs only before generated files are rebuilt."
---

## Done when

- In `core/lib/merge/queue.mjs` and the pull-request queue (`pull-request.mjs`), the worktree setup commands (`env.worktree_setup`) run after the batch under test is checked out, not on main's tip; a test fails on current main and passes after: a branch that adds a package and changes the lockfile passes its checks in the queue's worktree.
- When setup runs more than once for a batch, a run is recorded as the base setup or the batch's, and the cost is bounded: setup runs again only when the batch changes a dependency manifest or lockfile (`dependencyFileNames`, `core/lib/merge/owner.mjs`); otherwise it is reused.
- If setup cannot run on the batch, the queue's refusal says that the branch changes dependencies, so it is not mistaken for a failing build.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 667: the queue ran setup (install) while main was checked out and only then checked out the branch under test, so a branch that adds a package or changes the lockfile built in the executor's worktree but failed in the queue. Confirmed on main: `core/lib/merge/queue.mjs` creates the worktree at `result.main.before`, runs `s.setup`, and only then defines `checkout(sha)`.

## Notes

Owner-held (merge path). In rc.2 on the owner's answer of 2026-11-25. The pull-request queue shares the setup path; check both modes and the setup-gap check (HITLD-292, `core/lib/env/setup-gap.mjs`). Ordinary code otherwise, reviewed independently before merge.
