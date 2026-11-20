---
id: HITLD-290
title: A flake fix proves itself by being deterministic and by a mutation, not by many full-suite runs
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

A flake fix should prove itself by determinism, a mutation and one or two suite runs, not N full-suite runs; give fix items a default Done-when shape.

Reported as GitHub issue #169 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: skills/orchestrate/SKILL.md:134 flakes step creates fix items with no guidance on their Done when

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `flakes`, still present on main, confidence 0.8. Guidance for flake fix items; needs shaping.
