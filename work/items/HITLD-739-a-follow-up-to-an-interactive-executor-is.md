---
id: HITLD-739
title: A follow-up to an interactive executor is recorded as a dispatch of its own so its branch reaches the merge queue
kind: work
state: done
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80E4QRXHZ70XB
release_note: "`hitld dispatch follow-up` continues a tier-3 interactive session as a new dispatch: it prints a `relay` for the chief of staff, the second report is completed under the new ID and queues the branch, and a refused follow-up records nothing."
---

## Why

The owner held HITLD-691's pull request until this gap is fixed (HITLD-735), and listed it in the rc.2 bug list (HITLD-736). A dispatch completed as partial cannot be completed again: `dispatch complete` answers "already recorded". `dispatch follow-up` refuses an interactive session, so the continuation of an interactive executor, relayed by the chief of staff, has no dispatch of its own. Its second report has nowhere to land and its branch never reaches the merge queue.

This is the narrow part of HITLD-497, which folds in HITLD-314 and stays proposed and broad. Only this part is promoted to rc.2.

## Done when

- A relayed follow-up to an interactive executor is recorded as a new dispatch on the ledger (or the completed dispatch is re-opened), with no worktree or result file of its own, so that the executor's second report completes it and queues its branch for the merge.
- The refusal check (a dispatch kind that cannot be followed up) runs before any ledger event is written, so a refused follow-up leaves no phantom dispatch holding an executor slot.
- A re-opened or new follow-up dispatch reports again; it does not return the earlier report.
- A test covers an interactive dispatch completed as partial, its follow-up, and the second report reaching the merge queue. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Promoted from HITLD-497 (and HITLD-314, folded into it) on the owner's decision HITLD-736; the owner's decision HITLD-735 holds the pull request of HITLD-691 until this is built. The rest of HITLD-497 (an unreachable agent, a two-dispatch branch) stays proposed. Code: the owner's own yes to merge.
