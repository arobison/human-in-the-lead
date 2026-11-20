---
id: HITLD-273
title: Installing the plugin assumes the claude CLI, which desktop-app users don't have
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The plugin install steps assume the claude CLI; desktop-app-only users lack it, and the guide does not say committed settings may bring the plugin or how to check.

Reported as GitHub issue #136 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: docs/guide/new-project.md:79-83 and existing-project.md:78 give only claude plugin install

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `install`, still present on main, confidence 0.75. Docs path for desktop-app users; related to #120 but a different gap.
