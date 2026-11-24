---
id: HITLD-921
title: The new-dependency trigger reads its manifest and lockfile names from the ecosystem profiles
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

The new-dependency trigger (`core/lib/merge/owner.mjs`) has a hard-coded set of 19 manifest basenames. The ecosystem profiles name the same files, so the knowledge should be in one place.

## Done when

- The trigger's manifest and lockfile names are the union of the built-in profiles' and the project's own profiles'.
- A test shows a dependency change in each of the dozen ecosystems still triggers, and a project profile adds a new name.
- The pnpm case HITLD-976 left open: the trigger takes the pnpm workspace manifest and lockfile names (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and the workspace packages' `package.json` files) from the pnpm ecosystem profile that HITLD-920 adds, not from its own list, and a test covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553).

Added 2026-11-24: the pnpm line is moved here from HITLD-976, which the owner accepted as done with that one line deferred, because the profile it reads from is built by HITLD-920 and this item.
