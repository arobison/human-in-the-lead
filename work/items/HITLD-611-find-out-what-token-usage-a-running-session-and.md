---
id: HITLD-611
title: Find out what token usage a running session and its stream report, and how often
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-567 c3]
---

## Done when



- A study records, for each way a session runs (a headless print-mode run, an interactive cloud session, the chief of staff's own session), what token usage the harness reports while it runs and how often: per message, per tool step, only at the end of a turn, or only at the end of the session; and whether the rate-limit reading is emitted during a run or only at its start and end.
- The study records the longest turn the harness lets run without any report, from a sample of real runs, and the smallest unit of spend a hook or the watch can see.
- The result says what an executor's budget (HITLD-560), the pace controller (HITLD-550, 558) and the quota probe (HITLD-165) can rely on, and where a gap needs a different guard (a turn or tool-call limit, a budget flag on the run, a wall-clock backstop). Follow-up items are filed from it.
- `hitld work check` passes.

## Why

The owner asked whether a long turn could use many tokens with nothing able to watch it. What the design says: the quota probe runs when a reading is needed and stale (30 minutes to start, then again as the used share nears the reserve, no timer: HITLD-168), and the pace controller accepts that feedback is delayed (HITLD-550). An executor is to be judged stuck by progress and over by budget (HITLD-560), where "token movement" counts as a progress event. What is not known: the probe and the stream are not built (no core code reads the harness's stream output), session transcripts are deliberately not parsed (design part 12), and nobody has recorded when the harness reports usage during a run. So whether "token movement" is a signal an executor's watch can see, or only a number at the end, is unverified.

## Notes

A study (a learning item), so it needs no design walk-through; it feeds HITLD-560, HITLD-550 and HITLD-165. Related: HITLD-510 (read API token estimates), HITLD-584 (the token view). Placement is the chief of staff's, a proposal for the owner to move: under HITLD-567 clause c3 (an executor is stuck by progress and over by budget).
