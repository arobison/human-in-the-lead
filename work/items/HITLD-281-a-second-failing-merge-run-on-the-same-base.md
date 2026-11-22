---
id: HITLD-281
title: A second failing merge run on the same base crashes with "ledger event ... already exists with different content" and loses the failure reason
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-74]
constraint_of: [HITLD-404 c2]
---

## Why

A second failing merge run on the same base crashes with 'ledger event already exists with different content', losing the second failure's reason and follow-up.

Reported as GitHub issue #152 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/orchestrator.mjs:1785 id verified-fail-<item>-<base12> with no attempt part; also :853; ledger.mjs:294 throws

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `merge`, still present on main, confidence 0.9. Clear cause and error text; two failing runs on one base reproduce it. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Decided on 2026-11-20 (HITLD-604)

The owner decided that this item closes when the unique-ID ledger redesign (HITLD-74) lands: its collision class is removed by event and dispatch IDs that are unique by construction (HITLD-74, HITLD-489). It is folded into that redesign, so it needs HITLD-74 and is not built separately.
