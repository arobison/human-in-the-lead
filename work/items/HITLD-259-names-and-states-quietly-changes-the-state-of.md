---
id: HITLD-259
title: Names-and-states quietly changes the state of non-work items that were in progress
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The names-and-states migration turns in-progress into planned for non-work items (external, projects) without calling it out, losing that an outside party was working.

Reported as GitHub issue #117 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/migrations/names-and-states.mjs:89 sets planned for in-progress non-work items with no note or separate listing

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.65. Steps are clear (an in-progress external item); the dry-run listing and body note are testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
