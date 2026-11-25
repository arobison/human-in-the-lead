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

The executor writes its own claim commit, so it can leave the cap out or inflate it; a brief written by hand without `--budget-tokens` gets no enforcement where there is no store; the reconcile pass stays the backstop.
