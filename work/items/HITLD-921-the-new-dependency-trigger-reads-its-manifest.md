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
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553).
