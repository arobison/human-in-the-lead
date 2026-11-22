---
id: HITLD-279
title: The executor hook refuses the git branch rename that hitld's own brief asks the executor to do
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-404 c1]
---

## Why

The executor guard hook denies git branch -m hitld/<ID>-<slug>, the rename the brief asks for, because it matches the word hitld inside an argument.

Reported as GitHub issue #149 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/harness/claude-code/hooks/guard.mjs:25-26 hitldCalls matches \bhitld anywhere; :62 denies; brief.mjs:82 asks for git branch -m

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.85. Exact piped reproduction given; the fix edits a guard, so review it as security-sensitive. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Added on 2026-11-22 (GitHub issue 432)

The `git branch -m` refusal reported in issue 432 comes from the harness's own permission layer, not from the guard, so the brief should not ask the executor to rename its branch. The missing `rights who` and `precedent match` commands in issue 432 are HITLD-740.
