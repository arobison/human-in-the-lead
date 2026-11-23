---
id: HITLD-900
title: An item whose files are outside every package's paths is warned about instead of dropped from every release, and install writes a valid package name
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-403 c?]
---

## Why

Reproduced: a done item with a `release_note` that touched only files outside every package's `paths` appears in no package's items, produces no warning and is not in `unreleased` (`measure` in `core/lib/release/propose.mjs`); the 'belongs to no package' warning fires only for items with no files and no `touches`. `hitld install` also uses `--project-id` unsanitized as the package name, and an upper-case value fails `PACKAGE_NAME` so `work check` fails right after install.

## Done when

- Every done, unreleased item with no owning package produces a warning naming the item.
- `hitld install` lower-cases and filters the package name as the directory-name fallback does.
- A test per case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R6 and R13; decision HITLD-897. Joins Consumer live (HITLD-67) clause c2 as a recorded exception to the freeze: it is a defect in the release path rc.2 depends on, and it should land before the owner applies `release migrate` (HITLD-854).

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-973 (2026-11-23).
