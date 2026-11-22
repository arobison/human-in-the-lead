---
id: HITLD-817
title: What happens when a batch fails its checks together (HITLD-814)
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Bisect the failing branch out, land the rest: The other approved branches still land and their approvals hold; batches stay small."
answered_at: 2026-11-22T06:22:51.767Z
answered_via: question-tool
answered_by: owner
---

## Question

When the batch fails its checks together, what happens?

The local queue reruns once, checks main, bisects to the first failing branch, sends it back and rebuilds without it.

## Options and recommendation

- A. Bisect the failing branch out, land the rest: The other approved branches still land and their approvals hold; batches stay small.
- B. Whole batch back to the executors: Nothing lands until all are fixed.
- C. Fall back to serial for that batch: One branch at a time for those branches.

Recommended: Bisect the failing branch out, land the rest. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
