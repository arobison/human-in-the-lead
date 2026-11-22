---
id: HITLD-277
title: Feedback the agent finds and the person approves has no honest record shape
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-408 c4]
---

## Why

Feedback found by the agent and approved by the person has no honest record shape; the record's words become the approval phrase and the observation is lost.

Reported as GitHub issue #142 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: schemas/feedback.schema.json:11 has words (required, :99) and no field for origin or a separate approval

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `feedback`, still present on main, confidence 0.8. Record schema change for feedback provenance; needs shaping.
