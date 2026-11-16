---
id: HITLD-269
title: Generated views/lists.md fails markdownlint (MD001)
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Generated views/lists.md jumps from a level-1 to a level-3 heading and fails markdownlint MD001.

Reported as GitHub issue #127 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: work/views/lists.md:3-5 '# Item lists' then '### ...'; written by core/lib/tracker/files/tracker.mjs:831

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.9. Exact lint error and line; visible in this repository's own views. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
