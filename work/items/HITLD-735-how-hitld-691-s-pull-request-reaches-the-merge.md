---
id: HITLD-735
title: How HITLD-691's pull request reaches the merge queue
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "C. Hold until the gap is fixed: File and build the missing follow-up-dispatch path first, then queue PR 457 properly."
answered_at: 2026-11-22T01:15:50.942Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-691's PR 457 is code and cannot reach the merge queue: its dispatch was completed as partial and a relayed follow-up to an interactive session cannot be recorded as a new dispatch. How should it get to the queue?

Orch-5 reported that dispatch complete answers 'already recorded' and dispatch follow-up refuses interactive sessions (HITLD-314, folded into HITLD-497).

## Options and recommendation

- A. Backfilled event, as for the first run: Orch-5 queues the branch with a verified-pass event marked Backfilled (HITLD-676), not measured; a new use of the exception.
- B. You approve, I merge it by hand: Skip the queue on the owner's yes, as with PR 393.
- C. Hold until the gap is fixed: File and build the missing follow-up-dispatch path first, then queue PR 457 properly.

Recommended: Backfilled event, as for the first run. The chief of staff recommended the backfilled event; the owner chose to hold.

## Answer

Recorded in the front matter once answered.
