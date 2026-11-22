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
  - "c4: A delegate's permission denial, unreported end and relayed answer reach the chief of staff without the owner carrying them"
constraints: [HITLD-279 c1, HITLD-280 c1, HITLD-347 c1, HITLD-281 c2, HITLD-283 c2, HITLD-284 c2, HITLD-292 c2, HITLD-194 c3, HITLD-314 c3, HITLD-346 c3, HITLD-494 c2, HITLD-496 c2, HITLD-495 c3, HITLD-497 c3, HITLD-562 c1, HITLD-254 c4, HITLD-240 c4, HITLD-186 c4, HITLD-710 c3, HITLD-707 c4]
check: demo a scripted fixture run seeds each case, including a delegate's permission denial, unreported end and relayed answer, and completes with no ledger line appended by hand and no message carried by the owner, run by someone other than the authors
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.3 (HITLD-400).

## Changed on 2026-11-20 (HITLD-604, 607)

On the owner's decision HITLD-604, HITLD-281 closes when the unique-ID ledger redesign (HITLD-74) lands and HITLD-314 is folded into HITLD-497; both stay listed here until then. On the owner's decision HITLD-607, the new clause c4 holds three delegate-friction design items moved from milestone HITLD-407: HITLD-254, HITLD-186 and HITLD-240. Each still needs a design walk-through (HITLD-135) before it is built.

On 2026-11-22, filed from the first self-hosting run's follow-ups: HITLD-710 (the watchdog gives up the claim when it abandons a dispatch) joins clause c3, and HITLD-707 (a tier-3 interactive session is started with the message tool allowed) joins clause c4.
