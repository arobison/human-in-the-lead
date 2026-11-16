---
id: HITLD-268
title: Ready, blocked and open needs as fields on each item in the read API
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Return derived ready, blocked and open_needs on each item in the read API, and define blocked for proposed items.

Reported as GitHub issue #126 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: 03-data-model.md:160-161 lists ready and blocked as derived fields; work show HITLD-153 --json carries neither

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.8. Read API gap against the design's derived fields table; shape with HITLD-125-style API work.
