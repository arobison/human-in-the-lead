---
id: HITLD-469
title: Starts wait for the next run, with no question to the owner
kind: decision
state: done
created: 2026-11-17
project: HITLD-15
decider: owner
answer: "A. Wait for the next run: Nothing starts now; the plan's start list resumes at the window reset, and the chief of staff does not ask again."
answered_at: 2026-11-17T01:12:08.039Z
answered_via: chat
answered_by: owner
---

## Question

With the usage gate closed (critical-path-only at 67% used, window resets 2026-11-20 19:00 UTC), should anything start before the reset, or wait for the next run?

Nothing is running. The planner lists only HITLD-149, which is not on the critical path. The chief of staff was asking the owner again each hour.

## Options and recommendation

- A. Wait for the next run: Nothing starts now; the plan's start list resumes at the window reset, and the chief of staff does not ask again.
- B. Start something now: The owner names the item; it starts past the gate with a cost warning.

Recommended: Wait for the next run. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.

Clarified by the owner on 2026-11-17: "the next run" means a new orchestrator. By the design a hand-over successor resumes the same run, but a successor in a fresh container cannot resume (HITLD-323; the owner decided in HITLD-324 that a successor starts a fresh run). So the work starts under a successor that starts a new run, seeded from the last run's numbers, at the usage-window reset; the current orchestrator does not run `hitld handover`. Nothing starts before then.
