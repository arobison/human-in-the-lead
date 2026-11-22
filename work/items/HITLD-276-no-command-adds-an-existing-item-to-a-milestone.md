---
id: HITLD-276
title: No command adds an existing item to a milestone, so constraints are edited by hand
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-403 c3]
---

## Why

No command adds an existing item to a milestone's constraints or contributions, so milestone front matter is edited by hand.

Reported as GitHub issue #140 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/tracker.mjs commands: work new, show, query, claim, unclaim, close, migrate, claims, check, sweep, views; no link

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.8. A new owner-level command; related to #128 but about linking existing items.
