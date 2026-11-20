---
id: HITLD-428
title: How hand merges and the merge queue share the lock
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. A command for hand merges: hitld merge hand <PR> checks the head SHA and checks, takes the queue's lock, merges, writes the merged event, closes the item."
answered_at: 2026-11-16T22:19:22.323Z
answered_via: question-tool
answered_by: owner
---

## Question

How should a merge by hand and the merge queue share things, and how does a hand merge close its item?

HITLD-27 was open since 2026-11-14 and holds up HITLD-76.

## Options and recommendation

- A. A command for hand merges: hitld merge hand <PR> checks the head SHA and checks, takes the queue's lock, merges, writes the merged event, closes the item.
- B. Keep today's practice: Merge by the forge tool; manual ledger event; no lock.
- C. Everything through the queue: No hand merges.

Recommended: A command for hand merges. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
