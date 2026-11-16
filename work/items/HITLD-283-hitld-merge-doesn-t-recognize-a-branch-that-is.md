---
id: HITLD-283
title: Hitld merge doesn't recognize a branch that is already merged into main
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

hitld merge does not see that a queued branch is already merged into main; it rebases, runs fast checks, rejects it and sends a wrong follow-up.

Reported as GitHub issue #154 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/merge/queue.mjs has no is-ancestor check (only pull-request.mjs:144 does); loop goes missing check (:434) then rebase

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `merge`, still present on main, confidence 0.85. Steps are clear (merge a queued branch by hand, then run merge); testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
