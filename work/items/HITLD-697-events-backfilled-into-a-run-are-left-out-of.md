---
id: HITLD-697
title: Events backfilled into a run are left out of first-pass yield, sizing and trust metrics
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
needs: [HITLD-676]
---

## Why

To get the first self-hosted run's pull requests into the merge queue, the successor orchestrator wrote `verified` events with result `pass`, marked in text as backfilled and not measured, because the ledger's raw append cannot write the dispatch and report events that normally queue a branch (HITLD-676, HITLD-680). The owner allowed this for the remaining branches (decision HITLD-696) on condition that the proper fix is filed. A check of `core/lib` on 2026-11-21 found that nothing treats a backfilled marker specially: first-pass yield (`ledger/summary.mjs`), the first-verdict sizing (`dispatch/sizing.mjs`), the planner's reading of verified events (`dispatch/plan.mjs`) and the quota report (`quota/report.mjs`) all count such an event as a real pass. So the metrics and any trust evidence built on them are inflated by up to about twenty passes that no verification measured.

## Done when

- A backfilled event carries a structured marker (a field in the event schema, not text in a note), and the ledger refuses to treat an event with it as measured.
- First-pass yield, first-verdict sizing, the planner, the quota report and every trust-engine input ignore marked events, each with a test that a marked pass changes none of their results.
- The first run's marked events (the verified-pass events written by the successor orchestrator for the pull requests of dispatches D-39 to D-59) are corrected or marked so that they are excluded, with a count of how many were found.
- `hitld work check`, `npm run check` and the offline eval gate pass.

## Notes

Related: HITLD-676 (the backfill), HITLD-680 (a supported import of finished dispatches, which should make this shortcut unnecessary), HITLD-74 (unique ledger IDs).
