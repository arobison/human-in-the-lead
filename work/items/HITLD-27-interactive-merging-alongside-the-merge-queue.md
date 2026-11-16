---
id: HITLD-27
title: Interactive merging alongside the merge queue
kind: decision
state: done
created: 2026-11-14
project: HITLD-15
decider: owner
answer: "A. A command for hand merges: hitld merge hand <PR> checks the head SHA and the checks, takes the merge queue's lock, merges, writes the merged event and closes the item."
answered_at: 2026-11-16T22:19:18.000Z
answered_via: question-tool
answered_by: owner
---

## Question

How should a merge by hand and the merge queue share the lock, and how does a hand merge close its item? Today the chief of staff merges tracker-only pull requests through the forge's tool after checking the full head SHA and the checks, and merges the owner's approved code pull requests the same way; the orchestrator then appends the merged event by hand and nothing takes the queue's lock.

## Options and recommendation

- A. A command for hand merges: `hitld merge hand <PR>` does what the chief of staff does now: it checks the full head SHA and that every check is complete and green (with the rule for the stale check-run status, HITLD-386), takes the queue's lock, merges, writes the merged event and closes the item. The queue refuses to run while a hand merge holds the lock.
- B. Keep today's practice: merge by the forge's tool; the orchestrator appends the merged event by hand; no lock.
- C. Everything through the queue: no hand merges at all.

Recommended: A.

## Answer

A, chosen by the owner on 2026-11-16 in the question box (decision HITLD-428 records the choice; the build is HITLD-429).

## Done when

- The owner's answer is recorded in part 22 and design 14 is updated.
- The answer says how a merge by hand and the merge queue share the lock, and how a hand merge closes its item.
