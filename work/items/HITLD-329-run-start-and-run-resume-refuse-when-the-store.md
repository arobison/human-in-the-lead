---
id: HITLD-329
title: run start and run resume refuse when the store cannot carry a hand-over
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Refuse unless the owner opts out: The run does not start; --no-sync is the explicit way past it."
answered_at: 2026-11-16T16:54:04.012Z
answered_via: question-tool
answered_by: owner
---

## Question

Should run start and run resume refuse, or only warn, when the store is not ready to carry a hand-over?

HITLD-323: a successor orchestrator in a fresh cloud container cannot resume when the store sync is refused.

## Options and recommendation

- A. Refuse unless the owner opts out: The run does not start; --no-sync is the explicit way past it.
- B. Warn loudly, do not refuse: The run starts with a prominent message.
- C. Not now: Skip this check.

Recommended: Refuse unless the owner opts out. It would have found the problem at the start.

## Answer

Recorded in the front matter once answered.
