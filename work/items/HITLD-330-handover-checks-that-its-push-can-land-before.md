---
id: HITLD-330
title: handover checks that its push can land before it releases the lease
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes, check first, keep the lease if it fails: A failed push no longer strands the run."
answered_at: 2026-11-16T16:54:07.197Z
answered_via: question-tool
answered_by: owner
---

## Question

Should handover check that its store push can land before releasing the lease?

HITLD-323: a successor orchestrator in a fresh cloud container cannot resume when the store sync is refused.

## Options and recommendation

- A. Yes, check first, keep the lease if it fails: A failed push no longer strands the run.
- B. Release anyway, but write the note somewhere that survives: The lease is released and a note goes to a durable place.
- C. Not now: Leave the order.

Recommended: Yes, check first, keep the lease if it fails. A failed push should not strand the run.

## Answer

Recorded in the front matter once answered.
