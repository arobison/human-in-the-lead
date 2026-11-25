---
id: HITLD-1046
title: When the owner's awaiting-merge queue is full, the ready queue offers work that does not route to the owner first
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
needs: [HITLD-995]
constraint_of: [HITLD-67 c?]
---

## Done when

- A setting names the most owner-held pull requests that may wait (default 4, the chief of staff's flow-control rule today); with the queue at or over it, an item whose changed paths do not match `merge.owner_paths` is offered ahead of one that does, in the same tier; a test covers a full and an empty queue.
- The plan says when it applied this rule and why.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner's attention is the scarce resource. Starting more owner-held work when four are waiting only lengthens the wait.

## Notes

rc.2, the owner's word (2026-11-25). Follows HITLD-995. A new settings key is a policy surface: the owner's own yes at merge. The advisor found no code for the limit of four (it is HITLD-865's by-hand rule), so this item moves it into a setting.
