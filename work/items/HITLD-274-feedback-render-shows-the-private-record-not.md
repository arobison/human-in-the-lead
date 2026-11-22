---
id: HITLD-274
title: Feedback render shows the private record, not the draft that will be filed
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-64 c2, HITLD-67 c2]
---

## Why

feedback render builds the body from the private record (verbatim words), not the public draft, so a reviewer using render may approve a draft never seen.

Reported as GitHub issue #137 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/feedback/render.mjs:45-46 uses r.words and r.what_happened; feedback.mjs:237 render calls it on the record

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `feedback`, still present on main, confidence 0.75. Deterministic: draft a record, run render, compare with publish; touches the public-posting review step. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
