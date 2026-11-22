---
id: HITLD-267
title: A state history in the read API
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-192 c1]
---

## Why

Add a state-history query to the read API (each committed state change with its date), so boards stop reading git log of item files.

Reported as GitHub issue #125 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: docs/design/0001-human-in-the-lead/03-data-model.md:167 lists lead_time and blocked_time; work show --json returns neither

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.8. A read API extension the design already names; needs shaping.
