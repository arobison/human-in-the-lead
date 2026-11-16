---
id: HITLD-162
title: Where the owner's person settings live so a fresh cloud session does not ask again
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. In the private store, synced: The person file is kept in the owner's private store and read by any enrolled session at start. Changes are made only in the owner's own turn and pushed with hitld store push, and an executor cannot change it. Needs the store reachable from the orchestrator (HITLD-142)."
answered_at: 2026-11-16T01:12:18.404Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should the owner's person settings live, so a fresh cloud session reads them and does not ask for them again?

The person settings are the executor caps, the reserve, declared limits, attention budget and quiet hours. They sit in a file in each container's home directory today, and a cloud container is discarded when its session ends, so the owner's answers were carried to the orchestrator by hand. Raised for HITLD-148.

Reversibility: two-way.

## Options and recommendation

- A. In the private store, synced: The person file is kept in the owner's private store and read by any enrolled session at start. Changes are made only in the owner's own turn and pushed with hitld store push, and an executor cannot change it. Needs the store reachable from the orchestrator (HITLD-142).
- B. In the cloud environment's variables: The settings go in the environment's configuration, read by every session in it. No store dependency, but stored in plain text, visible to every process in the container, and changed by editing the environment by hand.
- C. In the project repository: A settings file committed to the repository. Every session has it with no store or environment setup, but it is public, and the reserve and limits would sit in public history.

Recommended: In the private store, synced. The store is already the one place every enrolled session can read and the owner controls, and it keeps the settings private.

## Answer

Recorded in the front matter once answered.
