---
id: HITLD-746
title: Print-mode executors are durable and their completion is observed, so ending an orchestrator's turn loses nothing
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80ZP66B9MVPVB
---

## Why

GitHub issue 455: in print mode, executors run inside the orchestrator's process and die when its turn ends, leaving uncommitted work and a held lease. The owner first chose detached processes (HITLD-738, then a walk-through), then asked for a step back; an exploration found the framing wrong: the problem is that completion is a notice the orchestrator must be alive to receive. The owner decided (HITLD-779) on a durable claim and a stateless reconciler. This item is now the print-mode part: executors are durable processes whose completion is observed by a reconcile pass (HITLD-780), not waited for. Push events are not a wake source outside pull requests, and the guard says executors never push, so the earlier push-as-wake and result-branch ideas are dropped.

## Done when

- A print-mode executor is started as a durable process (its own process group, stream-json output and pid and result files in the store, as observations) that survives the orchestrator ending its turn, and a test shows an executor finishing and being recorded by a later reconcile pass after the orchestrator exited.
- No timer stops an executor; budget is the cap (HITLD-782) and silence is only reported with evidence.
- The report is the closing commit's message body with a `Dispatch: D-...` trailer and the fixed shape, in one push; a hint message is only a wake.
- The guard allows an executor to push its own claim branch and nothing else (HITLD-765 states it in the skill).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Promoted on 2026-11-22

Promoted to planned: the design is decided (HITLD-779) and the Done-when above is concrete. It stays outside the run scope until the owner widens it.
