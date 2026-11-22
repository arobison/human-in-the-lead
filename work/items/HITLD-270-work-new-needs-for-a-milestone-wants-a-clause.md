---
id: HITLD-270
title: Work new --needs for a milestone wants a clause on each entry
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-403 c3]
---

## Why

work new --kind milestone --needs requires a clause on each entry and the help does not say so; a new milestone starts with a bare Notes section.

Reported as GitHub issue #128 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/milestones.mjs:64 refuses an entry without c<n> or c?; tracker.mjs:129 milestone template is '## Notes'

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.7. Exact command and error given; defaulting to c? or better help is testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
