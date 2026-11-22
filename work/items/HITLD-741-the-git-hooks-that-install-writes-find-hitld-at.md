---
id: HITLD-741
title: The git hooks that install writes find hitld at run time and do not block commits when the install moves
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80GAJH32FSRJ3
---

## Why

Reported as GitHub issues 427 and 426, one cause: the hooks `hitld install` writes point at the checkout that ran install. The hook text carries that checkout's `hitld.mjs` path, and when the checkout is moved or removed the hook stops the commit with "hitld is gone" until install is run again. A consumer that installed from a clone it later deleted, or from another machine's path, cannot commit.

## Done when

- The pre-commit and commit-msg hooks find hitld when they run: first `hitld` on the PATH, then the pinned plugin's bundled executable, then the path recorded at install.
- The hook checks that the version it found matches the project's pin and says so when it does not.
- A moved or removed install does not block a commit: when no hitld is found, the hook warns and lets the commit through, and says how to fix it. The merge checks still catch a bad commit, so nothing is lost.
- A test covers each lookup step in order, a version mismatch, and a recorded path that no longer exists. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-264 (machine paths in install's hook warning and status-line command), HITLD-25. Code: the owner's own yes to merge.
