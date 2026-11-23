---
id: HITLD-923
title: The guide shows non-npm examples for worktree setup, checks and release packages
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

Both guide pages show only `npm ci` for worktree setup and checks.

## Done when

- The guide shows suggested worktree-setup, fast-check and full-suite command lines for Cargo, Python (uv), Go and Gradle, and a release-package example with a non-JSON version source.
- The guide states that HITLd needs Node 22.13 or later on the machine, not in the project (HITLD-917).
- `hitld work check` and the spelling check pass.


## Notes

Decided in the build-systems walk-through of 2026-11-22 (HITLD-917, 918).

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-971 (2026-11-23).
