---
id: HITLD-286
title: Touches and tier_override are off by default in tracker.json, so work check refuses them, but sizing and merge evidence depend on touches
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-403 c4]
claimed_by: D-01M82WYRTRT3CA43
release_note: "`touches` and `tier_override` are allowed on every item without listing them in tracker.json `optional_keys`; `hitld work check` names `optional_keys` when it refuses another key from the format's list, and no longer adds a false 'must be a single value' line."
---

## Why

touches and tier_override are off by default in tracker.json optional_keys, so work check refuses them, yet sizing and merge evidence depend on touches.

Reported as GitHub issue #157 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: schemas/tracker.schema.json optional_keys default []; owner.mjs:231 no-touches deviation; orchestrator.mjs:1667 uses item touches; HITLD-136 derives touches only for briefs

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.7. Changing the reference format's defaults or install is a format choice; shape rather than auto-fix.

## Note on 2026-11-20 (HITLD-581)

Discrete tiers are being replaced by an execution mode, a cost-ordered cascade and a measured budget (HITLD-561). This item stays an independent small fix of a default; where it says "tier", read the profile that replaces it.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).

## Seen in the consumer walkthrough (2026-11-22)

The Fable consumer walkthrough (2026-11-22, C2) hit this as a blocker: `touches`, which the tracker page and the contract rely on, is refused by default and the error does not name `optional_keys`; the second error line ('must be a single value') is false and the commit guard lets the broken file be committed. It stays in Consumer live (HITLD-67) clause c2 and should land in rc.2; decision HITLD-932.
