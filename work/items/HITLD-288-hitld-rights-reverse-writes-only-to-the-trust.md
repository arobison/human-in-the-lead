---
id: HITLD-288
title: Hitld rights reverse writes only to the trust record, so the orchestrator has no ledger event to act on
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

hitld rights reverse writes only a trust-record line, so the orchestrator finds no ledger event or skill guidance and cannot act on the owner's reversal.

Reported as GitHub issue #160 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/rights/flow.mjs:1164-1194 recordReversal calls only recordTrustEvent; orchestrate SKILL.md says nothing on checking reversals

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `dispatch`, still present on main, confidence 0.75. Needs a design for how reversals reach the orchestrator (ledger event, plan, skill); shape it.
