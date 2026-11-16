---
id: HITLD-229
title: The release environment check also covers admin bypass and the main-only deployment branch rule
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

HITLD-140 (PR #174) makes the Release workflow refuse to run when the `release` environment has no required reviewer. Its executor noted two gaps it left on purpose: the check does not stop an administrator from bypassing the reviewer rule (`can_admins_bypass`), and it does not cover the rule that limits the environment to deployments from `main`. The docs now say the check covers the reviewer rule only.

## Done when

- The owner decides, in a walk-through (HITLD-135), whether the check should also refuse when administrators can bypass the reviewer rule, and whether it should refuse when the environment is not limited to `main`; the answers are recorded as decisions.
- If yes, the check, its tests, CONTRIBUTING.md (Releases) and design part 16.5 follow the answers, with the same fail-closed cases as the reviewer check.

## Notes

`proposed` because it is a choice about release safety. From D-15's digest on HITLD-140.
