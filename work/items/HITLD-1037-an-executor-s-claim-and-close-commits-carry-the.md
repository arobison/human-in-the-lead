---
id: HITLD-1037
title: An executor's claim and close commits carry the Agent-Role trailer the dco check needs, and the executor guard accepts a push chained with a fetch
kind: work
state: in-progress
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M88NWF6AKKD2D4
release_note: "`hitld work claim` and `hitld work close` add an `Agent-Role` trailer from `HITLD_ROLE`, so an executor's claim and close commits need no amend; the executor guard's refusal of a push chained with other commands says to run them as two commands."
---

## Done when

- `hitld work claim` and `hitld work close` commits made under an executor's environment carry the Work-Item, Dispatch and Agent-Role trailers, so a pull request opened from them passes the dco check without an amend; a test covers each command.
- The executor guard accepts `git fetch` chained with `git push` of the executor's own branch, or its refusal message says to run them as two commands; a test covers it (the HITLD-1003 family).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 executors for HITLD-820 and others had to amend their unpushed claim and close commits to add the Agent-Role trailer the dco check requires, because `work claim` and `work close` leave it out; a pushed commit cannot be fixed without a history rewrite, so each brief now warns about it. The guard also refused a `git push` chained with `git fetch`, which is not a command the executor meant as a bypass. Serves the executors and the orchestrator, who lose a round on each. [Certain: both were seen in this run.]

## Notes

rc.2 candidate (the owner decides). The guard change is a guard area: the owner's own yes at merge. A dispatch with the placeholder harness reference "x" (D-01M87QXT5GX23492) also exists in the ledger from this run; the item may check how a placeholder reference is recorded and refused.
