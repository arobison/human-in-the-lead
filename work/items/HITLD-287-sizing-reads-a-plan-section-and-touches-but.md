---
id: HITLD-287
title: Sizing reads a Plan section and touches, but nothing tells a project, so every item sizes as tier 3
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Sizing needs a ## Plan section and touches, but nothing tells a project, so migrated items all size as tier 3 with no hint of the fix.

Reported as GitHub issue #158 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/dispatch/item.mjs:48 reads only section 'Plan'; sizing.mjs:82-84 plan none gives tier 3; no guide mentions ## Plan

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `dispatch`, still present on main, confidence 0.75. Discoverability and docs across migrate, work check and guides; needs shaping with #157 and #156.

## Folded on 2026-11-20 (reconciliation, HITLD-575)

The owner decided that this item describes the old sizing model, which HITLD-561 replaces (an item's tier and cost come from measured history with its plan as the prior, HITLD-533). This item is folded into HITLD-561 and closes when that item lands; it is not built separately.

## Moved on 2026-11-20 (HITLD-592)

On the owner's approval of the nine roadmap moves (HITLD-592), this item moved from milestone HITLD-403 (c4) to milestone HITLD-567 (c3), where HITLD-561, which replaces the old sizing model and folds this item in (HITLD-575), already sits.
