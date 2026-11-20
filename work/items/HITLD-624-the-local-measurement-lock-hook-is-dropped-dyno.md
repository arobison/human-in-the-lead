---
id: HITLD-624
title: The local-measurement lock hook is dropped; dyno gates itself on measured load and reports busy state
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: yes
answered_at: 2026-11-20T03:31:09.565Z
answered_via: chat
answered_by: owner
---

## Question

Drop the hook that runs before and after a local measurement to take HITLD's lock, given dyno's contract forbids configuration that runs code?

Dyno's session replied on GitHub issue 363 that completion by a command conflicts with its executor contract; the same applies to the lock hook the owner confirmed earlier (HITLD-609).

## Options and recommendation

- A. Drop the hook: Dyno gates itself on measured load, reports busy, waiting for quiet and quiet through its status call; HITLD drains on that; completion is polled or watched through a record; HITLD's lock guards only HITLD's own processes
- B. Keep the hook as an exception: A marked, owner-approved exception in dyno's contract

Recommended: Drop the hook. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
