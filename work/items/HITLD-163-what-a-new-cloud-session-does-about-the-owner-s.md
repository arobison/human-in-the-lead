---
id: HITLD-163
title: What a new cloud session does about the owner's settings when the store cannot be reached
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Conservative defaults, and say so: One executor, the default reserve of 0.25 and no declared limits, as setup-not-done behaves today. The session says what it could not read and why. The owner can say to go on, or fix the store."
answered_at: 2026-11-16T01:14:44.635Z
answered_via: question-tool
answered_by: owner
---

## Question

If a new cloud session cannot reach the store when it starts, what should it do about the owner's settings?

The owner chose to keep the person settings in the private store. When the store is not reachable at session start, the settings are not there to read. Raised for HITLD-148.

Reversibility: two-way.

## Options and recommendation

- A. Conservative defaults, and say so: One executor, the default reserve of 0.25 and no declared limits, as setup-not-done behaves today. The session says what it could not read and why. The owner can say to go on, or fix the store.
- B. Refuse to dispatch until it syncs: No autonomous work starts until the store is reachable or the owner says in their own message to go on without it.
- C. Use the last copy that session has: Reads whatever person file is already in the container, however old, which a new container does not have and which could carry a stale cap or limit.

Recommended: Conservative defaults, and say so. Nothing runs wide on guessed settings, and a store problem does not stall the run.

## Answer

Recorded in the front matter once answered.
