---
id: HITLD-265
title: Warn when the commit guard isn't running in a worktree
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Warn when the commit guard will not run in a worktree, e.g. a relative core.hooksPath (husky) that a fresh worktree lacks, so no hooks run there.

Reported as GitHub issue #123 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: hooksPath is read only by core/lib/install/install.mjs:138-145 at install; no check in check policy or env setup

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `setup`, still present on main, confidence 0.7. A new check on the commit guard; touches the security baseline, so shape it with HITLD-34 in view.
