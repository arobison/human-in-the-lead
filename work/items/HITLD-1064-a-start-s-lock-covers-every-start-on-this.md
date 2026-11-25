---
id: HITLD-1064
title: A start's lock covers every start on this machine and says what it cannot guard across machines, and a refusal before the lock is taken is not called a start-lock timeout
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `startLocked` (`core/lib/cli/commands/orchestrator.mjs`) labels as `start-lock-timeout` only a lock that stayed taken; any other failure before the lock is entered keeps its own message; a test makes the mutex path throw something else and reads the refusal.
- The scope's budget and end-time check run inside one lock per machine for every start under a scope; the refusal and the design text say that two machines starting at once are not guarded and that the store is the boundary, with the check that closes it named (a store-side counter, rc.3 with signed answers).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reviews of HITLD-877 found that `startLocked` turns every failure before the lock into 'another start held the lock', and that the budget check is per machine, so a second machine under the same scope can overspend by one start.

## Notes

rc.3. Follows HITLD-877. The cross-machine part is a design question for the owner's decision on signed answers.
