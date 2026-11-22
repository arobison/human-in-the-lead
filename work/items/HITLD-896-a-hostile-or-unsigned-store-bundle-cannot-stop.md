---
id: HITLD-896
title: "A hostile or unsigned store bundle cannot stop sync: unsigned heads are dropped"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-190 c?]
---

## Why

A pushed store history that changes any non-`.jsonl` file or reuses a line id is a conflict and stops the import (`core/lib/store/git.mjs`), so a hostile bundle can block sync for every device until someone repairs it by hand.

## Done when

- With signatures (HITLD-887), unsigned heads are dropped and the last signed version stays; a hostile bundle cannot stop sync.
- A test pushes a hostile bundle and shows sync continues.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S10 (low) of the second Fable security pass (2026-11-22), decision HITLD-885. rc.3; depends on HITLD-887.
