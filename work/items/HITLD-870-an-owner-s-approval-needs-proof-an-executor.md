---
id: HITLD-870
title: An owner's approval needs proof an executor cannot forge, and executors cannot write the queue state
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Why

The review found that the queue trusts the approval record in the shared state file (`core/lib/merge/pull-request.mjs`, `approvalHolds`) and that nothing proves who wrote it: the `--by` and `--signoff` values and the check code are computable by any agent, and an executor running as the owner's user can write the state file or append to the ledger directly. A forged approval merges a pull request with the owner's `Signed-off-by`; a forged unlock (HITLD-553) would grant standing authority.

## Done when

- An approval, a decision answer and an unlock count only with a proof an executor cannot make (the signing design left open as Q21), and the queue refuses a state file or ledger line without it.
- The queue state and the ledger are not writable by an executor's user or sandbox; the executor's path to them is its own claim and report, nothing else.
- An unlock takes effect only as a policy change merged on main with the owner's own yes, never as an event (the trust-engine design, HITLD-553, follows this).
- A test: a hand-written approval in the state file and a hand-appended ledger event are both refused.
- A rights or guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T3, T10 and the trust review's B9. Needs the signing decision (Q21).
