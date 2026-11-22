---
id: HITLD-266
title: Tracker-structure drops a project's link to its initiative when the project has no milestones
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-403 c2]
---

## Why

The tracker-structure migration removes a project's initiative key, so a project with no milestones loses any link to its long outcome.

Reported as GitHub issue #124 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/migrations/tracker-structure.mjs:109-110 drops initiative from every project; constraints come only from milestones (:142)

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.7. Steps are clear: an initiative with a project that has no milestones; the dry run shows the loss. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
