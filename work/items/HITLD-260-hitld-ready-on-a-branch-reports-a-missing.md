---
id: HITLD-260
title: Hitld ready on a branch reports a missing policy.json that exists
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

hitld ready reads the primary checkout, so on an adoption branch it reports policy.json missing although the branch has one; the message does not say why.

Reported as GitHub issue #118 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/orchestrator.mjs:250-258 project() uses ownerCheckoutOf and refuses "policy.json is missing or invalid" without naming the checkout

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.75. Reproducible on any branch before policy.json reaches main; a clearer message is a small fix. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
