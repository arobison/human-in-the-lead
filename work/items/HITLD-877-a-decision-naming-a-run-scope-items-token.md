---
id: HITLD-877
title: A decision naming a run scope (items, token budget, end time) lets the chief of staff start that run's work
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M88NC212A0QAEE
---

## Why

An orchestrator hands over after 8 completions or 30 percent of its context (HITLD-794 to 796), but a successor orchestrator can start executors only on the start line the owner types in its own session: the cloud harness's permission classifier lets it run only starts the owner names there. The run therefore stalls at every hand-over until the owner is present. The owner decided (HITLD-876, 2026-11-22) on an interim fix, option C of HITLD-803, until the permission mechanism (HITLD-254, 804, 805) lands.

## Done when

- The owner can record one decision, in their own words, that names a run scope: a list of items, a token budget and an end time. It is per run, never standing, and ends at the end time, the budget or the owner's word.
- The chief of staff starts the scope's items itself (dispatch plus the executor session) within the cap and the quota gate, and does not start anything outside the scope; it asks for anything outside it, and always for a guard, policy, rights or skill change.
- The orchestrator's hand-over then needs no typed start line: a successor orchestrator applies merges and handles completions, and the chief of staff does the starts.
- A test covers a start inside the scope, a start outside it (refused), an expired scope and an exhausted budget.
- A skill or rights change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Joins Consumer live (HITLD-67) clause c2 as an exception to the freeze (HITLD-874) because it is what unblocks running rc.2 work across hand-overs. HITLD-254, 804 and 805 remain the permanent fix. The operating-model review (O3) recommended it, with counting the hand-over threshold by context only and merge-only passes after it.
