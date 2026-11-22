---
id: HITLD-780
title: "dispatch reconcile records the completions it observes: a closing commit carrying a report, and an executor that has ended"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Decided by the owner (HITLD-779) after an exploration of issue 455: completion is a fact the system observes, not a notice the orchestrator must be alive to receive. A dispatch is a ledger `dispatched` event plus a claim branch; any orchestrator turn can reconcile what exists. The watchdog already judges a headless run finished by observation; this item makes the same pass record completions for every executor, so an orchestrator that died, was replaced or ended its turn loses nothing. The executor's closing commit carries its report in the fixed shape with a `Dispatch: D-...` trailer, in one push; a hint message is only a wake. Only the orchestrator writes the ledger.

## Done when

- `hitld dispatch reconcile` reads the in-flight dispatches and, for each whose branch head carries a closing commit with a report for that dispatch and whose harness says the executor ended, records the completion once (`dispatch complete` already answers `already` for a repeat), taking tokens from the harness record.
- An executor that ended or went idle with no report is shown as `unreported` and one whose process is gone as dead, each with its evidence; an alive and quiet one is shown with its evidence and nothing acts on it. No wall-clock cap stops an executor.
- Two reconcile passes in a row, or an old and a new orchestrator, record nothing twice.
- A test covers a completed executor, an ended executor with no report, a repeat pass, and a report on a branch for a different dispatch.
- `npm run check`, the offline eval gate and `hitld work check` pass.
