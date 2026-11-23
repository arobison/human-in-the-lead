---
id: HITLD-292
title: A setup without env.worktree_setup passes every check, then the merge queue's fresh worktree can't run the project's checks
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-404 c2]
claimed_by: D-01M82WYSPH5GZ6M1
---

## Why

A setup without env.worktree_setup passes check policy and config explain, then the merge queue's fresh worktree cannot run the project's checks.

Reported as GitHub issue #177 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: schemas/policy/env.schema.json worktree_setup default []; no check outside merge, env and adopt skill reads it; related #155

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `setup`, still present on main, confidence 0.7. Several fixes (check policy warning, merge precheck, config explain); shape together with #155.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
