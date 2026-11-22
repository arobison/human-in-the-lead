---
id: HITLD-828
title: The chief of staff and the orchestrator hear that a queued pull request's checks finished, without polling
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-191 c2]
---


## Why

On 2026-11-22 the queue told the orchestrator to run again when the named checks finish, and the orchestrator does not poll. The chief of staff polls GitHub on timers only, so checks that went green were noticed 3 to 5 minutes late several times (HITLD-764 and HITLD-765, for example), and each pass waited on that.

## Done when

- The chief of staff subscribes to the pull requests the queue is waiting on (the forge's activity events) and tells the orchestrator when its named checks are all green, or the queue's output names the time to ask for a wake.
- A test or a recorded fixture shows a pull request's checks finishing and a wake being sent once.
- A skill change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
