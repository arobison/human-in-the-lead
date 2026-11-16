---
id: HITLD-280
title: "Dispatch complete takes the whole parenthetical after commit: as the branch name"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

dispatch complete takes everything inside the commit line's parentheses as the branch name, records it in the verified event, and merge then rejects it as missing.

Reported as GitHub issue #150 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/contract/report.mjs:81 regex takes [^)]+ as branch; orchestrator.mjs:1350 records it unchecked

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.85. Exact report line and regex given; a parser test reproduces it. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.
