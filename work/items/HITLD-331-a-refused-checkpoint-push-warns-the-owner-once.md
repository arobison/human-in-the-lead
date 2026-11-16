---
id: HITLD-331
title: A refused checkpoint push warns the owner once and again at each hand-over
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Warn the owner once, then at each hand-over: The run keeps working; the owner is told early."
answered_at: 2026-11-16T16:54:10.379Z
answered_via: question-tool
answered_by: owner
---

## Question

Should a checkpoint push refused with device-not-enrolled block, or warn the owner once?

HITLD-323: a successor orchestrator in a fresh cloud container cannot resume when the store sync is refused.

## Options and recommendation

- A. Warn the owner once, then at each hand-over: The run keeps working; the owner is told early.
- B. Block dispatch until it is fixed: No new dispatch while pushes fail.
- C. Leave it non-blocking: Keep the silent behavior.

Recommended: Warn the owner once, then at each hand-over. Tells the owner early without stopping work.

## Answer

Recorded in the front matter once answered.
