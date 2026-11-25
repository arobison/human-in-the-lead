---
id: HITLD-841
title: A cloud executor's token cap travels in its claim commit, so its budget hook enforces it without the store
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M87Y65JTA2QW5M
---

## Why

The HITLD-782 executor reported that in a cloud executor session there is no private store, so the budget hook cannot read the dispatched event and enforces nothing there; only the reconcile backstop applies. Its recommendation: `hitld work claim` records the cap in the claim commit (a `Budget-Tokens` trailer), so the hook reads it from the executor's own branch.

## Done when

- `hitld work claim` writes the dispatch's token cap as a `Budget-Tokens` trailer in the claim commit; the budget hook reads the cap from the executor's own claim commit and enforces it with no store.
- A test shows the hook stopping a cloud-style executor with no store when its transcript passes the cap. A hook change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Limitations

Where there is no store, the cap and the count rest on commits the executor writes itself. The reconcile pass stays the backstop for every case below.

- The executor can leave the cap out of its claim or inflate it.
- The executor can reset or defeat its own count. An empty `close: <ID>` commit restarts the count. A future author date on the claim means nothing is counted. `--reset-author` on an amend moves the start.
- A brief written by hand without `--budget-tokens` gets no enforcement.
- A follow-up with no close commit before it is charged against the first dispatch's cap from that dispatch's claim. An example is a cloud executor the watchdog continues after a stall or a limit cut-off. The ledger path, by contrast, restarts at each dispatch's own start.
