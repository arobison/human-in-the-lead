---
id: HITLD-748
title: dispatch complete refuses a report with parse errors and records nothing, so the executor can resend
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M80SRYS55FYBF2
release_note: `hitld dispatch complete` refuses a report that does not parse (`report-shape`, with `report_errors` naming each line to fix) and records nothing, so the executor resends and the same dispatch is completed with the corrected report; a headless run's report is still recorded and asked again by a follow-up.
---

## Why

Seen three times in the first self-hosting run (the HITLD-691 follow-up, the HITLD-701 report, and the HITLD-30 report): `hitld dispatch complete` records a dispatch even when the executor's report has parse errors (a commit line with extra text, a missing indent, a stray heading), and a dispatch can be completed only once, so the malformed record stands and cannot be corrected. In each case the orchestrator also could not queue the branch. Related: HITLD-280 (the parser reads the whole parenthetical) and HITLD-739 (a follow-up gets its own dispatch). GitHub issue 430 reports the same family from a consumer project.

## Done when

- `dispatch complete` checks the report's shape before it writes any ledger event; a report with parse errors is refused, nothing is recorded, and the refusal names each line to fix, so the executor can resend and the dispatch can still be completed.
- A report that parses is recorded exactly once as today.
- A test covers a malformed report followed by a corrected one for the same dispatch.
- `npm run check`, the offline eval gate and `hitld work check` pass.
