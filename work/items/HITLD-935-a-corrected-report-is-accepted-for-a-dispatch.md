---
id: HITLD-935
title: A corrected report is accepted for a dispatch whose report had errors, and a failed follow-up records nothing
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M85PQHPHKC0G5J
---

## Why

A report with a wrong `commit:` line makes `dispatch complete` answer ok with `report_errors`; a corrected report is then ignored (`already`), `merge` says nothing waits, and the suggested `dispatch follow-up` fails ('a headless follow-up needs...') while still recording a new running dispatch. The item is stranded. On current main the re-offer is fixed; the follow-up side effect was not verified there.

## Done when

- A corrected report is accepted for a dispatch whose first report had errors.
- A failed `dispatch follow-up` records nothing, and its error does not speak of a headless run for an interactive dispatch.
- A test per case (corrected report; failed follow-up leaves no phantom dispatch).
- A follow-up dispatch records what actually ran: a follow-up launched as a subagent is recorded with its real harness mode and the real agent's reference, a launch that fails writes no dispatched or started event, and `dispatch handle` accepts the reference of the agent that is running; a test covers each (GitHub issue 582).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C4); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour. HITLD-314 (dispatch follow-up refuses an interactive tier-3 dispatch) is related.

GitHub issue 582 (a follow-up run as a subagent was recorded as headless and took an older dispatch's harness reference) is folded in here by the owner's decision HITLD-977.
