---
id: HITLD-680
title: A supported way to import finished dispatches into a new run's ledger
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-676]
---

## Why

When the first self-hosted run's orchestrator handed over, its ledger could not be stored, so a successor had to rebuild the first run's records. The ledger's raw append refuses dispatch records (only the run module may write them), and the only route to record a finished dispatch is `dispatch start --by-hand`, which the standing rule forbids. The successor recorded the starts, results and merges as logged and verified events, all marked backfilled, and no real dispatch records. The owner chose to leave it and file this item (decision HITLD-679).

## Done when

- A supported command imports a finished dispatch into the current run's ledger from its record (the item, the dispatch ID it had, its branch and head, its report and its merge), writing a real dispatch record marked imported, never measured, with no harness call and no permission bypass.
- It takes the source from files and trailers the owner can inspect, refuses anything it cannot verify against main (a squash commit with the matching Dispatch trailer), and cannot be run by an executor.
- Importing the first run's D-39 to D-59 is done with it, and the queue's follow-up path (`dispatch follow-up`) then works for them.
- Tests cover a verified import, an unverifiable one, a second import of the same dispatch, and an executor's attempt. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: unique ledger IDs (HITLD-74) mean an imported dispatch keeps its old numbered ID as a note, not as its ledger ID. HITLD-676 stays open until this lands.
