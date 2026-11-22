---
id: HITLD-925
title: The ecosystem profile names a shared cache and its variable, setup and checks export it, and the disk report shows its size
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

Every worktree installs everything from scratch (a consumer's worktrees took about 5.5 GB). The owner decided the build tool shares caches and HITLd only exports the variable and reports size (HITLD-915).

## Done when

- The ecosystem profile names a shared cache and its environment variable; setup and checks export it, pointing at the tool's default or a machine-file path. HITLd never creates links itself.
- The disk report shows the cache folders as 'shared, not reclaimed by removing worktrees'.
- A test per cache variable.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). rc.3.
