---
id: HITLD-237
title: The chief of staff's run status and dispatch watch pull the private store first, so they do not show a stale ledger
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In the cloud, the chief of staff's `hitld run status` and `hitld dispatch watch` read its own copy of the private store, and neither pulls first: `pullBeforeRun` is called only by `run start` and `run resume` (`core/lib/cli/commands/ledger.mjs` lines 388 and 507). So the lease and the ledger they show lag the orchestrator's until a pull. Reproduce: `grep -n pullBeforeRun core/lib/cli/commands/*.mjs`. This matters to the ledger reconcile (HITLD-74, HITLD-178) and to the watchdog (HITLD-144).

## Done when

- `run status` and `dispatch watch` pull the private store first when it is reachable, say when they could not, and report how old what they show is.
- A test shows a status that reflects a newer remote lease and ledger, and one that says the store was unreachable.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by D-17 and relayed by orch-1; filed under HITLD-181. Related to HITLD-74 (per-machine ledger blocks), HITLD-142 (store reach) and HITLD-183 (store status after a push).

## Rewritten on 2026-11-19 (reconciliation, HITLD-573)

The run object and its lease are gone (HITLD-470, 484 to 490). What remains of this item is that the status and the dispatch watch read the store's ledger files and the tracker fresh before reporting, so they never show a stale ledger. Any lease wording in the text above no longer applies.
