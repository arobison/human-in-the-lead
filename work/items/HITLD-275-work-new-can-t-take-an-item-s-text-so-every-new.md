---
id: HITLD-275
title: Work new can't take an item's text, so every new item needs a second edit
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

work new cannot take the item's text (body or Done when), so every new item needs a second edit and can be committed with an empty Done when.

Reported as GitHub issue #138 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/tracker.mjs:209-262 work new has no body, body-file or done-when option

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.8. CLI feature plus a possible work check warning; needs shaping.
