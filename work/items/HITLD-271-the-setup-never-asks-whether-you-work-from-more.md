---
id: HITLD-271
title: The setup never asks whether you work from more than one machine, so the private store is easy to miss
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Setup never asks whether the owner works from several machines or cloud sessions, so the private store remote is easy to miss and store.remote.required stays off.

Reported as GitHub issue #130 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: docs/guide/README.md:13 one line only; skills/adopt/SKILL.md:89 offers it, but hitld install and the first-run setup do not ask

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `setup`, still present on main, confidence 0.75. A new setup question and flow; needs shaping across install, first-run setup and guides.
