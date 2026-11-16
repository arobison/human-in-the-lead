---
id: HITLD-289
title: The chief-of-staff skill has no row for the Claude desktop app, so a local orchestrator runs headless where the owner can't see it
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The chief-of-staff harness table has no row for the Claude desktop app, so a local orchestrator runs headless via claude -p where the owner cannot see it.

Reported as GitHub issue #165 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: skills/chief-of-staff/SKILL.md:21-24 only web and this-machine columns; core/harness/claude-code/capabilities.mjs:47-49 same

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `plugin`, still present on main, confidence 0.75. Skill and capability text for a new harness; HITLD-144 (merged) covers cloud end-of-turn messages only.
