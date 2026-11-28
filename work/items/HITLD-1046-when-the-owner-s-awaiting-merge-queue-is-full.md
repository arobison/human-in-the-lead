---
id: HITLD-1046
title: When the owner's awaiting-merge queue is full, the ready queue offers work that does not route to the owner first
kind: work
state: in-progress
created: 2026-11-25
project: HITLD-15
needs: [HITLD-995]
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8G8P5TFF9RWTX
release_note: "With dispatch.owner_queue_max (default 4) branches waiting on the owner, the plan offers work that does not route to the owner first; starts hold while one batch (merge.batch_max) waits on the merge queue; the plan and run status show the merge backlog by what it waits on and its oldest age."
---

## Done when

- A setting names the most owner-held pull requests that may wait (default 4, the chief of staff's flow-control rule today); with the queue at or over it, an item whose changed paths do not match `merge.owner_paths` is offered ahead of one that does, in the same tier; a test covers a full and an empty queue.
- The plan says when it applied this rule and why.
- A start also holds while the finished branches waiting on the merge queue (approved or not, not held for the owner) number `merge.batch_max` or more, one full batch; there is no new setting. The plan names the hold and the count; a test covers a queue below, at and above a batch, and shows an owner-held branch does not count toward it.
- `hitld run status` and the plan show the merge backlog: how many finished branches wait, split into waiting on the owner, waiting on the merge queue and waiting on checks, and how long the oldest of each has waited (from each item's `since`); a test covers the split and the age.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner's attention is the scarce resource. Starting more owner-held work when four are waiting only lengthens the wait.

## Notes

rc.2, the owner's word (2026-11-25). Widened the same day, at the owner's word, with GitHub issue 677 (the refill keeps starting work while finished branches pile up): the design already lists the owner's awaiting-merge queue and merge risk as limits on executor count (parts 2.5 and 13.4) and the code does not. The hold is derived from `merge.batch_max`, not a new count the owner sets; waiting on the owner is a different backlog from waiting on the merge queue and is not stopped by the queue-held count. Not here: merge-gate priority over executors' heavy jobs (HITLD-1011, HITLD-559, rc.3) and the cost of every merge sending other waiting branches back for another round (the proposed item filed with this change). Follows HITLD-995. A new settings key is a policy surface: the owner's own yes at merge. The advisor found no code for the limit of four (it is HITLD-865's by-hand rule), so this item moves it into a setting.
