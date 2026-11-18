---
id: HITLD-484
title: What carries continuity between one orchestrator session and the next
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. Ledger and tracker, no run object: A new orchestrator rebuilds from a shared ledger and the tracker and GitHub; no lease, checkpoint or hand-over note."
answered_at: 2026-11-18T05:36:11.073Z
answered_via: question-tool
answered_by: owner
---

## Question

What should carry continuity between one orchestrator session and the next?

HITLD-470: a successor in a fresh container cannot resume the run today (HITLD-323, seen twice). The ledger carries the learning; the run's lease and checkpoint carry only orchestrator state; the chief of staff starts one orchestrator at a time.

## Options and recommendation

- A. Ledger and tracker, no run object: A new orchestrator rebuilds from a shared ledger and the tracker and GitHub; no lease, checkpoint or hand-over note.
- B. Keep the run, make it travel: Finish the store work so the run state moves between containers as designed.
- C. Lighter run: lease and checkpoint only: Keep a lease and a small checkpoint; rebuild the rest from the ledger.
- D. Tell me more first: The chief of staff explains the effects first.

Recommended: Ledger and tracker, no run object. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
