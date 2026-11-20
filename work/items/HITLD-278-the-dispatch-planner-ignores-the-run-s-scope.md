---
id: HITLD-278
title: The dispatch planner offers only items in the owner's current commitment
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The dispatch planner ignores the run's scope.items, offers out-of-scope items, and then refuses the in-scope item as not-planned, stalling the run.

Reported as GitHub issue #148 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/orchestrator.mjs:328 readyQueue and :368 plan() never read p.state.scope

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.85. Steps, scope JSON and code pointers given; a planner test with scope.items shows it. Not covered by HITLD-153. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Rewritten on 2026-11-19 (reconciliation, HITLD-573)

The run object and its `scope.items` are gone (HITLD-470, 484 to 490). The owner's approved set now lives in a commitment decision (a goal under a budget, HITLD-522, built in HITLD-554), and the planner offers only items in it. Until that is built, the approved list is carried by the chief of staff's start brief to the orchestrator, as for the start list of HITLD-539.
