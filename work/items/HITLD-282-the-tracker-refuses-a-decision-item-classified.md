---
id: HITLD-282
title: The tracker refuses a decision item classified internal, which is the question's own default
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-77]
---

## Why

rights ask with the default question classification (internal) cannot create a decision item in an all-public files tracker; the refusal does not say what to do.

Reported as GitHub issue #153 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/rights/flow.mjs:452 classification ?? 'internal'; core/lib/tracker/files/tracker.mjs:616 refuses; related HITLD-77 (planned)

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.7. The fix is a classification choice that overlaps HITLD-77 (confidential decisions in the private store); shape together.
