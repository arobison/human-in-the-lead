---
id: HITLD-286
title: Touches and tier_override are off by default in tracker.json, so work check refuses them, but sizing and merge evidence depend on touches
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

touches and tier_override are off by default in tracker.json optional_keys, so work check refuses them, yet sizing and merge evidence depend on touches.

Reported as GitHub issue #157 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: schemas/tracker.schema.json optional_keys default []; owner.mjs:231 no-touches deviation; orchestrator.mjs:1667 uses item touches; HITLD-136 derives touches only for briefs

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.7. Changing the reference format's defaults or install is a format choice; shape rather than auto-fix.

## Note on 2026-11-20 (HITLD-581)

Discrete tiers are being replaced by an execution mode, a cost-ordered cascade and a measured budget (HITLD-561). This item stays an independent small fix of a default; where it says "tier", read the profile that replaces it.
