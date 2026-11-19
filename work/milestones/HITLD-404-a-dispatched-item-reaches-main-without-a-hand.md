---
id: HITLD-404
title: A dispatched item reaches main without a hand fix
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: Every dispatch, re-dispatch, follow-up, verification and merge in a run completes through hitld commands, and a failure says why.
done_when:
  - "c1: The executor guard and the report parser accept what the brief asks for, and a verified entry names its dispatch."
  - "c2: The merge queue handles an already-merged branch, a second failure on one base and a fresh worktree, and keeps the failed check's output."
  - "c3: An abandoned, unmergeable or interactive dispatch is re-dispatched, released or followed up by command."
constraints: [HITLD-279 c1, HITLD-280 c1, HITLD-347 c1, HITLD-281 c2, HITLD-283 c2, HITLD-284 c2, HITLD-292 c2, HITLD-194 c3, HITLD-314 c3, HITLD-346 c3, HITLD-494 c2, HITLD-496 c2, HITLD-495 c3, HITLD-497 c3, HITLD-562 c1]
check: demo a scripted fixture run seeds each case and completes with no ledger line appended by hand, run by someone other than the authors
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.3 (HITLD-400).
