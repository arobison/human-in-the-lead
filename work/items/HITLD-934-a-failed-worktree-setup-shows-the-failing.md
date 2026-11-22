---
id: HITLD-934
title: A failed worktree setup shows the failing command and its output and removes the worktree and branch it made
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

On the guide's own `worktree_setup: ["npm ci"]`, the first `dispatch start` fails with `setup-failed` and no cause; the cause (no lockfile) is visible only in `hitld env status`, which nothing points to. On rc.1 the retry then fails because the branch already exists; on current main each retry leaves one more worktree and a `-2` branch.

## Done when

- The error names the failing command and the tail of its output, and points to `hitld env status`.
- A failed setup removes the worktree and the branch it made, so a retry starts clean.
- The guide says `npm ci` needs a lockfile and shows a setup that works without one.
- A test per case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C3); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour.
