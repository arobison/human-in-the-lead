---
id: HITLD-324
title: "How to restart the stalled run: a fresh run, the old ledger kept as text"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Start a fresh run, keep the old ledger as text: A new orchestrator runs hitld run start from the tracker on main; the old ledger is exported as text for the record, not merged."
answered_at: 2026-11-16T16:13:13.587Z
answered_via: question-tool
answered_by: owner
---

## Question

How do you want to get the run going?

The first orchestrator's ledger cannot merge into the store: two containers numbered ledger events the same (HITLD-74 not built), and a pull stops on that conflict. See HITLD-323.

## Options and recommendation

- A. Start a fresh run, keep the old ledger as text: A new orchestrator runs hitld run start from the tracker on main; the old ledger is exported as text for the record, not merged.
- B. Wait for HITLD-74, then reconcile: Nothing runs until per-machine ID blocks exist and the ledgers merge.
- C. Reconcile by hand now: The conflicting ledger events are resolved by hand so the pull succeeds.

Recommended: Start a fresh run, keep the old ledger as text. The tracker holds the work, and there is no ID conflict.

## Answer

Recorded in the front matter once answered.
