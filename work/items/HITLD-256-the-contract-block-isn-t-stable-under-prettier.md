---
id: HITLD-256
title: The contract block isn't stable under prettier or markdownlint
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The AGENTS.md contract block is not stable under prettier (blank line after begin marker trips check contract) and fails markdownlint MD041 and MD040.

Reported as GitHub issue #113 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: templates/AGENTS.contract.md:1-2 heading right after the begin marker, no blank line; report fence has no language; core/lib/contract/block.mjs:121

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `install`, still present on main, confidence 0.8. Exact lint errors and the prettier change are given; template and check fix are testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
