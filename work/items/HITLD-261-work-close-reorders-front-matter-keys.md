---
id: HITLD-261
title: Work close reorders front-matter keys
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-403 c2]
---

## Why

work close rewrites the whole front matter in canonical key order, moving claimed_by, so the closing diff carries an unrelated moved line.

Reported as GitHub issue #119 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/claims.mjs:285-286 closeItem uses applyPatch and writeStored, which renders with keyOrder (edit.mjs:47)

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.8. A file with non-canonical key order and work close --no-commit shows it. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
