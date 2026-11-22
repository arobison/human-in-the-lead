---
id: HITLD-822
title: The pull-request merge queue names the state of every approved branch and the reason one is waiting
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-191 c2]
---


## Why

On 2026-11-22 three approved pull requests (HITLD-764, 765 and 766) had no line at all in the queue's output for about 15 minutes while it worked on another. The orchestrator and the chief of staff had to guess (correctly, it turned out) that the queue takes one branch per pass in dispatch order. A branch with no line looks like a bug.

## Done when

- Every branch the ledger counts as awaiting merge appears in `hitld merge` output with a state (applied, presented, updated, pending, waiting, rejected, stalled) and, for waiting, the branch it waits behind and why.
- A test with three approved branches shows one applied, one pending and one waiting with the named blocker.
- A queue change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
