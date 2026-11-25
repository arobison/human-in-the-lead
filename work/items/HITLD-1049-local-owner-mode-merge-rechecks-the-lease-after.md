---
id: HITLD-1049
title: Local owner-mode merge rechecks the lease after the pass, as the pull-request queue does
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- In local owner mode, `hitld merge` checks the lease again after its pass and before it records, as the pull-request queue now does; a pass whose lease was taken meanwhile records nothing and says what it merged but could not record; a test covers a successor taking the lease mid-pass.
- The orchestrate skill and the HITLD-823 release note no longer say the local queue has no second check.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-823 added a lease recheck after the merge pass in pull-request mode only. In local owner mode a successor that takes the lease mid-pass can have its state overwritten by the old session. The HITLD-823 executor judged it cheap but not entirely safe, because main has moved by the time the recheck runs; the same narrowing, not a closing, of the race applies (no compare-and-swap in the store). Serves the owner, whose merges should never be recorded by a session that lost the lease.

## Notes

Proposed for rc.3 by the chief of staff, 2026-11-25. From the HITLD-823 executor's deviations (dispatch D-01M8866TJC5GJRW9) and the review of PR 642. Merge-path code: owner-held.
